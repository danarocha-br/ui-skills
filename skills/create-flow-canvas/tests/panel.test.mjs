/* Panel: the one place that knows whether the side panel is open, what it shows (Inspect or Search, of which
   screen), which component is being swept, and how much of the viewport it takes. No page: the module is
   plain state and arithmetic; the page paints what it says.
   Run:  node --test skills/create-flow-canvas/tests/panel.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowPanel } from "./modules.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
/* three screens; Button is on a and b, Card on b only, Ghost on none */
const USES = { Button: ["a", "b"], Card: ["b"], Ghost: [] };
const make = () => {
  const panel = FlowPanel.create({ usesOf: (c) => USES[c] || [] });
  const seen = [];
  panel.on((state, change) => seen.push({ state: plain(state), change: plain(change) }));
  return { panel, seen };
};
const state = (panel) => plain(panel.state());

/* ---------- open and close ---------- */

test("a new panel is closed, with nothing to show and nothing swept", () => {
  const { panel } = make();
  assert.deepEqual(state(panel), { open: false, mode: "search", subject: null, label: "Search", sweep: null });
});

test("opening Inspect on a screen says so, and the label is the Inspector", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  assert.deepEqual(state(panel), { open: true, mode: "inspect", subject: "a", label: "Inspector", sweep: null });
  assert.equal(seen.length, 1);
  assert.equal(seen[0].change.opened, true);
});

test("Inspect can open on no screen at all", () => {
  const { panel } = make();
  panel.open("inspect");
  assert.deepEqual(state(panel), { open: true, mode: "inspect", subject: null, label: "Inspector", sweep: null });
});

test("Search has no subject: a subject handed to it is ignored", () => {
  const { panel } = make();
  panel.open("search", "a");
  assert.deepEqual(state(panel), { open: true, mode: "search", subject: null, label: "Search", sweep: null });
});

test("a mode the panel does not have is refused, naming the ones there are", () => {
  const { panel } = make();
  assert.throws(() => panel.open("settings"), /inspect.*search|search.*inspect/);
});

test("closing puts everything away; the last mode is remembered, the subject is not", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.close();
  assert.deepEqual(state(panel), { open: false, mode: "inspect", subject: null, label: "Inspector", sweep: null });
  assert.equal(seen[1].change.closed, true);
});

test("closing a closed panel does nothing and tells no one", () => {
  const { panel, seen } = make();
  panel.close();
  assert.equal(seen.length, 0);
});

test("opening what is already open, on the same subject, does nothing and tells no one", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.open("inspect", "a");
  assert.equal(seen.length, 1);
});

test("toggle opens a closed panel, closes the same mode, and switches to another", () => {
  const { panel } = make();
  panel.toggle("search");
  assert.equal(state(panel).open, true);
  panel.toggle("search");
  assert.equal(state(panel).open, false);
  panel.toggle("search");
  panel.toggle("inspect", "a");
  assert.deepEqual([state(panel).open, state(panel).mode, state(panel).subject], [true, "inspect", "a"]);
});

/* ---------- what the listener is told ---------- */

test("a listener is told what changed: opened, the mode, the subject", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.open("inspect", "b");
  panel.open("search");
  assert.deepEqual(seen.map((s) => s.change), [
    { opened: true, closed: false, mode: true, subject: true, sweep: false },
    { opened: false, closed: false, mode: false, subject: true, sweep: false },
    { opened: false, closed: false, mode: true, subject: true, sweep: false },
  ]);
});

test("a listener can be taken off", () => {
  const { panel } = make();
  const seen = [];
  const off = panel.on((s) => seen.push(s));
  panel.open("search");
  off();
  panel.close();
  assert.equal(seen.length, 1);
});

/* ---------- following the selection ---------- */

test("follow moves Inspect to the screen now selected, and only while Inspect is open", () => {
  const { panel, seen } = make();
  assert.equal(panel.follow("a"), false); /* closed */
  panel.open("search");
  assert.equal(panel.follow("a"), false); /* open, but on Search */
  assert.equal(seen.length, 1);
  panel.open("inspect", "a");
  assert.equal(panel.follow("b"), true);
  assert.equal(state(panel).subject, "b");
  assert.equal(panel.follow(null), true); /* nothing selected any more */
  assert.equal(state(panel).subject, null);
});

