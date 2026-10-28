// Exercises background/background.js against a fake `browser` object.
// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";

const BLOCKED = "moz-extension://uuid/pages/blocked.html";
const EXTENSION_ID = "simpleblock@test";

function makeEvent() {
  const listeners = [];
  return {
    listeners,
    addListener: (fn) => listeners.push(fn),
    emit: (...args) => Promise.all(listeners.map((fn) => fn(...args))),
  };
}

function makeLocalStorage(entries = {}) {
  const map = new Map(Object.entries(entries));
  return {
    getItem: (key) => (map.has(key) ? map.get(key) : null),
    removeItem: (key) => map.delete(key),
    keys: () => [...map.keys()],
  };
}

const settle = () => new Promise((resolve) => setTimeout(resolve, 5));

let instance = 0;

/** Loads a fresh copy of the background script with the given storage and tabs. */
async function startBackground({ config, legacy = {}, tabs = [], failGet = false, failSet = false } = {}) {
  const stored = config ? { config: structuredClone(config) } : {};
  const tabsById = new Map(
    tabs.map((tab) => [tab.id, { active: false, audible: false, discarded: false, mutedInfo: { muted: false }, ...tab }]),
  );
  const updates = [];

  globalThis.localStorage = makeLocalStorage(legacy);
  globalThis.browser = {
    runtime: { id: EXTENSION_ID, getURL: (path) => `moz-extension://uuid/${path}`, onConnect: makeEvent() },
    storage: {
      local: {
        get: async (key) => {
          if (failGet) throw new Error("storage is broken");
          return key in stored ? { [key]: structuredClone(stored[key]) } : {};
        },
        set: async (values) => {
          if (failSet) throw new Error("storage is full");
          Object.assign(stored, structuredClone(values));
        },
      },
    },
    webNavigation: { onBeforeNavigate: makeEvent(), onCommitted: makeEvent(), onHistoryStateUpdated: makeEvent() },
    tabs: {
      TAB_ID_NONE: -1,
      onActivated: makeEvent(),
      onAttached: makeEvent(),
      onUpdated: makeEvent(),
      onRemoved: makeEvent(),
      query: async (filter) =>
        [...tabsById.values()]
          .filter((tab) => Object.entries(filter).every(([key, value]) => tab[key] === value))
          .map((tab) => structuredClone(tab)),
      get: async (id) => {
        if (!tabsById.has(id)) throw new Error(`no tab ${id}`);
        return structuredClone(tabsById.get(id));
      },
      update: async (id, props) => {
        const tab = tabsById.get(id);
        if (!tab) throw new Error(`no tab ${id}`);
        updates.push({ id, ...props });
        if ("url" in props) tab.url = props.url;
        if ("muted" in props) {
          tab.mutedInfo = props.muted ? { muted: true, reason: "extension", extensionId: EXTENSION_ID } : { muted: false };
        }
        return structuredClone(tab);
      },
    },
  };

  await import(`../background/background.js?instance=${++instance}`);
  await settle();
  const b = globalThis.browser;
  return {
    stored,
    tabsById,
    updates,
    localStorage: globalThis.localStorage,
    navigate: (event, details) => b.webNavigation[event].emit({ frameId: 0, ...details }),
    connectPopup() {
      const port = { name: "popup", sent: [], onMessage: makeEvent(), onDisconnect: makeEvent() };
      port.postMessage = (message) => port.sent.push(structuredClone(message));
      b.runtime.onConnect.emit(port);
      return port;
    },
    activate: (tabId) => b.tabs.onActivated.emit({ tabId }),
  };
}

function config(rules, { enabled = true } = {}) {
  return {
    schema: 2,
    enabled,
    rulesets: [
      {
        id: "focus",
        name: "Focus",
        enabled: true,
        rules: rules.map(([block, redirect = ""], i) => ({ id: `r${i}`, block, redirect, enabled: true })),
      },
    ],
  };
}

function blockedParams(url) {
  assert.ok(url.startsWith(BLOCKED), `expected the blocked page, got ${url}`);
  return Object.fromEntries(new URL(url).searchParams);
}

