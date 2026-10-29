/**
 * The settings page.
 *
 * "Don't reload blocked tabs" (keepPages) needs website access, which is an
 * optional permission: Firefox asks for it here, the first time the setting is
 * switched on, not when SimpleBlock is installed. The background script watches
 * both the setting and the permission, so revoking access in about:addons
 * switches the feature off too.
 *
 * The quote choice is a display preference kept in localStorage (see
 * shared/quotes.js), so the blocked page can read it without extension APIs.
 */

import { normalizeSettings, SETTINGS_KEY } from "../shared/config.js";

const ALL_SITES = { origins: ["<all_urls>"] };
const toggle = document.getElementById("keep-pages");
const status = document.getElementById("status");
const permissionNote = document.getElementById("permission-note");
const randomQuotes = document.getElementById("random-quotes");
const customQuote = document.getElementById("custom-quote");
const quoteText = document.getElementById("quote-text");
const quoteAuthor = document.getElementById("quote-author");

async function render() {
  const [stored, granted] = await Promise.all([
    browser.storage.local.get(SETTINGS_KEY),
    browser.permissions.contains(ALL_SITES),
  ]);
  toggle.checked = normalizeSettings(stored[SETTINGS_KEY]).keepPages && granted;
  // The permission warning only matters until Firefox has been asked and said yes.
  permissionNote.hidden = granted;
}

function save(keepPages) {
  return browser.storage.local.set({ [SETTINGS_KEY]: { keepPages } });
}

toggle.addEventListener("change", () => {
  status.textContent = "";
  if (!toggle.checked) {
    save(false);
    return;
  }
  // Firefox only shows the permission prompt when it's requested straight from
  // the click, so nothing may be awaited before this call.
  browser.permissions.request(ALL_SITES).then(
    (granted) => {
      toggle.checked = granted;
      save(granted);
      if (!granted) status.textContent = "This needs website access to work.";
    },
    () => {
      toggle.checked = false;
      status.textContent = "Firefox didn't show the permission prompt. Please try again.";
    },
  );
});

browser.permissions.onAdded.addListener(render);
browser.permissions.onRemoved.addListener(render);
// Granting access and saving the setting land separately; render again once both have.
browser.storage.onChanged.addListener((changes, area) => {
  if (area === "local" && SETTINGS_KEY in changes) render();
});
render();

/* ---------- Quotes ---------- */

function readQuote() {
  try {
    return JSON.parse(localStorage.getItem("quote")) ?? {};
  } catch {
    return {};
  }
}

function saveQuote() {
  const preference = { random: randomQuotes.checked, text: quoteText.value, author: quoteAuthor.value };
  try {
    localStorage.setItem("quote", JSON.stringify(preference));
    if (status.dataset.quoteError) {
      status.textContent = "";
      delete status.dataset.quoteError;
    }
  } catch {
    status.dataset.quoteError = "true";
    status.textContent = "Couldn't save your quote.";
  }
}

const quote = readQuote();
randomQuotes.checked = quote.random !== false;
quoteText.value = quote.text ?? "";
quoteAuthor.value = quote.author ?? "";
// The fields stay visible either way, and keep what was typed, but only apply
// (and only accept typing) while random quotes are off.
function renderQuoteFields() {
  customQuote.disabled = randomQuotes.checked;
  // Locked fields can't take keyboard focus, so the switch also carries the
  // "turn this off to use your own" hint while it applies.
  const describedBy = randomQuotes.checked ? "random-quotes-desc custom-quote-hint" : "random-quotes-desc";
  randomQuotes.setAttribute("aria-describedby", describedBy);
}
renderQuoteFields();

randomQuotes.addEventListener("change", () => {
  renderQuoteFields();
  saveQuote();
});
quoteText.addEventListener("input", saveQuote);
quoteAuthor.addEventListener("input", saveQuote);
