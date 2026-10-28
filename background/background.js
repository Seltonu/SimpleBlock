/**
 * Owns the configuration and enforces it.
 *
 * Navigations: any tab heading to a blocked URL is sent to pages/blocked.html,
 * which either shows the block message or immediately forwards to the rule's
 * redirect, usually before the blocked site has loaded anything. (A browser
 * extension can't cancel the request outright without permission to access
 * every website.) Redirects detour through our own page because container add-ons
 * (Facebook Container, Multi-Account Containers) reopen a tab in a container
 * whenever they see a matching request: redirecting straight to, say,
 * facebook.com/messages while one of them is reopening facebook.com produced
 * two tabs.
 *
 * Open tabs: when settings change, every tab is reconciled. The tab you're
 * looking at in each window is covered right away. Background tabs are only
 * muted if they're playing audio, and get covered when you switch to them, so
 * toggling blocking on and off again never reloads tabs you didn't look at.
 * Covered tabs go back to their page as soon as it's no longer blocked.
 *
 * The popup streams edits over a port and this script is the only writer of
 * the stored config. Keystrokes update the rules used for new navigations
 * immediately but only re-check open tabs once an edit is committed (Enter,
 * leaving the field, a toggle, or closing the popup), so a half-typed rule
 * doesn't flicker tabs.
 */

import { compileConfig, configFromLegacy, CONFIG_KEY, defaultConfig, findBlock, normalizeConfig, saveConfig } from "../shared/config.js";
import { unwrapUrl } from "../shared/patterns.js";

const BLOCKED_PAGE = browser.runtime.getURL("pages/blocked.html");
const SAVE_DELAY_MS = 400;
const CLAIM_MS = 2000;

let config = defaultConfig();
let activeRules = [];
let saveTimer = null;
let applying = Promise.resolve();
// If settings couldn't be read, never write: saving would replace them with defaults.
let canSave = true;

// The same navigation can be reported several times (onBeforeNavigate, then
// onCommitted; onActivated racing a discarded tab's reload). Remember what was
// last done to each tab so it's only acted on once.
const claims = new Map(); // tabId -> { key, url, at }

// Listeners must be registered synchronously at startup; handlers wait for this.
const ready = loadOrMigrate()
  .catch((error) => {
    console.error("SimpleBlock: couldn't load settings", error);
    canSave = false;
    return defaultConfig();
  })
  .then(setConfig);

ready.then(reconcileAll);

browser.webNavigation.onBeforeNavigate.addListener((details) => onNavigation(details, false));
browser.webNavigation.onCommitted.addListener((details) => onNavigation(details, true));
browser.webNavigation.onHistoryStateUpdated.addListener((details) => onNavigation(details, true));
browser.tabs.onActivated.addListener(({ tabId }) => reconcileById(tabId));
browser.tabs.onAttached.addListener((tabId) => reconcileById(tabId));
browser.tabs.onUpdated.addListener((tabId, change, tab) => reconcileTab(tab), { properties: ["audible"] });
browser.tabs.onRemoved.addListener((tabId) => claims.delete(tabId));
browser.runtime.onConnect.addListener(onConnect);

/* ---------- Settings ---------- */

async function loadOrMigrate() {
  const stored = (await browser.storage.local.get(CONFIG_KEY))[CONFIG_KEY];
  if (stored) return normalizeConfig(stored);

  // First run of 2.x: carry over rules from 1.x, which kept them in localStorage.
  // The old copy is left alone, so going back to 1.x (say, after trying 2.x as a
  // temporary add-on, which shares this storage) still finds its rules.
  const migrated = configFromLegacy(localStorage) ?? defaultConfig();
  try {
    await saveConfig(migrated);
  } catch (error) {
    console.error("SimpleBlock: couldn't save migrated settings", error);
  }
  return migrated;
}

function setConfig(next) {
  config = next;
  activeRules = compileConfig(config);
}

function save() {
  return canSave ? saveConfig(config) : Promise.resolve();
}

function scheduleSave() {
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, SAVE_DELAY_MS);
}

/** Saves and re-checks open tabs. Runs one at a time so overlapping commits can't interleave. */
function applyNow() {
  clearTimeout(saveTimer);
  applying = applying.then(save).then(reconcileAll).catch((error) => console.error("SimpleBlock:", error));
  return applying;
}

