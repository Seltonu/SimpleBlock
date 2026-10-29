// Covers a blocked page in place, for the "Don't reload blocked tabs" setting.
//
// The background script injects this (after shared/quotes.js) only into tabs
// that need covering. It isn't declared in the manifest, so SimpleBlock needs
// no website access unless that setting is switched on. It draws a full-page
// cover in a closed shadow root, so the site's styles can't reach it, and
// leaves the page itself alone underneath: scroll position, typed text and
// paused videos are all still there when the cover lifts.
//
// The background drives it over a port with {type: "cover", url, rule, set,
// theme, quote} and {type: "uncover"}, where quote is the user's quote
// preference (see shared/quotes.js). If SimpleBlock is updated, disabled or removed,
// the port disconnects and the cover lifts itself, so a page can never be left
// stuck behind it.

"use strict";

(() => {
  // Injected again into a page that already has this script: just reconnect if needed.
  if (globalThis.simpleBlockCover) {
    globalThis.simpleBlockCover.connect();
    return;
  }

  // icons/simpleblock-48.png, inlined: the page can't load files from the extension.
  const ICON = "data:image/png;base64,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";

  // Colours match pages/page.css.
  const STYLE = `
    :host { all: initial; }
    *, *::before, *::after { box-sizing: border-box; }
    .backdrop {
      --bg: light-dark(#f5f5f3, #141518);
      --surface: light-dark(#ffffff, #1d1e22);
      --border: light-dark(#e3e3df, #2c2d33);
      --border-strong: light-dark(#cfcfca, #3d3e45);
      --text: light-dark(#1c1c1e, #ececef);
      --muted: light-dark(#616166, #9a9ba3);
      --accent: light-dark(#0369a1, #7dd3fc);
      --code-bg: light-dark(#f0f0ed, #26272c);
      --mono: ui-monospace, "SF Mono", "JetBrains Mono", "Cascadia Code", Menlo, Consolas, monospace;
      position: absolute;
      inset: 0;
      display: grid;
      place-items: center;
      padding: 48px 20px;
      overflow: auto;
      background: var(--bg);
      color: var(--text);
      font: 15px/1.6 system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif;
      text-align: center;
      -webkit-font-smoothing: antialiased;
      animation: fade-in .25s ease-out;
    }
    @keyframes fade-in { from { opacity: 0; } }
    @media (prefers-reduced-motion: reduce) { .backdrop { animation: none; } }
    .card { width: min(560px, 100%); }
    .icon { display: block; width: 56px; height: 56px; margin: 0 auto 16px; }
    h1 { margin: 0; font-size: 26px; font-weight: 650; line-height: 1.3; letter-spacing: -.02em; }
    .url {
      display: inline-block;
      max-width: 100%;
      margin: 14px 0 0;
      padding: 4px 12px;
      border: 1px solid var(--border);
      border-radius: 999px;
      background: var(--surface);
      color: var(--muted);
      font: 13px var(--mono);
      overflow-wrap: anywhere;
    }
    .url:empty { display: none; }
    .reason { margin: 12px 0 0; color: var(--muted); font-size: 14px; }
    .reason[hidden] { display: none; }
    code {
      padding: .1em .4em;
      border: 1px solid var(--border);
      border-radius: 5px;
      background: var(--code-bg);
      font: .9em var(--mono);
    }
    .quote {
      margin: 40px 0 0;
      padding: 28px 32px;
      border: 1px solid var(--border);
      border-radius: 16px;
      background: var(--surface);
      text-align: left;
    }
    .quote[hidden] { display: none; }
    blockquote { margin: 0; font-size: 19px; font-weight: 500; line-height: 1.5; letter-spacing: -.01em; }
    figcaption { margin-top: 12px; color: var(--muted); font-size: 14px; }
    figcaption::before { content: "— "; }
    figcaption[hidden] { display: none; }
    .actions { display: flex; flex-wrap: wrap; justify-content: center; gap: 10px; margin-top: 28px; }
    button {
      height: 36px;
      padding: 0 16px;
      border: 1px solid var(--border);
      border-radius: 8px;
      background: var(--surface);
      color: var(--text);
      font: 600 14px system-ui, -apple-system, "Segoe UI", Roboto, Ubuntu, Cantarell, "Noto Sans", sans-serif;
      cursor: pointer;
    }
    button:hover { border-color: var(--border-strong); }
    button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
    button[hidden] { display: none; }
  `;

  let port = null;
  let host = null;
  let parts = null;
  let restorePage = null;
  let keeper = null; // puts the cover back if the page removes it

  function connect() {
    if (port) return;
    port = browser.runtime.connect({ name: "cover" });
    port.onMessage.addListener((message) => {
      if (message?.type === "cover") show(message);
      else if (message?.type === "uncover") hide();
    });
    // SimpleBlock was updated, disabled or removed: never leave the page stuck.
    port.onDisconnect.addListener(() => {
      port = null;
      hide();
    });
  }

  function show({ url, rule, set, theme, quote: quotePreference }) {
    if (!host) build();

    parts.url.textContent = displayUrl(url ?? "");
    parts.rule.textContent = rule ?? "";
    parts.set.textContent = set ?? "";
    parts.reason.hidden = !(rule && set);
    const quote = globalThis.simpleBlockQuote?.(quotePreference);
    parts.quote.hidden = !quote;
    if (quote) {
      parts.quoteText.textContent = quote.text;
      parts.quoteAuthor.textContent = quote.author;
      parts.quoteAuthor.hidden = !quote.author;
    }
    parts.back.hidden = history.length < 2;
    host.style.setProperty("color-scheme", theme === "light" || theme === "dark" ? theme : "light dark", "important");

    if (!restorePage) restorePage = quietPage();
  }

  function hide() {
    if (!host) return;
    keeper?.disconnect();
    keeper = null;
    host.remove();
    host = null;
    parts = null;
    restorePage?.();
    restorePage = null;
  }

  function build() {
    host = document.createElement("simpleblock-cover");
    const hostStyle = {
      all: "initial",
      position: "fixed",
      inset: "0",
      display: "block",
      width: "100vw",
      height: "100vh",
      "max-width": "none",
      "max-height": "none",
      margin: "0",
      padding: "0",
      border: "0",
      overflow: "hidden",
      // Opaque even without the stylesheet below (a strict site policy could
      // block it), so the page underneath is always hidden. Inline styles set
      // through the DOM aren't subject to that policy.
      background: "Canvas",
      color: "CanvasText",
      "z-index": "2147483647",
    };
    for (const [property, value] of Object.entries(hostStyle)) host.style.setProperty(property, value, "important");

    const shadow = host.attachShadow({ mode: "closed" });
    try {
      // Constructed stylesheets aren't subject to the site's Content Security Policy.
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(STYLE);
      shadow.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement("style");
      style.textContent = STYLE;
      shadow.append(style);
    }

    const el = (tag, props = {}, ...children) => {
      const node = document.createElement(tag);
      for (const [key, value] of Object.entries(props)) {
        if (key === "class") node.className = value;
        else node.setAttribute(key, value);
      }
      node.append(...children);
      return node;
    };

    parts = {
      url: el("p", { class: "url" }),
      rule: el("code"),
      set: el("strong"),
      quoteText: el("blockquote"),
      quoteAuthor: el("figcaption"),
      back: el("button", { type: "button" }, "Go back"),
      help: el("button", { type: "button" }, "How SimpleBlock works"),
    };
    parts.reason = el("p", { class: "reason" }, "Matched ", parts.rule, " in ", parts.set);
    parts.quote = el("figure", { class: "quote" }, parts.quoteText, parts.quoteAuthor);
    parts.back.addEventListener("click", () => history.back());
    parts.help.addEventListener("click", () => port?.postMessage({ type: "help" }));

    const icon = el("img", { class: "icon", src: ICON, alt: "", width: "48", height: "48" });
    const heading = el("h1", { id: "simpleblock-cover-title" }, "Blocked by SimpleBlock");
    const card = el(
      "div",
      { class: "card" },
      icon,
      heading,
      parts.url,
      parts.reason,
      parts.quote,
      el("div", { class: "actions" }, parts.back, parts.help),
    );
    shadow.append(
      el("div", { class: "backdrop", role: "dialog", "aria-modal": "true", "aria-labelledby": "simpleblock-cover-title" }, card),
    );

    attach();
    // Some sites rebuild the whole page structure; put the cover straight back.
    keeper = new MutationObserver(() => {
      if (host && !host.isConnected) attach();
    });
    keeper.observe(document.documentElement, { childList: true });
  }

  function attach() {
    document.documentElement.append(host);
    try {
      // The top layer puts the cover above the site's own dialogs and pop-ups.
      host.popover = "manual";
      host.showPopover();
    } catch {
      host.removeAttribute("popover");
    }
  }

  /** Stops the page underneath scrolling, being clicked or playing; returns how to undo it. */
  function quietPage() {
    const root = document.documentElement;
    const body = document.body;
    // The longhands, since a page may have set just one of them.
    const overflow = ["overflow-x", "overflow-y"].map((name) => [
      name,
      root.style.getPropertyValue(name),
      root.style.getPropertyPriority(name),
    ]);
    const bodyWasInert = body?.inert ?? false;

    root.style.setProperty("overflow", "hidden", "important");
    if (body) body.inert = true;
    if (document.fullscreenElement) document.exitFullscreen().catch(() => {});
    // Paused rather than stopped, so videos resume from the same spot.
    for (const media of document.querySelectorAll("video, audio")) {
      if (!media.paused) media.pause();
    }

    return () => {
      for (const [name, value, priority] of overflow) {
        if (value) root.style.setProperty(name, value, priority);
        else root.style.removeProperty(name);
      }
      if (body) body.inert = bodyWasInert;
    };
  }

  function displayUrl(text) {
    try {
      const url = new URL(text);
      return `${url.host.replace(/^www\./, "")}${url.pathname.replace(/\/$/, "")}${url.search}`;
    } catch {
      return text;
    }
  }

  globalThis.simpleBlockCover = { connect };
  connect();
})();
