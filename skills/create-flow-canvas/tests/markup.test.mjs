/* Markup module tests: scanned text enters markup only through FlowMarkup, so a scanner that writes
   <, &, quotes or a Next.js-style [id] in a route, name or meta cannot break the page.
   Run:  node --test skills/create-flow-canvas/tests/markup.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowMarkup } from "./modules.mjs";

const { esc, html, raw, sel } = FlowMarkup;
const NASTY = `/users/[id]?a=1&b=<2> "q" 'r'`;

test("esc makes text safe in element text and in quoted attributes", () => {
  assert.equal(esc(NASTY), "/users/[id]?a=1&amp;b=&lt;2&gt; &quot;q&quot; &#39;r&#39;");
  assert.equal(esc("&amp;"), "&amp;amp;", "an entity typed by the scanner is shown as typed, not decoded");
});

test("esc turns nothing and numbers into text", () => {
  assert.equal(esc(undefined), "");
  assert.equal(esc(null), "");
  assert.equal(esc(0), "0");
});

test("html escapes every interpolation, in text and in attributes", () => {
  const out = String(html`<button data-to="${NASTY}">${NASTY}</button>`);
  assert.equal(out.includes("<2>"), false);
  assert.equal(out.includes('"q"'), false);
  assert.match(out, /^<button data-to="[^"<>]*">[^<>]*<\/button>$/);
});

test("raw marks a fragment that is already markup; lists of fragments join without commas", () => {
  const item = (t) => html`<li>${t}</li>`;
  assert.equal(String(html`<ul>${["a", "<b>"].map(item)}</ul>`), "<ul><li>a</li><li>&lt;b&gt;</li></ul>");
  assert.equal(String(html`<i>${raw("<b>x</b>")}</i>`), "<i><b>x</b></i>");
  assert.equal(String(html`<i>${html`<b>${"<"}</b>`}</i>`), "<i><b>&lt;</b></i>", "html inside html is not escaped twice");
});

test("sel makes a scanned value safe inside a quoted attribute selector", () => {
  assert.equal(sel('a"b\\c'), 'a\\"b\\\\c');
  assert.equal(`[data-k="${sel("/users/[id]")}"]`, '[data-k="/users/[id]"]');
});
