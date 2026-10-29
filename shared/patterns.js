/**
 * Block patterns and redirect targets: parsing, validation and URL matching.
 *
 * Pure functions with no browser APIs, so the background script and popup
 * share it and it can be unit-tested under Node.
 *
 * Pattern syntax (case-insensitive; "http(s)://" and a leading "www." are ignored):
 *
 *   example.com             the homepage of example.com (or any subdomain)
 *   example.com*            everything on example.com
 *   example.com/*           same as above
 *   example.com/page        exactly that page (trailing "/", query and #hash ignored)
 *   example.com/page*       anything whose path starts with "/page"
 *   example.com/page/*      "/page" itself and everything below it
 *   example.com/*.pdf       "*" matches any characters, anywhere
 *   example.com/watch?v=x   only when the URL has v=x (other parameters may be present)
 *   reddit.*                reddit on any top-level domain
 *
 * Sites match on whole domain labels: "x.com" matches x.com and mobile.x.com,
 * but never phoronix.com.
 */

const SCHEME = /^[a-z][a-z0-9+.-]*:\/\//i;
const ASCII_HOST = /^[a-z0-9_*-]+(?:\.[a-z0-9_*-]+)*$/;

/**
 * Compiles a block pattern.
 * `scope` says how much of the site it covers, so the popup can explain it:
 * "homepage", "site" (everything), "page" (one exact path) or "pattern".
 * @returns {{ ok: true, site: string, scope: string, test: (url: UrlParts) => boolean }
 *         | { ok: false, error: string }}
 */
