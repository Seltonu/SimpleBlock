/**
 * The saved configuration: its shape, defaults, storage and the compiled form
 * used to decide whether a URL is blocked.
 *
 * Everything lives under one storage.local key so a change is a single atomic
 * write and one storage.onChanged event:
 *
 *   {
 *     schema: 2,
 *     enabled: true,                 // the master switch
 *     rulesets: [{
 *       id, name, enabled,
 *       rules: [{ id, block, redirect, enabled }],
 *     }],
 *   }
 *
 * Rules keep the text exactly as typed; it is only interpreted when compiled.
 * Rulesets are called "categories" everywhere users can see.
 */

import { compilePattern, parseRedirect, parseUrl } from "./patterns.js";

export const CONFIG_KEY = "config";
export const UI_KEY = "ui";
// Options from the settings page, kept apart from the rules: { keepPages }.
export const SETTINGS_KEY = "settings";
const SCHEMA = 2;

export function newId() {
  return crypto.randomUUID();
}

export function createRule(fields = {}) {
  return { id: newId(), block: "", redirect: "", enabled: true, ...fields };
}

export function createRuleset(name, fields = {}) {
  return { id: newId(), name, enabled: true, rules: [], ...fields };
}

export function defaultConfig() {
  return { schema: SCHEMA, enabled: true, rulesets: [createRuleset("Focus")] };
}

/** Coerces anything read from storage into a well-formed config. An empty list of rulesets is allowed. */
export function normalizeConfig(raw) {
  if (!raw || typeof raw !== "object" || !Array.isArray(raw.rulesets)) return defaultConfig();

  const seen = new Set();
  const uniqueId = (id) => {
    const value = typeof id === "string" && id && !seen.has(id) ? id : newId();
    seen.add(value);
    return value;
  };

  const rulesets = raw.rulesets
    .filter((set) => set && typeof set === "object")
    .map((set) => ({
      id: uniqueId(set.id),
      name: typeof set.name === "string" && set.name.trim() ? set.name : "Untitled",
      enabled: set.enabled !== false,
      rules: (Array.isArray(set.rules) ? set.rules : [])
        .filter((rule) => rule && typeof rule === "object")
        .map((rule) => ({
          id: uniqueId(rule.id),
          block: typeof rule.block === "string" ? rule.block : "",
          redirect: typeof rule.redirect === "string" ? rule.redirect : "",
          enabled: rule.enabled !== false,
        })),
    }));

  return { schema: SCHEMA, enabled: raw.enabled !== false, rulesets };
}

/** Settings page options, with defaults for anything missing. */
export function normalizeSettings(raw) {
  return { keepPages: raw?.keepPages === true };
}

export function saveConfig(config) {
  return browser.storage.local.set({ [CONFIG_KEY]: config });
}

/**
 * Builds a config from the pre-2.0 localStorage format:
 * "ruleset" = JSON [{ block, redirect }], "enabled" = "true" | "false".
 * The old rules go into the default "Focus" ruleset. Returns null when there
 * is nothing to migrate.
 */
export function configFromLegacy(storage) {
  let legacyRules;
  try {
    legacyRules = JSON.parse(storage.getItem("ruleset"));
  } catch {
    legacyRules = null;
  }
  const legacyEnabled = storage.getItem("enabled");
  if (!Array.isArray(legacyRules) && legacyEnabled === null) return null;

  const config = defaultConfig();
  config.enabled = legacyEnabled !== "false";
  config.rulesets[0].rules = (Array.isArray(legacyRules) ? legacyRules : [])
    .filter((rule) => rule && typeof rule.block === "string" && rule.block.trim())
    .map((rule) => createRule({ block: rule.block, redirect: typeof rule.redirect === "string" ? rule.redirect : "" }));
  return config;
}

/**
 * Compiles the rules that are currently in force.
 * With `ignoreMaster`, the master switch is treated as on (the popup uses this
 * so it can still warn about rule problems while blocking is paused).
 */
export function compileConfig(config, { ignoreMaster = false } = {}) {
  const active = [];
  if (config.enabled || ignoreMaster) {
    for (const ruleset of config.rulesets) {
      if (!ruleset.enabled) continue;
      for (const rule of ruleset.rules) {
        if (!rule.enabled) continue;
        const pattern = compilePattern(rule.block);
        if (!pattern.ok) continue;
        const redirect = parseRedirect(rule.redirect);
        active.push({ rule, ruleset, test: pattern.test, redirectUrl: redirect.ok ? redirect.url : null });
      }
    }
  }
  return active;
}

/**
 * Decides what should happen to a URL.
 * @returns {null | { rule, ruleset, redirectUrl: string | null }}
 *   null when the URL is allowed; otherwise the first matching rule, with
 *   redirectUrl null meaning "show the SimpleBlock page". A redirect whose
 *   target is itself blocked falls back to the SimpleBlock page, which is what
 *   stops rules like facebook.com* -> facebook.com/messages from looping.
 */
export function findBlock(compiled, href) {
  const match = firstMatch(compiled, href);
  if (!match) return null;
  const redirectUrl = match.redirectUrl && !firstMatch(compiled, match.redirectUrl) ? match.redirectUrl : null;
  return { rule: match.rule, ruleset: match.ruleset, redirectUrl };
}

function firstMatch(compiled, href) {
  if (compiled.length === 0) return null;
  const url = parseUrl(href);
  return url ? compiled.find((entry) => entry.test(url)) ?? null : null;
}
