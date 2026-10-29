// Quotes shown on the blocked page and on covered pages. A plain script that
// sets globals, so both the blocked page (which mustn't use extension APIs) and
// the cover content script can load it.
//
// Which quote to show is a display preference, saved by the settings page in
// localStorage under "quote" (like the theme): { random, text, author }.
// Random is the default; with it off, the user's own quote is shown, or none.

"use strict";

// Wrapped so the script's final value is undefined: when the background injects
// it with tabs.executeScript, Firefox passes that value back and rejects the
// injection if it can't be copied (a function can't).
(() => {
  globalThis.SIMPLEBLOCK_QUOTES = [
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

  /** The quote to show for the given preference, or null for none. */
  globalThis.simpleBlockQuote = (preference) => {
    if (preference?.random === false) {
      const text = String(preference.text ?? "").trim();
      return text ? { text, author: String(preference.author ?? "").trim() } : null;
    }
    const quotes = globalThis.SIMPLEBLOCK_QUOTES;
    return quotes[Math.floor(Math.random() * quotes.length)];
  };

  /** Reads the preference saved by the settings page. Only works on SimpleBlock's own pages. */
  globalThis.simpleBlockQuotePreference = () => {
    try {
      return JSON.parse(localStorage.getItem("quote")) ?? {};
    } catch {
      return {};
    }
  };
})();
