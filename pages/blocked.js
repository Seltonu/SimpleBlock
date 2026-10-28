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

  const QUOTES = [
    { text: "The seed of every habit is a single, tiny decision.", author: "James Clear" },
    {
      text: "Your results are the product of either personal focus or personal distractions. The choice is yours.",
      author: "John Di Lemme",
    },
    { text: "Discipline is the bridge between goals and accomplishments.", author: "Jim Rohn" },
    {
      text: "Concentrate all your thoughts upon the work at hand. The sun's rays do not burn until brought to a focus.",
      author: "Alexander Graham Bell",
    },
    { text: "How we spend our days is, of course, how we spend our lives.", author: "Annie Dillard" },
    { text: "It is not that we have a short time to live, but that we waste a lot of it.", author: "Seneca" },
    {
      text: "Almost everything will work again if you unplug it for a few minutes, including you.",
      author: "Anne Lamott",
    },
    { text: "We are what we repeatedly do. Excellence, then, is not an act, but a habit.", author: "Will Durant" },
    { text: "My experience is what I agree to attend to.", author: "William James" },
    { text: "You can do anything, but not everything.", author: "David Allen" },
    { text: "Until we can manage time, we can manage nothing else.", author: "Peter Drucker" },
    { text: "Lost time is never found again.", author: "Benjamin Franklin" },
    { text: "To do two things at once is to do neither.", author: "Publilius Syrus" },
    { text: "Wherever you are, be all there.", author: "Jim Elliot" },
    { text: "Focusing is about saying no.", author: "Steve Jobs" },
  ];

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

    const quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    byId("quote-text").textContent = quote.text;
    byId("quote-author").textContent = quote.author;

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
