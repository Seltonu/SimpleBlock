// Checks the scripts the background injects with tabs.executeScript.
// Run with: node --test tests/
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const INJECTED = ["shared/quotes.js", "content/cover.js"];

function run(files) {
  const sandbox = { browser: { runtime: { connect: () => ({ onMessage: { addListener() {} }, onDisconnect: { addListener() {} } }) } } };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  return files.map((file) => vm.runInContext(readFileSync(new URL(`../${file}`, import.meta.url), "utf8"), sandbox));
}

test("injected scripts end with a value Firefox can pass back", () => {
  // tabs.executeScript rejects ("result is non-structured-clonable data") if a
  // script's final value can't be copied, e.g. a function, and the cover then
  // never appears.
  for (const [i, result] of run(INJECTED).entries()) {
    assert.doesNotThrow(() => structuredClone(result), `${INJECTED[i]} ends with an uncopyable value`);
  }
});

test("quotes.js provides the quote helpers the cover uses", () => {
  const sandbox = { globalThis: null };
  sandbox.globalThis = sandbox;
  vm.createContext(sandbox);
  vm.runInContext(readFileSync(new URL("../shared/quotes.js", import.meta.url), "utf8"), sandbox);

  assert.ok(sandbox.SIMPLEBLOCK_QUOTES.length > 0);
  assert.ok(sandbox.SIMPLEBLOCK_QUOTES.includes(sandbox.simpleBlockQuote({})), "random by default");
  // Copied out of the sandbox, whose objects have a different Object prototype.
  const own = JSON.parse(JSON.stringify(sandbox.simpleBlockQuote({ random: false, text: " Stay on task ", author: "" })));
  assert.deepEqual(own, {
    text: "Stay on task",
    author: "",
  });
  assert.equal(sandbox.simpleBlockQuote({ random: false, text: "  " }), null, "no quote at all");
});