test("migrates 1.x rules from localStorage, leaving 1.x's copy in place", async () => {
  const bg = await startBackground({
    legacy: {
      ruleset: JSON.stringify([
        { block: "x.com", redirect: "" },
        { block: "facebook.com", redirect: "facebook.com/messages" },
        { block: "   ", redirect: "" },
      ]),
      enabled: "false",
    },
  });
  const saved = bg.stored.config;
  assert.equal(saved.enabled, false);
  assert.deepEqual(saved.rulesets.map((set) => set.name), ["Focus"]);
  assert.deepEqual(
    saved.rulesets[0].rules.map(({ block, redirect, enabled }) => ({ block, redirect, enabled })),
    [
      { block: "x.com", redirect: "", enabled: true },
      { block: "facebook.com", redirect: "facebook.com/messages", enabled: true },
    ],
  );
  assert.deepEqual(bg.localStorage.keys(), ["ruleset", "enabled"]);
});

test("fresh installs start with one empty, active ruleset called Focus", async () => {
  const bg = await startBackground();
  const sets = bg.stored.config.rulesets;
  assert.deepEqual(sets.map(({ name, enabled, rules }) => ({ name, enabled, rules })), [{ name: "Focus", enabled: true, rules: [] }]);
});

test("every ruleset can be deleted, and stays deleted", async () => {
  const bg = await startBackground({
    config: config([["x.com*"]]),
    tabs: [{ id: 1, url: "https://example.org/", active: true }],
  });
  const popup = bg.connectPopup();
  await settle();
  popup.onMessage.emit({ type: "update", config: { schema: 2, enabled: true, rulesets: [] }, apply: true });
  await settle();
  assert.deepEqual(bg.stored.config.rulesets, []);
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/" });
  assert.equal(bg.updates.length, 0);

  // ...including across a restart.
  const restarted = await startBackground({ config: bg.stored.config });
  assert.deepEqual(restarted.stored.config.rulesets, []);
});

test("blocks navigations by detouring through the blocked page", async () => {
  const bg = await startBackground({
    config: config([["x.com*"], ["facebook.com", "facebook.com/messages"]]),
    tabs: [{ id: 1, url: "https://example.org/", active: true }],
  });

  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://www.phoronix.com/" });
  assert.equal(bg.updates.length, 0, "phoronix.com must not match x.com");

  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/home#top" });
  assert.equal(bg.updates.length, 1);
  assert.equal(bg.updates[0].loadReplace, false, "the previous page stays in history");
  assert.deepEqual(blockedParams(bg.updates[0].url), { url: "https://x.com/home#top", rule: "x.com*", set: "Focus" });

  // The same navigation reported again on commit isn't handled twice.
  await bg.navigate("onCommitted", { tabId: 1, url: "https://x.com/home#top" });
  assert.equal(bg.updates.length, 1);

  // Redirect rules go through the blocked page too, which forwards immediately.
  await bg.navigate("onCommitted", { tabId: 1, url: bg.updates[0].url });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://www.facebook.com/" });
  assert.equal(bg.updates.length, 2);
  assert.equal(blockedParams(bg.updates[1].url).to, "https://facebook.com/messages");

  // Sub-frames and non-tab loads are ignored.
  await bg.navigate("onBeforeNavigate", { tabId: 1, frameId: 3, url: "https://x.com/embed" });
  await bg.navigate("onBeforeNavigate", { tabId: -1, url: "https://x.com/" });
  assert.equal(bg.updates.length, 2);
});

test("a redirect to a page that is itself blocked shows the blocked page instead", async () => {
  const bg = await startBackground({
    config: config([["facebook.com*", "facebook.com/messages"]]),
    tabs: [{ id: 1, url: "https://example.org/", active: true }],
  });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://facebook.com/" });
  assert.equal(blockedParams(bg.updates[0].url).to, undefined);
});

