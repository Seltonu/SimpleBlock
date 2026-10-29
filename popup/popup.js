/**
 * The toolbar popup: edit rulesets and rules.
 *
 * The background script owns the config. It sends it over a port when the
 * popup opens, and the popup sends the whole (small) config back after every
 * edit. `apply: false` (a keystroke) just updates the background's rules and
 * schedules a save; `apply: true` (Enter, leaving a field, a toggle, adding or
 * removing something) also re-checks open tabs. Closing the popup applies too.
 */

import { compileConfig, createRule, createRuleset, findBlock, UI_KEY } from "../shared/config.js";
import { compilePattern, parseRedirect, parseUrl } from "../shared/patterns.js";

const $ = (id) => document.getElementById(id);
const els = {
  themeToggle: $("theme-toggle"),
  master: $("master"),
  pausedNote: $("paused-note"),
  tabs: $("tabs"),
  addRuleset: $("add-ruleset"),
  panel: $("panel"),
  noRulesets: $("no-rulesets"),
  name: $("ruleset-name"),
  rulesetEnabled: $("ruleset-enabled"),
  deleteRuleset: $("delete-ruleset"),
  rules: $("rules"),
  addRule: $("add-rule"),
  help: $("help"),
  settings: $("settings"),
  tabTemplate: $("tab-template"),
  ruleTemplate: $("rule-template"),
};

const port = browser.runtime.connect({ name: "popup" });
let config;
let selectedId;
let hintRuleId = null; // the rule whose pattern is being explained
let typingRuleId = null; // the rule being typed in, whose new errors wait for a pause
let typingTimer = null;
const ERROR_DELAY_MS = 500;
let deleteTimer = null;

const uiState = browser.storage.local.get(UI_KEY).catch(() => ({}));
port.onMessage.addListener((message) => {
  if (message?.type === "init" && !config) init(message.config);
});

async function init(loaded) {
  config = loaded;
  const stored = await uiState;

  // Rows left completely blank last time aren't worth keeping.
  for (const set of config.rulesets) {
    set.rules = set.rules.filter((rule) => rule.block.trim() || rule.redirect.trim());
  }

  selectedId = stored[UI_KEY]?.selectedRuleset;
  if (!findRuleset(selectedId)) selectedId = config.rulesets[0]?.id ?? null;

  render();
  bindEvents();
}

/* ---------- State helpers ---------- */

function findRuleset(id) {
  return config.rulesets.find((set) => set.id === id);
}

function currentRuleset() {
  return findRuleset(selectedId);
}

function findRule(id) {
  return currentRuleset().rules.find((rule) => rule.id === id);
}

function push(apply) {
  try {
    port.postMessage({ type: "update", config, apply });
  } catch {
    // The background restarted (e.g. SimpleBlock was updated); this popup is about to close.
  }
}

function select(id) {
  selectedId = id;
  resetDeleteConfirm();
  renderTabs();
  renderPanel();
  browser.storage.local.set({ [UI_KEY]: { selectedRuleset: id } });
}

function uniqueName(base) {
  const names = new Set(config.rulesets.map((set) => set.name));
  for (let n = 1; ; n++) {
    const name = n === 1 ? base : `${base} ${n}`;
    if (!names.has(name)) return name;
  }
}

/* ---------- Rendering ---------- */

function render() {
  renderMaster();
  renderTabs();
  renderPanel();
}

function renderMaster() {
  els.master.checked = config.enabled;
  document.body.classList.toggle("is-paused", !config.enabled);
  els.pausedNote.textContent = config.enabled ? "" : "Blocking is paused.";
}

function renderTabs() {
  els.tabs.replaceChildren(
    ...config.rulesets.map((set) => {
      const tab = els.tabTemplate.content.firstElementChild.cloneNode(true);
      const selected = set.id === selectedId;
      tab.id = `tab-${set.id}`;
      tab.dataset.id = set.id;
      tab.setAttribute("aria-controls", "panel");
      tab.setAttribute("aria-selected", String(selected));
      tab.tabIndex = selected ? 0 : -1;
      updateTab(tab, set);
      return tab;
    }),
  );
  if (selectedId) els.panel.setAttribute("aria-labelledby", `tab-${selectedId}`);
  else els.panel.removeAttribute("aria-labelledby");
  $(`tab-${selectedId}`)?.scrollIntoView({ block: "nearest", inline: "nearest" });
  updateTabFades();
}

/** Fades whichever end of the ruleset strip has more tabs scrolled out of view. */
function updateTabFades() {
  const { scrollLeft, scrollWidth, clientWidth } = els.tabs;
  const fades = [];
  if (scrollLeft > 1) fades.push("start");
  if (scrollLeft + clientWidth < scrollWidth - 1) fades.push("end");
  els.tabs.dataset.fade = fades.join(" ");
}

