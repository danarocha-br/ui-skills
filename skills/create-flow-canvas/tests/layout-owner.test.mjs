/* Nothing but the layout writes to the layout (N5). The layout's reads are frozen, so a stray write throws once the
   page runs it in strict code; this guard reads the page's own script and fails on the shapes of a direct write, so it
   is caught here whether or not that line runs. The page's script is the one <script> with no id.
   Run:  node --test skills/create-flow-canvas/tests/layout-owner.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "./modules.mjs";

/* the page script, with comments and string/template contents left in (a write inside a string is not a write, but none is there) */
const page = (() => {
  const m = html.match(/^\s*<script>\n([\s\S]*?)<\/script>/m);
  assert.ok(m, "the page's script block is not found");
  return m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
})();
const FIELDS = "groups|pos|caps|scans|notes|conns";
const lines = (re) =>
  page
    .split("\n")
    .map((text, i) => ({ text: text.trim(), i }))
    .filter(({ text }) => re.test(text))
    .map(({ text }) => text);

test("the page does not assign to the layout's fields", () => {
  assert.deepEqual(lines(new RegExp(`\\blayout\\.(${FIELDS})\\s*=[^=]`)), []);
  assert.deepEqual(lines(new RegExp(`\\blayout\\.(${FIELDS})(\\.\\w+|\\[[^\\]]*\\])*\\s*(=[^=]|\\+\\+|--)`)), []);
});

test("the page does not call a mutating array method on what the layout holds", () => {
  const mutating = "push|pop|shift|unshift|splice|sort|reverse|fill|copyWithin";
  assert.deepEqual(lines(new RegExp(`\\blayout\\.(${FIELDS})(\\.\\w+|\\[[^\\]]*\\])*\\.(${mutating})\\(`)), []);
  assert.deepEqual(lines(new RegExp(`\\bdelete\\s+layout\\.`)), []);
});

test("the page does not write a field of a group, a note, a connector or a finding it got from the layout", () => {
  /* the page's names for them: L / Lc / l / g (groups), n (notes), c (connectors), f / r (findings) */
  assert.deepEqual(lines(/\b(L|Lc|l|g)\.(open|title|sub|subOn|screens|id)\s*=[^=]/), []);
  assert.deepEqual(lines(/\b(L|Lc|l|g)\.screens\.(push|pop|shift|unshift|splice|sort|reverse)\(/), []);
  assert.deepEqual(lines(/\b(n|note)\.(text|frame|pos|x|y|who|at)\s*=[^=]/), []);
  assert.deepEqual(lines(/\b(c|conn)\.(label|from|to)\s*=[^=]/), []);
  assert.deepEqual(lines(/\b(f|r)\.pos\s*=[^=]/), []);
  assert.deepEqual(lines(/\[n\.x, n\.y\]\s*=/), []);
});

test("a group carries no DOM handle, and the page keeps its own: no L.el, no guard for a missing one", () => {
  assert.deepEqual(lines(/\bL\.el\b/), []);
  assert.deepEqual(lines(/\.el &&/), []);
  assert.ok(/const groupEls = new Map\(\)/.test(page), "the page's own handle for a group's element");
});

test("open or closed is one mutator, and the workaround that stood in for it is gone", () => {
  assert.deepEqual(lines(/VIEW_STATE/), []);
  assert.deepEqual(lines(/\bposOf\b/), []);
  assert.deepEqual(lines(/commit\.since|saveNotesSoon|groupEdit/), []);
  assert.ok(/layout\.setOpen\(/.test(page));
});

test("the guard itself sees a direct write (so a green run means something)", () => {
  const sample = "layout.notes.push(n);\nlayout.groups = [];\nL.open = true;\nlayout.pos[DEV.id].s1 = {};";
  const hits = sample.split("\n").filter(
    (l) =>
      new RegExp(`\\blayout\\.(${FIELDS})\\s*=[^=]`).test(l) ||
      new RegExp(`\\blayout\\.(${FIELDS})(\\.\\w+|\\[[^\\]]*\\])*\\.(push)\\(`).test(l) ||
      /\b(L)\.(open)\s*=[^=]/.test(l) ||
      new RegExp(`\\blayout\\.(${FIELDS})(\\.\\w+|\\[[^\\]]*\\])*\\s*(=[^=])`).test(l),
  );
  assert.equal(hits.length, 4);
});
