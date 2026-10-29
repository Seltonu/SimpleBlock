// Sizes the embedded previews (the popup, the example rules) to fit their
// content, and keeps them fitted if it changes. Like the blocked page, this
// page uses no extension APIs.

"use strict";

// The version beside the title, read from the manifest like any other file
// (an ordinary page request, not an extension API).
fetch("../manifest.json")
  .then((response) => response.json())
  .then(({ version }) => {
    document.getElementById("version").textContent = `v${version}`;
  })
  .catch(() => {}); // Opened straight from disk, say: just leave it out.

(() => {
  for (const frame of document.querySelectorAll("iframe.fit-frame")) {
    const fit = () => {
      // Unreadable when this file is opened straight from disk; the CSS height then applies.
      const doc = frame.contentDocument;
      // The content's own height. (scrollHeight never reports less than the frame's
      // current height, so a frame could grow but never shrink to fit.)
      if (doc?.body) frame.style.height = `${Math.ceil(doc.documentElement.getBoundingClientRect().height)}px`;
    };
    const watch = () => {
      fit();
      const doc = frame.contentDocument;
      if (doc?.body) new frame.contentWindow.ResizeObserver(fit).observe(doc.body);
    };
    frame.addEventListener("load", watch);
    if (frame.contentDocument?.readyState === "complete" && frame.contentDocument.URL !== "about:blank") watch();
  }
})();