export function compilePattern(text) {
  let rest = String(text ?? "").trim().toLowerCase().replace(SCHEME, "").replace(/#.*$/, "");
  if (!rest) return { ok: false, error: "Enter a site, like example.com" };

  const hostEnd = rest.search(/[/?]/);
  let host = hostEnd === -1 ? rest : rest.slice(0, hostEnd);
  let tail = hostEnd === -1 ? "" : rest.slice(hostEnd);

  // "example.com*" is shorthand for the whole site; "reddit.*" for reddit on any TLD.
  if (!tail && host.endsWith("*")) {
    host = host.slice(0, -1);
    tail = "/*";
    if (host.endsWith(".")) host += "*";
  }

  host = host.replace(/^\*\./, "").replace(/^www\./, "").replace(/\.$/, "");

  let port = "";
  const portMatch = host.match(/:(\d{1,5})$/);
  if (portMatch) {
    port = portMatch[1];
    host = host.slice(0, portMatch.index);
  }

  // Rejecting a bare "*" also means a half-typed rule can't briefly block everything.
  if (!/[\p{L}\p{N}]/u.test(host)) return { ok: false, error: "Enter a site, like example.com" };
  if (!ASCII_HOST.test(host)) {
    // Internationalised domains are converted to punycode, as in real URLs.
    host = /[^\x00-\x7f]/.test(host) && !host.includes("*") ? toAsciiHost(host) : "";
    if (!host || !ASCII_HOST.test(host)) return { ok: false, error: "Not a valid web address" };
  }
  // A lone label like "com" (say, from "*.com") would match every site under it.
  if (!host.includes(".") && host !== "localhost") {
    return { ok: false, error: "Use a full domain, like example.com" };
  }

  const queryStart = tail.indexOf("?");
  const rawPath = queryStart === -1 ? tail : tail.slice(0, queryStart);
  const rawQuery = queryStart === -1 ? "" : tail.slice(queryStart + 1);

  const hostTest = globTest(host);
  const path = normalizePatternPath(rawPath);
  const pathTest = pathGlobTest(path);
  const queryTests = parseQuery(rawQuery);

  let scope = "pattern";
  if (!rawQuery && path === "") scope = "homepage";
  else if (!rawQuery && path === "/*") scope = "site";
  else if (!path.includes("*") && !rawQuery.includes("*")) scope = "page";

  return {
    ok: true,
    site: port ? `${host}:${port}` : host,
    scope,
    test(url) {
      return (
        domainSuffixes(url.host).some(hostTest) &&
        (!port || url.port === port) &&
        pathTest(url.path) &&
        queryTests.every(({ key, test }) => (url.query.get(key) ?? []).some(test))
      );
    },
  };
}

/**
 * Returns the web page a URL is really showing: view-source: and Reader View
 * (about:reader?url=...) wrap another URL, and blocking must see through them.
 */
export function unwrapUrl(href) {
  const text = String(href ?? "");
  if (text.startsWith("view-source:")) return text.slice("view-source:".length);
  if (text.startsWith("about:reader?")) {
    return new URLSearchParams(text.slice("about:reader?".length)).get("url") ?? text;
  }
  return text;
}

/**
 * Breaks a URL into the normalised parts patterns are tested against.
 * Returns null for anything that isn't an http(s) URL, which is never blocked.
 * @typedef {{ host: string, port: string, path: string, query: Map<string, string[]> }} UrlParts
 * @returns {UrlParts | null}
 */
export function parseUrl(href) {
  let url;
  try {
    url = new URL(unwrapUrl(href));
  } catch {
    return null;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return null;

  const query = new Map();
  for (const [key, value] of url.searchParams) {
    const k = key.toLowerCase();
    if (!query.has(k)) query.set(k, []);
    query.get(k).push(value.toLowerCase());
  }

  return {
    host: url.hostname.replace(/^www\./, "").replace(/\.$/, ""),
    port: url.port || (url.protocol === "https:" ? "443" : "80"),
    path: url.pathname.toLowerCase().replace(/\/+$/, ""),
    query,
  };
}

/**
 * Validates a redirect target. An empty value (or "SimpleBlock") means "show the SimpleBlock page".
 * @returns {{ ok: true, url: string | null } | { ok: false, error: string }}
 */
export function parseRedirect(text) {
  const raw = String(text ?? "").trim();
  // Typing the placeholder ("SimpleBlock") means the same as leaving it empty.
  if (!raw || raw.toLowerCase() === "simpleblock") return { ok: true, url: null };

  let url;
  try {
    url = new URL(SCHEME.test(raw) ? raw : `https://${raw}`);
  } catch {
    return { ok: false, error: "Not a valid web address" };
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") {
    return { ok: false, error: "Use an http or https address" };
  }
  // Also catches things like "mailto:me@example.com", which would parse as a login.
  if ((!url.hostname.includes(".") && url.hostname !== "localhost") || url.username || url.password) {
    return { ok: false, error: "Not a valid web address" };
  }
  return { ok: true, url: url.href };
}

function normalizePatternPath(path) {
  if (!path) return "";
  // Let the URL parser percent-encode the path exactly as it would a real URL's.
  let encoded;
  try {
    encoded = new URL(`http://h${path}`).pathname;
  } catch {
    encoded = path;
  }
  return encoded.toLowerCase().replace(/\/+$/, "");
}

function pathGlobTest(path) {
  // "/page/*" also matches "/page" itself, since real URLs drop the trailing slash.
  if (path.endsWith("/*")) {
    const page = globTest(path.slice(0, -2));
    const below = globTest(path);
    return (value) => page(value) || below(value);
  }
  return globTest(path);
}

/** "m.reddit.com" -> ["m.reddit.com", "reddit.com", "com"], so rules also cover subdomains. */
function domainSuffixes(host) {
  const suffixes = [host];
  for (let dot = host.indexOf("."); dot !== -1; dot = host.indexOf(".", dot + 1)) {
    suffixes.push(host.slice(dot + 1));
  }
  return suffixes;
}

function parseQuery(query) {
  if (!query) return [];
  return query
    .split("&")
    .filter(Boolean)
    .map((part) => {
      const eq = part.indexOf("=");
      const key = decode(eq === -1 ? part : part.slice(0, eq));
      // "?key" alone means the parameter just has to be present.
      const test = eq === -1 ? () => true : globTest(decode(part.slice(eq + 1)));
      return { key, test };
    });
}

function decode(text) {
  try {
    return decodeURIComponent(text.replace(/\+/g, " "));
  } catch {
    return text;
  }
}

function toAsciiHost(host) {
  try {
    return new URL(`http://${host}`).hostname;
  } catch {
    return "";
  }
}

/** A matcher for `pattern`, where "*" stands for any run of characters. */
function globTest(pattern) {
  if (!pattern.includes("*")) return (text) => text === pattern;
  return (text) => wildcardMatch(pattern, text);
}

// Classic two-pointer wildcard matching. Unlike a regex built from the pattern,
// it can't backtrack exponentially on a pattern like "a*a*a*a*b".
function wildcardMatch(pattern, text) {
  let p = 0;
  let t = 0;
  let star = -1;
  let resume = 0;
  while (t < text.length) {
    if (pattern[p] === "*") {
      star = p++;
      resume = t;
    } else if (p < pattern.length && pattern[p] === text[t]) {
      p++;
      t++;
    } else if (star !== -1) {
      p = star + 1;
      t = ++resume;
    } else {
      return false;
    }
  }
  while (pattern[p] === "*") p++;
  return p === pattern.length;
}
