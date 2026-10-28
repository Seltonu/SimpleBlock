// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { compilePattern, parseUrl, parseRedirect, unwrapUrl } from "../shared/patterns.js";

function matches(pattern, href) {
  const compiled = compilePattern(pattern);
  assert.ok(compiled.ok, `pattern "${pattern}" should compile: ${compiled.error}`);
  const url = parseUrl(href);
  return Boolean(url) && compiled.test(url);
}

function expectMatch(pattern, hrefs) {
  for (const href of hrefs) assert.ok(matches(pattern, href), `"${pattern}" should match ${href}`);
}

function expectNoMatch(pattern, hrefs) {
  for (const href of hrefs) assert.ok(!matches(pattern, href), `"${pattern}" should NOT match ${href}`);
}

test("sites match on whole domain labels (x.com must not block phoronix.com)", () => {
  expectNoMatch("x.com", ["https://www.phoronix.com/", "https://phoronix.com/", "https://box.com/", "https://x.com.evil.net/"]);
  expectNoMatch("x.com*", ["https://www.phoronix.com/news", "https://netflix.com/browse"]);
  expectMatch("x.com", ["https://x.com/", "https://www.x.com", "https://mobile.x.com/"]);
});

test("a bare site blocks only its homepage", () => {
  expectMatch("facebook.com", [
    "https://facebook.com",
    "https://www.facebook.com/",
    "http://facebook.com/",
    "https://m.facebook.com/",
    "https://www.facebook.com/?ref=logo",
    "https://www.facebook.com/#top",
  ]);
  expectNoMatch("facebook.com", ["https://www.facebook.com/messages", "https://www.facebook.com/messages/t/123"]);
});

test("a trailing * blocks the whole site", () => {
  for (const pattern of ["facebook.com*", "facebook.com/*", "https://www.facebook.com/*", "*.facebook.com*"]) {
    expectMatch(pattern, ["https://facebook.com/", "https://www.facebook.com/messages", "https://m.facebook.com/a/b?c=d"]);
    expectNoMatch(pattern, ["https://notfacebook.com/", "https://facebook.community/"]);
  }
});

test("path rules are exact unless they end in *", () => {
  expectMatch("reddit.com/r/all", ["https://www.reddit.com/r/all", "https://www.reddit.com/r/all/", "https://old.reddit.com/r/all/?sort=top"]);
  expectNoMatch("reddit.com/r/all", ["https://www.reddit.com/r/all/top", "https://www.reddit.com/r/allergies", "https://www.reddit.com/"]);

  expectMatch("reddit.com/r/all*", ["https://www.reddit.com/r/all", "https://www.reddit.com/r/all/top", "https://www.reddit.com/r/allergies"]);
  expectMatch("reddit.com/r/all/*", ["https://www.reddit.com/r/all", "https://www.reddit.com/r/all/", "https://www.reddit.com/r/all/top"]);
  expectNoMatch("reddit.com/r/all/*", ["https://www.reddit.com/r/allergies"]);
});

test("* works anywhere in the path", () => {
  expectMatch("reddit.com/r/*/comments*", ["https://www.reddit.com/r/linux/comments/abc/title/"]);
  expectNoMatch("reddit.com/r/*/comments*", ["https://www.reddit.com/r/linux/"]);
  expectMatch("example.com/*.pdf", ["https://example.com/docs/a.pdf"]);
});

test("matching is case-insensitive and ignores scheme, www and trailing slashes", () => {
  expectMatch("HTTPS://WWW.Reddit.com/R/All/", ["http://reddit.com/r/ALL"]);
});

test("query parameters in a pattern must be present, in any order", () => {
  expectMatch("youtube.com/watch?v=abc", ["https://www.youtube.com/watch?v=abc", "https://www.youtube.com/watch?t=10&v=ABC"]);
  expectNoMatch("youtube.com/watch?v=abc", ["https://www.youtube.com/watch?v=abcdef", "https://www.youtube.com/watch"]);
  expectMatch("youtube.com/results?search_query", ["https://www.youtube.com/results?search_query=cats"]);
  expectMatch("example.com/?tab=*", ["https://example.com/?tab=feed"]);
});