/* ---------- the sweep ---------- */

test("sweeping a component says which screens use it", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  assert.equal(panel.sweep("Button"), true);
  assert.deepEqual(state(panel).sweep, { component: "Button", uses: ["a", "b"] });
  assert.equal(seen[1].change.sweep, true);
});

test("sweeping the same component again changes nothing and tells no one", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  panel.sweep("Button");
  assert.equal(seen.length, 2);
});

test("toggleSweep turns a sweep on, off, and over to another component", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  panel.toggleSweep("Button");
  assert.equal(state(panel).sweep.component, "Button");
  panel.toggleSweep("Card");
  assert.equal(state(panel).sweep.component, "Card");
  panel.toggleSweep("Card");
  assert.equal(state(panel).sweep, null);
});

test("clearSweep clears it, and a second one tells no one", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  assert.equal(panel.clearSweep(), true);
  assert.equal(state(panel).sweep, null);
  const n = seen.length;
  assert.equal(panel.clearSweep(), false);
  assert.equal(seen.length, n);
});

test("a sweep only exists in Inspect: Search and a closed panel have none", () => {
  const { panel } = make();
  assert.equal(panel.sweep("Button"), false);
  panel.open("search");
  assert.equal(panel.sweep("Button"), false);
  assert.equal(state(panel).sweep, null);
});

test("a component no screen uses cannot be swept", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  assert.equal(panel.sweep("Ghost"), false);
  assert.equal(state(panel).sweep, null);
});

test("the sweep survives a change of screen: that is how you step through the screens that use it", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  panel.follow("b");
  panel.open("inspect", "a");
  assert.equal(state(panel).sweep.component, "Button");
});

test("closing clears the sweep, in the same notice that says it closed", () => {
  const { panel, seen } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  panel.close();
  assert.equal(state(panel).sweep, null);
  assert.deepEqual(seen[seen.length - 1].change, { opened: false, closed: true, mode: false, subject: true, sweep: true });
});

test("opening Search clears the sweep", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  panel.open("search");
  assert.equal(state(panel).sweep, null);
});

test("what state() hands out cannot be used to change the panel", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  panel.sweep("Button");
  panel.state().sweep.uses.push("zzz");
  assert.deepEqual(state(panel).sweep.uses, ["a", "b"]);
});

/* ---------- the inset it takes ---------- */

const none = { right: 0, bottom: 0 };
test("a closed panel takes no inset", () => {
  const { panel } = make();
  assert.deepEqual(plain(panel.insets({ width: 1440, height: 900 })), none);
});

test("on a wide window the panel takes its right side: 48% of the width, up to 560px", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  assert.deepEqual(plain(panel.insets({ width: 1000, height: 800 })), { right: 480, bottom: 0 });
  assert.deepEqual(plain(panel.insets({ width: 1440, height: 900 })), { right: 560, bottom: 0 });
});

test("on a narrow window the panel is a sheet along the bottom: 46% of the height, up to 430px", () => {
  const { panel } = make();
  panel.open("search");
  assert.deepEqual(plain(panel.insets({ width: 390, height: 800 })), { right: 0, bottom: 368 });
  assert.deepEqual(plain(panel.insets({ width: 600, height: 1200 })), { right: 0, bottom: 430 });
});

test("720 is the widest a sheet gets, as in the stylesheet: 721 is a side panel", () => {
  const { panel } = make();
  panel.open("search");
  assert.equal(panel.insets({ width: 721, height: 800 }).right > 0, true);
  assert.equal(panel.insets({ width: 720, height: 800 }).bottom > 0, true);
});

test("the inset is asked for each time, so a window that is resized is answered for its new size", () => {
  const { panel } = make();
  panel.open("inspect", "a");
  assert.deepEqual(plain(panel.insets({ width: 1000, height: 800 })), { right: 480, bottom: 0 });
  assert.deepEqual(plain(panel.insets({ width: 500, height: 800 })), { right: 0, bottom: 368 });
});