test("server redirects and in-page navigations are caught after they commit", async () => {
  const bg = await startBackground({
    config: config([["x.com*"], ["facebook.com"]]),
    tabs: [{ id: 1, url: "https://t.co/abc", active: true }],
  });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://t.co/abc" });
  assert.equal(bg.updates.length, 0);
  await bg.navigate("onCommitted", { tabId: 1, url: "https://x.com/someone/status/1" });
  assert.equal(bg.updates.length, 1);
  assert.equal(bg.updates[0].loadReplace, true, "the blocked page replaces the committed one");

  // A single-page app moving to a blocked URL with history.pushState().
  await bg.navigate("onCommitted", { tabId: 1, url: "https://www.facebook.com/messages" });
  await bg.navigate("onHistoryStateUpdated", { tabId: 1, url: "https://www.facebook.com/" });
  assert.equal(bg.updates.length, 2);
  assert.equal(blockedParams(bg.updates[1].url).url, "https://www.facebook.com/");
  assert.equal(bg.updates[1].loadReplace, true);
});

test("visiting a blocked URL again right after it was blocked is blocked again", async () => {
  const bg = await startBackground({
    config: config([["x.com*"]]),
    tabs: [{ id: 1, url: "https://example.org/", active: true }],
  });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/" });
  await bg.navigate("onCommitted", { tabId: 1, url: bg.updates[0].url });
  await bg.navigate("onCommitted", { tabId: 1, url: "https://example.org/" }); // "Go back"
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/" });
  assert.equal(bg.updates.length, 2, "the 2-second de-duplication must not let this through");
});

test("navigating away from a blocked page replaces it rather than stacking another", async () => {
  const bg = await startBackground({
    config: config([["x.com*"]]),
    tabs: [{ id: 1, url: `${BLOCKED}?url=https%3A%2F%2Fx.com%2F`, active: true }],
  });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/explore" });
  assert.equal(bg.updates.at(-1).loadReplace, true);
});

test("reloading a blocked page replaces its history entry", async () => {
  const bg = await startBackground({
    config: config([["reddit.com*"]], { enabled: false }),
    tabs: [{ id: 1, url: "https://www.reddit.com/r/linux/", active: false }],
  });
  const popup = bg.connectPopup();
  await settle();
  popup.onMessage.emit({ type: "update", config: config([["reddit.com*"]]), apply: false });
  await settle();
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://www.reddit.com/r/linux/" });
  assert.equal(bg.updates.at(-1).loadReplace, true);
});

test("covers, mutes and restores open tabs as settings change", async () => {
  const bg = await startBackground({
    config: config([["reddit.com*"], ["youtube.com/watch"]], { enabled: false }),
    tabs: [
      { id: 1, url: "https://www.reddit.com/r/all", active: true },
      { id: 2, url: "https://www.youtube.com/watch?v=abc", audible: true },
      { id: 3, url: "https://old.reddit.com/", discarded: true },
      { id: 4, url: "https://example.org/" },
    ],
  });
  assert.equal(bg.updates.length, 0, "nothing happens while blocking is off");

  const popup = bg.connectPopup();
  await settle();
  assert.equal(popup.sent[0].type, "init");
  assert.equal(popup.sent[0].config.enabled, false);

  // Keystrokes don't touch open tabs...
  popup.onMessage.emit({ type: "update", config: config([["reddit.com*"], ["youtube.com/watch"]]), apply: false });
  await settle();
  assert.equal(bg.updates.length, 0);

  // ...committing does: the visible tab is covered, the noisy background tab muted,
  // and the discarded and unrelated tabs are left alone.
  popup.onMessage.emit({ type: "update", config: config([["reddit.com*"], ["youtube.com/watch"]]), apply: true });
  await settle();
  assert.equal(bg.stored.config.enabled, true);
  const [cover, mute] = [bg.updates.find((u) => u.id === 1), bg.updates.find((u) => u.id === 2)];
  assert.equal(cover.loadReplace, true);
  assert.equal(blockedParams(cover.url).url, "https://www.reddit.com/r/all");
  assert.equal(mute.muted, true);
  assert.equal(mute.url, undefined, "background tabs aren't reloaded");
  assert.ok(!bg.updates.some((u) => u.id === 3 || u.id === 4));

  // Switching to the muted tab covers it.
  bg.tabsById.get(2).active = true;
  bg.tabsById.get(1).active = false;
  await bg.activate(2);
  await settle();
  const coverTwo = bg.updates.findLast((u) => u.id === 2);
  assert.equal(blockedParams(coverTwo.url).url, "https://www.youtube.com/watch?v=abc");

  // The blocked page loading unmutes the tab, so the page comes back with sound.
  await bg.navigate("onCommitted", { tabId: 2, url: coverTwo.url });
  await settle();
  assert.equal(bg.tabsById.get(2).mutedInfo.muted, false);

  // Pausing restores every covered tab to its page.
  bg.updates.length = 0;
  popup.onMessage.emit({ type: "update", config: config([["reddit.com*"], ["youtube.com/watch"]], { enabled: false }), apply: true });
  await settle();
  assert.deepEqual(
    bg.updates.map(({ id, url, loadReplace }) => ({ id, url, loadReplace })).sort((a, b) => a.id - b.id),
    [
      { id: 1, url: "https://www.reddit.com/r/all", loadReplace: true },
      { id: 2, url: "https://www.youtube.com/watch?v=abc", loadReplace: true },
    ],
  );
});

