/* Selection module tests: which frames are selected, which of them is the primary one, and which connector is selected.
   One owner for all three, and a way to tell the side panel. No page: the panel is the real FlowPanel.
   Run:  node --test skills/create-flow-canvas/tests/selection.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowPanel, FlowSelection, html } from "./modules.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const make = (...a) => FlowSelection.create(...a);
const FRAMES = ["s1", "s2", "s3", "s4", "s5"];

/* what the page does: the panel follows the selection. Inspect is open on whatever is selected, as after the I key */
function withInspect(selected = "s1") {
  const sel = make();
  const panel = FlowPanel.create({ usesOf: () => [] });
  FlowSelection.follows(sel, panel);
  sel.set([selected]);
  panel.open("inspect", selected);
  return { sel, panel };
}
const shown = (panel) => panel.state().subject;

/* ---------- what is selected ---------- */

test("nothing is selected to begin with", () => {
  const sel = make();
  assert.deepEqual(plain(sel.state()), { ids: [], primary: null, conn: null });
});

test("set selects frames; the primary is the last unless one is named", () => {
  const sel = make();
  sel.set(["s1", "s2", "s3"]);
  assert.deepEqual(plain(sel.state()), { ids: ["s1", "s2", "s3"], primary: "s3", conn: null });
  sel.set(["s1", "s2", "s3"], "s2");
  assert.equal(sel.primary(), "s2");
});

test("a primary that is not among the frames falls back to the last; no frames, no primary", () => {
  const sel = make();
  sel.set(["s1", "s2"], "s9");
  assert.equal(sel.primary(), "s2");
  sel.set([], "s1");
  assert.equal(sel.primary(), null);
});

test("a frame named twice is selected once", () => {
  const sel = make();
  sel.set(["s1", "s2", "s1"]);
  assert.deepEqual(plain(sel.ids()), ["s1", "s2"]);
  assert.equal(sel.count(), 2);
});

test("has says whether a frame is selected", () => {
  const sel = make();
  sel.set(["s2"]);
  assert.ok(sel.has("s2"));
  assert.ok(!sel.has("s1"));
});

test("the state handed out is a copy: changing it changes nothing", () => {
  const sel = make();
  sel.set(["s1"]);
  sel.state().ids.push("s2");
  sel.ids().push("s3");
  assert.deepEqual(plain(sel.ids()), ["s1"]);
});

test("toggle adds a frame and makes it the primary; toggling a selected one takes it out", () => {
  const sel = make();
  sel.set(["s1"]);
  sel.toggle("s2");
  assert.deepEqual(plain(sel.state()), { ids: ["s1", "s2"], primary: "s2", conn: null });
  sel.toggle("s2");
  assert.deepEqual(plain(sel.state()), { ids: ["s1"], primary: "s1", conn: null }, "the primary goes to what is left");
  sel.toggle("s1");
  assert.deepEqual(plain(sel.state()), { ids: [], primary: null, conn: null });
});

test("a connector and frames are never selected together: choosing one lets go of the other", () => {
  const sel = make();
  sel.set(["s1", "s2"]);
  sel.selectConn("c1");
  assert.deepEqual(plain(sel.state()), { ids: [], primary: null, conn: "c1" });
  sel.set(["s3"]);
  assert.deepEqual(plain(sel.state()), { ids: ["s3"], primary: "s3", conn: null });
});

test("deselecting frames leaves a selected connector alone; clearConn lets go of it", () => {
  const sel = make();
  sel.selectConn("c1");
  sel.set([]);
  assert.equal(sel.conn(), "c1");
  sel.clearConn();
  assert.equal(sel.conn(), null);
});

test("prune drops the frames that are not there any more, and the primary falls back to the last that is", () => {
  const sel = make();
  sel.set(["s1", "s2", "s3"], "s2");
  sel.prune((id) => id !== "s2" && id !== "s9");
  assert.deepEqual(plain(sel.state()), { ids: ["s1", "s3"], primary: "s3", conn: null });
  sel.prune(() => false);
  assert.deepEqual(plain(sel.state()), { ids: [], primary: null, conn: null });
});

test("prune keeps a primary that is still there", () => {
  const sel = make();
  sel.set(["s1", "s2", "s3"], "s1");
  sel.prune((id) => id !== "s3");
  assert.equal(sel.primary(), "s1");
});

/* ---------- telling the page ---------- */

test("a listener hears every change, with what part of the selection changed", () => {
  const sel = make();
  const heard = [];
  sel.on((state, change) => heard.push([plain(state.ids), state.primary, plain(change)]));
  sel.set(["s1", "s2"]);
  sel.set(["s1", "s2"], "s1");
  sel.selectConn("c1");
  assert.deepEqual(heard, [
    [["s1", "s2"], "s2", { frames: true, primary: true, conn: false }],
    [["s1", "s2"], "s1", { frames: false, primary: true, conn: false }],
    [[], null, { frames: true, primary: true, conn: true }],
  ]);
});

test("a call that changes nothing tells no one", () => {
  const sel = make();
  sel.set(["s1", "s2"]);
  let n = 0;
  sel.on(() => n++);
  sel.set(["s1", "s2"]);
  sel.set([]);
  sel.set([]);
  sel.clearConn();
  sel.prune(() => true);
  sel.toggle("s2");
  sel.toggle("s2");
  assert.equal(n, 3, "set([]) once, and the two toggles");
});

