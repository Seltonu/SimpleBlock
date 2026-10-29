// Applies the light/dark theme picked with the popup's theme button, or leaves
// pages following Firefox's theme when none was picked.
//
// Load it as a plain (non-module) script in <head>, before anything renders,
// so a page never flashes the wrong theme. It uses localStorage, which every
// SimpleBlock page shares and which (unlike browser.storage) isn't an
// extension API, so the blocked page can use it too.

"use strict";

(() => {
  const KEY = "theme";
  const root = document.documentElement;
  const reducedMotion = matchMedia("(prefers-reduced-motion: reduce)");
  let fadeTimer;

  function read() {
    try {
      return localStorage.getItem(KEY);
    } catch {
      return null; // Storage can be unavailable (e.g. privacy settings): follow Firefox.
    }
  }

  function setScheme(theme) {
    if (theme === "light" || theme === "dark") root.dataset.scheme = theme;
    else delete root.dataset.scheme;
  }

  function apply(theme, fade) {
    if (!fade || reducedMotion.matches) {
      setScheme(theme);
    } else if (document.startViewTransition) {
      // Cross-fades a snapshot of the page in one step, which stays smooth
      // however much is on screen.
      document.startViewTransition(() => setScheme(theme));
    } else {
      // Older Firefox: briefly turn on colour transitions ("theme-changing" in the CSS).
      root.classList.add("theme-changing");
      clearTimeout(fadeTimer);
      fadeTimer = setTimeout(() => root.classList.remove("theme-changing"), 400);
      setScheme(theme);
    }
  }

  apply(read(), false);

  // Open SimpleBlock pages (help, blocked pages) follow along when the popup changes the theme.
  addEventListener("storage", (event) => {
    if (event.key === KEY || event.key === null) apply(read(), true);
  });

  /** Used by the popup's button. "light" or "dark", or null to follow Firefox. */
  globalThis.setSimpleBlockTheme = (theme) => {
    try {
      if (theme) localStorage.setItem(KEY, theme);
      else localStorage.removeItem(KEY);
    } catch {
      // Not saved, but still applied to this page.
    }
    apply(theme, true);
  };
})();