function updateTab(tab, set) {
  const count = set.rules.filter((rule) => rule.block.trim()).length;
  tab.classList.toggle("is-off", !set.enabled);
  tab.title = `${set.name}${set.enabled ? "" : " (off)"}: ${count} ${count === 1 ? "rule" : "rules"}`;
  tab.querySelector(".tab-name").textContent = set.name;
  tab.querySelector(".tab-count").textContent = count ? String(count) : "";
}

function updateCurrentTab() {
  const set = currentRuleset();
  if (!set) return;
  updateTab($(`tab-${selectedId}`), set);
  updateTabFades();
}

function renderPanel() {
  const set = currentRuleset();
  // Every ruleset can be deleted, so there may be none to show.
  els.panel.classList.toggle("is-empty", !set);
  els.noRulesets.hidden = Boolean(set);
  if (!set) {
    els.rules.replaceChildren();
    return;
  }
  els.name.value = set.name;
  els.rulesetEnabled.checked = set.enabled;
  els.panel.classList.toggle("is-off", !set.enabled);
  els.rules.replaceChildren(...set.rules.map(renderRule));
  refreshMessages();
}

function renderRule(rule, index) {
  const row = els.ruleTemplate.content.firstElementChild.cloneNode(true);
  row.dataset.id = rule.id;
  row.classList.toggle("is-off", !rule.enabled);

  const toggle = row.querySelector("input[type=checkbox]");
  toggle.checked = rule.enabled;
  toggle.setAttribute("aria-label", `Use rule ${index + 1}`);

  const block = row.querySelector(".field--block");
  block.value = rule.block;
  block.setAttribute("aria-label", `Rule ${index + 1}: block`);

  row.querySelector(".rule-error").id = `error-${rule.id}`;
  row.querySelector(".rule-hint").id = `hint-${rule.id}`;

  const redirect = row.querySelector(".field--redirect");
  redirect.value = rule.redirect;
  redirect.setAttribute("aria-label", `Rule ${index + 1}: redirect to`);

  row.querySelector(".rule-remove").setAttribute("aria-label", `Remove rule ${index + 1}`);
  return row;
}

/** Shows each row's problems, or a hint explaining the focused pattern. */
function refreshMessages() {
  const set = currentRuleset();
  // Ignore the master switch so problems are still pointed out while paused.
  const activeRules = compileConfig(config, { ignoreMaster: true });

  for (const row of els.rules.children) {
    const rule = findRule(row.dataset.id);
    const blockField = row.querySelector(".field--block");
    const redirectField = row.querySelector(".field--redirect");
    let blockError = "";
    let redirectError = "";
    let hint = "";

    const pattern = compilePattern(rule.block);
    const redirect = parseRedirect(rule.redirect);
    if (!rule.block.trim()) {
      // A fresh row: nothing to complain about yet.
    } else if (!pattern.ok) {
      blockError = pattern.error;
    } else if (!redirect.ok) {
      redirectError = `${redirect.error}.`;
    } else if (redirect.url && set.enabled && rule.enabled) {
      const blocker = findBlock(activeRules, redirect.url);
      if (blocker) redirectError = describeBlockedRedirect(rule, blocker, redirect.url);
    }
    if (pattern.ok && rule.id === hintRuleId) hint = describeScope(pattern);

    // Don't flag a half-typed rule mid-keystroke: a new error waits until typing
    // pauses (see the input handler), but one already showing keeps updating.
    if (rule.id === typingRuleId && row.querySelector(".rule-error").hidden) {
      blockError = "";
      redirectError = "";
    }
    if (blockError || redirectError) hint = "";
    markField(blockField, blockError, [blockError && `error-${rule.id}`, hint && `hint-${rule.id}`]);
    markField(redirectField, redirectError, [redirectError && `error-${rule.id}`]);
    setMessage(row.querySelector(".rule-error"), blockError || redirectError);
    setMessage(row.querySelector(".rule-hint"), hint);
  }
}

function markField(field, error, describedBy) {
  field.classList.toggle("is-invalid", Boolean(error));
  toggleAttribute(field, "aria-invalid", error ? "true" : "");
  toggleAttribute(field, "aria-describedby", describedBy.filter(Boolean).join(" "));
}

function toggleAttribute(element, name, value) {
  if (value) element.setAttribute(name, value);
  else element.removeAttribute(name);
}

function describeScope({ scope, site }) {
  switch (scope) {
    case "homepage":
      return "Homepage only. Add * to block the whole site.";
    case "site":
      return `Blocks all of ${site}.`;
    case "page":
      return "Blocks only this page.";
    default:
      return "Blocks pages matching this pattern.";
  }
}

