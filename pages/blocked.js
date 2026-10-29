// The page shown in place of a blocked site.
//
// It must never use extension APIs: Firefox closes extension pages that have
// (taking the tab's history with them) whenever the add-on updates or is
// disabled. So the background script does all the work, and everything shown
// here arrives in the query string:
//   url   the page that was blocked
//   to    a redirect target to forward to immediately
//   rule  the block pattern that matched
//   set   the name of the category it came from

"use strict";

(() => {
  const params = new URLSearchParams(location.search);

  const redirect = params.get("to");
  if (redirect && /^https?:\/\//i.test(redirect)) {
    // Keep the block message from flashing up while the redirect loads.
    document.documentElement.hidden = true;
    location.replace(redirect);
    try {
      document.title = new URL(redirect).host;
    } catch {
      // Only cosmetic; the redirect is already under way.
    }
    return;
  }


  document.addEventListener("DOMContentLoaded", () => {
    const byId = (id) => document.getElementById(id);

    const original = params.get("url") ?? "";
    const shownUrl = displayUrl(original);
    document.title = shownUrl ? `Blocked: ${shownUrl}` : "Blocked";
    const link = byId("blocked-url");
    link.textContent = shownUrl;
    // While SimpleBlock is on, following this just blocks again. It's here so a
    // covered tab can still find its way back if SimpleBlock is turned off.
    if (/^https?:\/\//i.test(original)) link.href = original;

    const rule = params.get("rule");
    const set = params.get("set");
    if (rule && set) {
      byId("blocked-rule").textContent = rule;
      byId("blocked-set").textContent = set;
      byId("blocked-reason").hidden = false;
    }

    // A random quote, the user's own (see shared/quotes.js), or none.
    const quote = globalThis.simpleBlockQuote?.(globalThis.simpleBlockQuotePreference());
    if (quote) {
      byId("quote-text").textContent = quote.text;
      byId("quote-author").textContent = quote.author;
      byId("quote-author").hidden = !quote.author;
    } else {
      byId("quote-text").closest("figure").hidden = true;
    }

    if (history.length > 1) {
      const back = byId("go-back");
      back.hidden = false;
      back.addEventListener("click", () => history.back());
    }
  });

  function displayUrl(text) {
    try {
      const url = new URL(text);
      return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
    } catch {
      return text;
    }
  }
})();