function onConnect(port) {
  if (port.name !== "popup") return;
  ready
    .then(() => port.postMessage({ type: "init", config }))
    .catch(() => {}); // The popup closed before we were ready.
  port.onMessage.addListener(async (message) => {
    if (message?.type !== "update") return;
    await ready;
    setConfig(normalizeConfig(message.config));
    if (message.apply) await applyNow();
    else scheduleSave();
  });
  // Closing the popup commits whatever was being typed.
  port.onDisconnect.addListener(() => ready.then(applyNow));
}

/* ---------- Navigations ---------- */

async function onNavigation({ tabId, frameId, url }, committed) {
  if (frameId !== 0 || tabId === browser.tabs.TAB_ID_NONE) return;
  await ready;

  // Our own navigation (or something else) landed, so the claim has served its purpose.
  if (committed && claims.get(tabId)?.url !== url) claims.delete(tabId);

  const block = findBlock(activeRules, url);
  if (!block) {
    // E.g. a blocked page reloaded after its tab was discarded (it may need
    // restoring), or a tab we muted moved on to an allowed page.
    if (committed) reconcileById(tabId, url);
    return;
  }

  // Once the page has committed, replace its history entry so Back doesn't lead
  // straight back into the block. Before that there's nothing to replace, unless
  // the tab is reloading the same URL or is already showing a blocked page.
  let replace = committed;
  if (!replace) {
    const current = (await browser.tabs.get(tabId).catch(() => null))?.url ?? "";
    replace = current === url || current.startsWith(BLOCKED_PAGE);
  }
  await blockTab(tabId, url, block, replace);
}

/* ---------- Open tabs ---------- */

async function reconcileAll() {
  const tabs = await browser.tabs.query({ discarded: false });
  await Promise.all(tabs.map(reconcileTab));
}

/** `url`, when given, is the URL a navigation event just reported, which tabs.get() may not reflect yet. */
function reconcileById(tabId, url) {
  return browser.tabs.get(tabId).then((tab) => reconcileTab(url ? { ...tab, url } : tab), () => {});
}

async function reconcileTab(tab) {
  // Discarded tabs are handled when they reload; touching them would force a load now.
  if (!tab || tab.discarded) return;
  await ready;

  const mutedByUs = tab.mutedInfo?.muted && tab.mutedInfo.extensionId === browser.runtime.id;
  const original = originalUrlOf(tab.url);

  if (original !== null) {
    if (mutedByUs) await setMuted(tab.id, false);
    if (!findBlock(activeRules, original)) await restoreTab(tab.id, original);
    return;
  }

  const block = findBlock(activeRules, tab.url);
  if (block && tab.active) {
    await blockTab(tab.id, tab.url, block, true);
  } else if (block && tab.audible && !tab.mutedInfo?.muted) {
    await setMuted(tab.id, true);
  } else if (!block && mutedByUs) {
    await setMuted(tab.id, false);
  }
}

function blockTab(tabId, url, block, replace) {
  if (!claim(tabId, "block", url)) return undefined;
  return navigate(tabId, blockedPageUrl(url, block), replace);
}

function restoreTab(tabId, url) {
  if (!claim(tabId, "restore", url)) return undefined;
  return navigate(tabId, url, true);
}

function claim(tabId, action, url) {
  const key = `${action} ${url}`;
  const previous = claims.get(tabId);
  if (previous?.key === key && Date.now() - previous.at < CLAIM_MS) return false;
  claims.set(tabId, { key, url, at: Date.now() });
  return true;
}

async function navigate(tabId, url, replace) {
  try {
    await browser.tabs.update(tabId, { url, loadReplace: replace });
  } catch {
    // The tab closed in the meantime, or it's a page extensions can't navigate.
  }
}

async function setMuted(tabId, muted) {
  try {
    await browser.tabs.update(tabId, { muted });
  } catch {
    // The tab closed in the meantime.
  }
}

/* ---------- The blocked page's URL ---------- */

// The blocked page never touches extension APIs (Firefox closes extension
// pages that do whenever the add-on updates or is disabled, taking the tab's
// history with them), so everything it shows travels in its query string.
function blockedPageUrl(url, { rule, ruleset, redirectUrl }) {
  const params = new URLSearchParams({ url: unwrapUrl(url), rule: rule.block, set: ruleset.name });
  if (redirectUrl) params.set("to", redirectUrl);
  return `${BLOCKED_PAGE}?${params}`;
}

/** The URL a blocked page is standing in for, or null if the tab isn't one (or is mid-redirect). */
function originalUrlOf(tabUrl) {
  if (!tabUrl?.startsWith(BLOCKED_PAGE)) return null;
  const params = new URL(tabUrl).searchParams;
  const original = params.get("url") ?? "";
  return params.has("to") || !/^https?:\/\//i.test(original) ? null : original;
}