/** Why a redirect target would itself be blocked (the SimpleBlock page is shown instead). */
function describeBlockedRedirect(rule, blocker, redirectUrl) {
  if (blocker.rule.id !== rule.id) {
    const where = blocker.ruleset.id === selectedId ? "" : ` in ${blocker.ruleset.name}`;
    return `Blocked by your “${blocker.rule.block.trim()}” rule${where}.`;
  }
  // Usually a whole-site rule redirecting within its own site: would dropping the * fix it?
  const narrower = compilePattern(rule.block.trim().replace(/\/?\*$/, ""));
  return narrower.ok && !narrower.test(parseUrl(redirectUrl))
    ? "Blocked by this rule too. Remove the * to allow it."
    : "Blocked by this rule too. Pick another page.";
}

function setMessage(element, text) {
  element.textContent = text;
  element.hidden = !text;
}

/* ---------- Events ---------- */

function bindEvents() {
  els.master.addEventListener("change", () => {
    config.enabled = els.master.checked;
    renderMaster();
    push(true);
  });

  els.help.addEventListener("click", async () => {
    await browser.tabs.create({ url: browser.runtime.getURL("pages/help.html") });
    window.close();
  });

  els.settings.addEventListener("click", () => {
    browser.runtime
      .openOptionsPage()
      // Should never be needed, but a dead button is worse than a plain tab.
      .catch(() => browser.tabs.create({ url: browser.runtime.getURL("options/options.html") }))
      .finally(() => window.close());
  });

  bindRulesetEvents();
  bindRuleEvents();
}

function bindRulesetEvents() {
  els.tabs.addEventListener("click", (event) => {
    const tab = event.target.closest(".tab");
    if (tab && tab.dataset.id !== selectedId) select(tab.dataset.id);
  });

  els.tabs.addEventListener("dblclick", (event) => {
    if (event.target.closest(".tab")) els.name.select();
  });

  els.tabs.addEventListener("scroll", updateTabFades, { passive: true });

  // Let a mouse wheel scroll a row of rulesets that's wider than the popup.
  els.tabs.addEventListener(
    "wheel",
    (event) => {
      if (!event.deltaY || els.tabs.scrollWidth <= els.tabs.clientWidth) return;
      els.tabs.scrollLeft += event.deltaY * (event.deltaMode === WheelEvent.DOM_DELTA_LINE ? 20 : 1);
      event.preventDefault();
    },
    { passive: false },
  );

  // Arrow keys move between tabs, as in any tab list.
  els.tabs.addEventListener("keydown", (event) => {
    const tabs = [...els.tabs.querySelectorAll(".tab")];
    const index = tabs.indexOf(document.activeElement);
    if (index === -1) return;
    const targets = {
      ArrowRight: index + 1,
      ArrowDown: index + 1,
      ArrowLeft: index - 1,
      ArrowUp: index - 1,
      Home: 0,
      End: tabs.length - 1,
    };
    if (!(event.key in targets)) return;
    event.preventDefault();
    const next = tabs[(targets[event.key] + tabs.length) % tabs.length];
    select(next.dataset.id);
    $(`tab-${next.dataset.id}`).focus();
  });

  els.addRuleset.addEventListener("click", () => {
    addRuleset();
    push(true);
    els.name.select();
  });

  els.name.addEventListener("input", () => {
    currentRuleset().name = els.name.value;
    updateCurrentTab();
    push(false);
  });

  const commitName = () => {
    const set = currentRuleset();
    set.name = els.name.value.trim() || "Untitled";
    els.name.value = set.name;
    updateCurrentTab();
    push(true);
  };
  els.name.addEventListener("change", commitName);
  els.name.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing) commitName();
  });

  els.rulesetEnabled.addEventListener("change", () => {
    const set = currentRuleset();
    set.enabled = els.rulesetEnabled.checked;
    els.panel.classList.toggle("is-off", !set.enabled);
    updateCurrentTab();
    refreshMessages();
    push(true);
  });

  // Deleting takes two clicks; the button asks for confirmation in between.
  els.deleteRuleset.addEventListener("click", () => {
    if (!els.deleteRuleset.classList.contains("is-confirming")) {
      els.deleteRuleset.classList.add("is-confirming");
      els.deleteRuleset.setAttribute("aria-label", "Click again to delete this category");
      deleteTimer = setTimeout(resetDeleteConfirm, 3000);
      return;
    }
    const index = config.rulesets.findIndex((set) => set.id === selectedId);
    config.rulesets.splice(index, 1);
    select(config.rulesets[Math.max(0, index - 1)]?.id ?? null);
    push(true);
    ($(`tab-${selectedId}`) ?? els.addRuleset).focus();
  });
  els.deleteRuleset.addEventListener("blur", resetDeleteConfirm);
}