test("closing the popup saves and applies the last edit", async () => {
  const bg = await startBackground({
    config: config([]),
    tabs: [{ id: 1, url: "https://news.ycombinator.com/", active: true }],
  });
  const popup = bg.connectPopup();
  await settle();
  popup.onMessage.emit({ type: "update", config: config([["news.ycombinator.com"]]), apply: false });
  await settle();
  assert.equal(bg.updates.length, 0);
  popup.onDisconnect.emit();
  await settle();
  assert.equal(bg.stored.config.rulesets[0].rules[0].block, "news.ycombinator.com");
  assert.equal(blockedParams(bg.updates[0].url).url, "https://news.ycombinator.com/");
});

test("a tab we muted is unmuted once it moves on to an allowed page", async () => {
  const bg = await startBackground({
    config: config([["youtube.com*"]]),
    tabs: [{ id: 1, url: "https://youtube.com/watch?v=1", audible: true }],
  });
  assert.equal(bg.tabsById.get(1).mutedInfo.muted, true);
  bg.tabsById.get(1).url = "https://example.org/";
  await bg.navigate("onCommitted", { tabId: 1, url: "https://example.org/" });
  await settle();
  assert.equal(bg.tabsById.get(1).mutedInfo.muted, false);
});

test("blocked pages that are mid-redirect, or point at non-web URLs, aren't restored", async () => {
  const to = encodeURIComponent("https://facebook.com/messages");
  const bg = await startBackground({
    config: config([], { enabled: false }),
    tabs: [
      { id: 1, url: `${BLOCKED}?url=https%3A%2F%2Ffacebook.com%2F&to=${to}`, active: true },
      { id: 2, url: `${BLOCKED}?url=javascript%3Aalert(1)` },
    ],
  });
  assert.deepEqual(bg.updates, []);
});

test("if settings can't be read, nothing is ever saved over them", async () => {
  const bg = await startBackground({ config: config([["x.com"]]), failGet: true });
  const popup = bg.connectPopup();
  await settle();
  popup.onMessage.emit({ type: "update", config: config([]), apply: true });
  await settle();
  assert.equal(bg.stored.config.rulesets[0].rules[0].block, "x.com");
});

test("if migrated rules can't be saved, they're still used", async () => {
  const bg = await startBackground({
    legacy: { ruleset: JSON.stringify([{ block: "x.com*", redirect: "" }]) },
    tabs: [{ id: 1, url: "https://example.org/", active: true }],
    failSet: true,
  });
  await bg.navigate("onBeforeNavigate", { tabId: 1, url: "https://x.com/" });
  assert.equal(bg.updates.length, 1);
});

test("tabs the user muted are never unmuted", async () => {
  const bg = await startBackground({
    config: config([["youtube.com*"]]),
    tabs: [{ id: 1, url: "https://youtube.com/watch?v=1", audible: true, mutedInfo: { muted: true, reason: "user" } }],
  });
  assert.equal(bg.updates.length, 0);
  const popup = bg.connectPopup();
  await settle();
  popup.onMessage.emit({ type: "update", config: config([["youtube.com*"]], { enabled: false }), apply: true });
  await settle();
  assert.equal(bg.updates.length, 0, "a tab the user muted isn't unmuted");
});