test("wildcard hosts", () => {
  expectMatch("reddit.*", ["https://reddit.com/", "https://www.reddit.co.uk/r/all"]);
  expectNoMatch("reddit.*", ["https://notreddit.com/"]);
});

test("ports", () => {
  expectMatch("localhost:3000", ["http://localhost:3000/"]);
  expectNoMatch("localhost:3000", ["http://localhost:8080/"]);
  expectMatch("localhost*", ["http://localhost:8080/app"]);
});

test("internationalised domains", () => {
  expectMatch("bücher.de", ["https://www.xn--bcher-kva.de/"]);
  expectMatch("example.com/café", ["https://example.com/caf%C3%A9"]);
});

test("non-web URLs are never matched", () => {
  for (const href of ["about:blank", "moz-extension://abc/pages/blocked.html", "file:///home/x.com", "not a url", "about:reader?foo=1"]) {
    assert.equal(parseUrl(href), null, href);
  }
});

test("view-source and Reader View are seen through", () => {
  expectMatch("x.com*", ["view-source:https://x.com/home", "about:reader?url=https%3A%2F%2Fx.com%2Fsome%2Fpost"]);
  assert.equal(unwrapUrl("about:reader?url=https%3A%2F%2Fx.com%2F"), "https://x.com/");
  assert.equal(unwrapUrl("view-source:https://x.com/"), "https://x.com/");
  assert.equal(unwrapUrl("https://x.com/"), "https://x.com/");
});

test("scope describes how much of the site a pattern covers", () => {
  const scope = (pattern) => compilePattern(pattern).scope;
  assert.equal(scope("reddit.com"), "homepage");
  assert.equal(scope("reddit.com/"), "homepage");
  assert.equal(scope("reddit.com*"), "site");
  assert.equal(scope("reddit.com/*"), "site");
  assert.equal(scope("reddit.com/r/all"), "page");
  assert.equal(scope("youtube.com/watch?v=abc"), "page");
  assert.equal(scope("reddit.com/r/*"), "pattern");
  assert.equal(compilePattern("https://www.Reddit.com:8080/x").site, "reddit.com:8080");
});

test("invalid or overly broad patterns are rejected", () => {
  for (const pattern of ["", "   ", "*", "**", "*.", "http://", "exa mple.com", "a..b", "com", "*.com", "*.com*", "reddit", "me@example.com"]) {
    assert.equal(compilePattern(pattern).ok, false, `"${pattern}" should be rejected`);
  }
});

test("redirect targets", () => {
  assert.deepEqual(parseRedirect(""), { ok: true, url: null });
  assert.deepEqual(parseRedirect("  "), { ok: true, url: null });
  assert.equal(parseRedirect("facebook.com/messages").url, "https://facebook.com/messages");
  assert.equal(parseRedirect("http://example.com").url, "http://example.com/");
  assert.equal(parseRedirect("localhost:8080").url, "https://localhost:8080/");
  assert.equal(parseRedirect("javascript:alert(1)").ok, false);
  assert.equal(parseRedirect("ftp://example.com").ok, false);
  assert.equal(parseRedirect("nonsense").ok, false);
  assert.equal(parseRedirect("mailto:me@example.com").ok, false);
  assert.equal(parseRedirect("https://user:pass@example.com").ok, false);
});

test("pathological wildcards stay fast", () => {
  const compiled = compilePattern("example.com/a*a*a*a*a*a*a*b");
  const url = parseUrl(`https://example.com/${"a".repeat(5000)}`);
  const start = performance.now();
  assert.equal(compiled.test(url), false);
  assert.ok(performance.now() - start < 250, "matching must not backtrack exponentially");
});