function resetDeleteConfirm() {
  clearTimeout(deleteTimer);
  els.deleteRuleset.classList.remove("is-confirming");
  els.deleteRuleset.setAttribute("aria-label", "Delete category");
}

function addRuleset() {
  const set = createRuleset(uniqueName("New category"));
  config.rulesets.push(set);
  select(set.id);
  return set;
}

function showTypingErrors() {
  clearTimeout(typingTimer);
  typingRuleId = null;
  refreshMessages();
}

function bindRuleEvents() {
  els.addRule.addEventListener("click", () => {
    // With no rulesets left, "Add rule" starts a new one rather than doing nothing.
    const set = currentRuleset() ?? addRuleset();
    const rule = createRule();
    set.rules.push(rule);
    const row = renderRule(rule, set.rules.length - 1);
    els.rules.append(row);
    row.querySelector(".field--block").focus();
    push(false);
  });

  els.rules.addEventListener("input", (event) => {
    const row = event.target.closest(".rule");
    if (!row || event.target.type !== "text") return;
    const rule = findRule(row.dataset.id);
    rule.block = row.querySelector(".field--block").value;
    rule.redirect = row.querySelector(".field--redirect").value;
    updateCurrentTab();
    typingRuleId = rule.id;
    clearTimeout(typingTimer);
    typingTimer = setTimeout(showTypingErrors, ERROR_DELAY_MS);
    refreshMessages();
    push(false);
  });

  els.rules.addEventListener("change", (event) => {
    const row = event.target.closest(".rule");
    if (!row) return;
    // Leaving the field (or Enter) shows any error straight away.
    if (event.target.type === "text") showTypingErrors();
    if (event.target.type === "checkbox") {
      findRule(row.dataset.id).enabled = event.target.checked;
      row.classList.toggle("is-off", !event.target.checked);
      refreshMessages();
    }
    push(true);
  });

  els.rules.addEventListener("click", (event) => {
    const button = event.target.closest(".rule-remove");
    if (!button) return;
    const row = button.closest(".rule");
    const set = currentRuleset();
    const index = set.rules.findIndex((rule) => rule.id === row.dataset.id);
    set.rules.splice(index, 1);
    renderPanel();
    updateCurrentTab();
    push(true);
    // Keep keyboard focus nearby instead of dropping it on the body.
    const next = els.rules.children[Math.min(index, els.rules.children.length - 1)];
    (next?.querySelector(".rule-remove") ?? els.addRule).focus();
  });

  // Enter commits a rule, like leaving the field does.
  els.rules.addEventListener("keydown", (event) => {
    if (event.key === "Enter" && !event.isComposing && event.target.type === "text") {
      showTypingErrors();
      push(true);
    }
  });

  // Explain the pattern being edited ("only the homepage", "the whole site", ...).
  // The hint stays put until another text field takes focus: hiding it on blur
  // would shift the layout under the pointer and swallow clicks on the buttons.
  els.panel.addEventListener("focusin", (event) => {
    if (event.target.type !== "text") return;
    const row = event.target.closest(".rule");
    const next = event.target.classList.contains("field--block") || row?.dataset.id === hintRuleId ? row.dataset.id : null;
    if (next === hintRuleId) return;
    hintRuleId = next;
    refreshMessages();
  });
}

/* ---------- Theme ---------- */

// Storing and applying the choice is shared/theme.js's job (it explains why it
// uses localStorage); this just drives the button.
const systemDark = matchMedia("(prefers-color-scheme: dark)");

function systemTheme() {
  return systemDark.matches ? "dark" : "light";
}

// Tracked here rather than read back from the page: with view transitions the
// page switches a moment after the click.
let chosenTheme = document.documentElement.dataset.scheme ?? null;

function currentTheme() {
  return chosenTheme ?? systemTheme();
}

function renderThemeToggle() {
  const dark = currentTheme() === "dark";
  els.themeToggle.setAttribute("aria-pressed", String(dark));
  els.themeToggle.title = dark ? "Switch to light theme" : "Switch to dark theme";
}

function bindThemeToggle() {
  els.themeToggle.addEventListener("click", () => {
    const next = currentTheme() === "dark" ? "light" : "dark";
    // Choosing the theme Firefox is already using means "follow Firefox" again.
    chosenTheme = next === systemTheme() ? null : next;
    globalThis.setSimpleBlockTheme(chosenTheme);
    renderThemeToggle();
  });
  systemDark.addEventListener("change", renderThemeToggle);
  renderThemeToggle();
}

// Works straight away, without waiting for the config.
bindThemeToggle();