test("a listener can be taken off", () => {
  const sel = make();
  let n = 0;
  const off = sel.on(() => n++);
  sel.set(["s1"]);
  off();
  sel.set(["s2"]);
  assert.equal(n, 1);
});

/* ---------- the panel follows (the bug: Inspect showed another screen than the one selected) ---------- */

test("a click on a frame: Inspect shows it", () => {
  const { sel, panel } = withInspect("s1");
  sel.set(["s2"], "s2");
  assert.equal(shown(panel), "s2");
});

test("a shift-click that adds a frame: Inspect shows the one added", () => {
  const { sel, panel } = withInspect("s1");
  sel.toggle("s2");
  assert.equal(shown(panel), "s2");
});

test("a shift-click that takes a frame out: Inspect goes to the one that is now primary", () => {
  const { sel, panel } = withInspect("s1");
  sel.toggle("s2");
  sel.toggle("s2");
  assert.equal(shown(panel), "s1");
  sel.toggle("s1");
  assert.equal(shown(panel), null, "nothing left selected: nothing to inspect");
});

test("select all: Inspect shows the primary, the last frame", () => {
  const { sel, panel } = withInspect("s1");
  sel.set(FRAMES, FRAMES.at(-1));
  assert.equal(shown(panel), "s5");
});

test("a marquee, step by step: Inspect ends on the frame the marquee ends on, however it got there", () => {
  const { sel, panel } = withInspect("s1");
  sel.set([]); /* the box has not reached anything yet */
  assert.equal(shown(panel), null);
  sel.set(["s3"], "s3");
  sel.set(["s3", "s4"], "s4");
  assert.equal(shown(panel), "s4");
  sel.set(["s3"], "s3"); /* the box shrank */
  assert.equal(shown(panel), "s3");
});

test("a drag that starts on a frame that was not selected: Inspect shows it", () => {
  const { sel, panel } = withInspect("s1");
  sel.set(["s4"], "s4");
  assert.equal(shown(panel), "s4");
});

test("deselecting: Inspect shows nothing; selecting a connector does the same", () => {
  const a = withInspect("s1");
  a.sel.set([]);
  assert.equal(shown(a.panel), null);
  const b = withInspect("s1");
  b.sel.selectConn("c1");
  assert.equal(shown(b.panel), null);
});

test("frames that go (undo, a layout put back): Inspect follows to the primary that is left", () => {
  const { sel, panel } = withInspect("s1");
  sel.set(["s1", "s2", "s3"], "s3");
  sel.prune((id) => id !== "s3");
  assert.equal(shown(panel), "s2");
  sel.prune(() => false);
  assert.equal(shown(panel), null);
});

test("the panel is not opened, and Search is not turned into Inspect, by the selection moving", () => {
  const sel = make();
  const panel = FlowPanel.create({ usesOf: () => [] });
  FlowSelection.follows(sel, panel);
  sel.set(["s1"]);
  assert.equal(panel.state().open, false);
  panel.open("search");
  sel.set(["s2"]);
  assert.deepEqual([panel.state().open, panel.state().mode, shown(panel)], [true, "search", null]);
});

test("Inspect opened later starts from the primary (what the page passes it), and follows from there", () => {
  const sel = make();
  const panel = FlowPanel.create({ usesOf: () => [] });
  FlowSelection.follows(sel, panel);
  sel.set(["s1", "s2"]);
  panel.open("inspect", sel.primary());
  assert.equal(shown(panel), "s2");
  sel.toggle("s3");
  assert.equal(shown(panel), "s3");
});

test("follows can be turned off", () => {
  const sel = make();
  const panel = FlowPanel.create({ usesOf: () => [] });
  const off = FlowSelection.follows(sel, panel);
  panel.open("inspect", null);
  sel.set(["s1"]);
  off();
  sel.set(["s2"]);
  assert.equal(shown(panel), "s1");
});

/* ---------- the page goes through it ---------- */

/* the page's script, comments left out */
const page = (() => {
  const m = html.match(/^\s*<script>\n([\s\S]*?)<\/script>/m);
  assert.ok(m, "the page's script block is not found");
  return m[1].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
})();

test("the page keeps no selection of its own, and tells the panel nothing by hand", () => {
  assert.deepEqual(page.match(/\b(selSet|selConn)\b|\blet selected\b/g) || [], [], "the old variables are gone");
  assert.deepEqual(page.match(/\bpanel\.follow\(/g) || [], [], "FlowSelection.follows is the one place the panel is told");
  assert.equal((page.match(/FlowSelection\.follows\(selection, panel\)/g) || []).length, 1);
});

test("every way the page changes the selection goes through the module", () => {
  assert.deepEqual(page.match(/\bselection\.(set|toggle|selectConn|clearConn|prune)\b/g)?.length > 0, true);
  /* the click, marquee, select-all, drag start, group, undo and reset paths all call setSel or select, which are selection.set */
  const body = (name) => page.match(new RegExp(`function ${name}\\([^)]*\\) \\{[\\s\\S]*?\\n      \\}`))?.[0] || "";
  for (const fn of ["beginDrag", "updateMarquee", "afterGrouped", "select"]) assert.match(body(fn), /\bsetSel\(/, fn);
  assert.match(page, /ORDER\.filter\(\(id\) => geo\.place\(id\) && !geo\.place\(id\)\.deck\);\s*setSel\(ids/, "select all");
  assert.match(page, /selection\.toggle\(id\)/, "shift-click");
});
