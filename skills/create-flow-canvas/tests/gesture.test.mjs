/* Gesture module tests. FlowGesture holds a drag as a *proposal* outside the layout and commits it once, on the
   drop. These tests run it with the real layout, commit and geometry modules and a recording stand-in for the page
   (the adapter: what to show, what to clean up; showing a preview arranges the geometry again, as the page does). No DOM.
   Run:  node --test skills/create-flow-canvas/tests/gesture.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowDevice, FlowGeometry, FlowLayout, FlowCommit, FlowGesture } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const KEY = "flow-canvas.layout.v1";
const DEFAULTS = () => ({
  groups: [
    { id: "g1", screens: ["s1", "s2", "s3"], open: true },
    { id: "g2", screens: ["s4", "s5"], open: true },
    { id: "g3", screens: ["s6"], open: false },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [],
  notes: [],
  scans: {},
});
/* a canvas on the mobile device: three groups stacked down the left, far enough apart that their bands do not meet, and
   two loose frames on the right. Where they are is the test's, as the saved positions are the page's. */
const M = FlowDevice.describe("mobile").metrics;
const { WORLD } = FlowGeometry;
const FIXED = { g1: { x: 0, y: 0 }, g2: { x: 0, y: 1400 }, g3: { x: 0, y: 2800 }, s7: { x: 6000, y: 0 }, s8: { x: 6000, y: 1500 } };
const FRAMES = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8"];
const GROUPS = () => DEFAULTS().groups.map(({ id, screens, open }) => ({ id, screens, open }));
/* the arrangement the canvas starts in: where a frame is, and so where a pointer must be to drop it somewhere */
const REF = FlowGeometry.create({ reduceMotion: true });
REF.setMetrics(M);
REF.retarget({ groups: GROUPS(), screens: FRAMES, pos: FIXED }, 0, { snap: true });
/* a frame is pressed at its own corner, so the pointer is the frame's corner and the frame's centre is half a frame in */
const slot = (g, i) => REF.slotPlace(g, i); /* over slot i of an open group */
const deck = (g) => ({ x: REF.box(g).x, y: REF.box(g).top - 200 }); /* over a closed group's deck */
const corner = (id) => ({ x: REF.place(id).x, y: REF.place(id).y });

function setup({ pos = {} } = {}) {
  const log = []; /* "save", "redraw:layout", "show", "settle:<ids>" in the order they happened */
  const data = {};
  const storage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
      log.push("save");
    },
  };
  const layout = FlowLayout.create({
    key: KEY,
    storage,
    hasScreen: (id) => /^s\d$/.test(id),
    defaults: () => {
      const d = DEFAULTS();
      Object.assign(d.pos.mobile, pos);
      return d;
    },
    kinds: builtinKinds(),
  });
  const redraw = {
    world: () => log.push("redraw:world"),
    layout: () => {
      log.push("redraw:layout");
      arrange();
    },
  };
  const kinds = builtinKinds({}, { refresh: (name) => log.push("redraw:" + name) });
  const commit = FlowCommit.create({ layout, kinds, redraw });
  const shown = [];
  /* the page arranges the geometry again whenever it draws: after a commit, and for every preview */
  const geo = FlowGeometry.create({ reduceMotion: true });
  geo.setMetrics(M);
  let gesture;
  const arrange = () => {
    const v = gesture.view();
    geo.retarget({ groups: v.groups.map(({ id, screens, open }) => ({ id, screens, open })), screens: FRAMES, pos: { ...FIXED, ...v.pos } }, 0, { snap: true });
  };
  const adapter = {
    show: (preview) => {
      shown.push(preview);
      log.push("show");
      arrange();
    },
    settle: (ids) => log.push("settle:" + ids.join(",")),
  };
  gesture = FlowGesture.create({ layout, commit, device: () => "mobile", geo, frames: FRAMES, now: () => 0, adapter });
  arrange();
  const begin = gesture.begin;
  /* a frame press without a pointer is at the frame's own corner */
  gesture.begin = (press) => begin(press.kind === "frame" && !press.pointer ? { ...press, pointer: corner(press.pid) } : press);
  return { layout, commit, gesture, log, shown, geo };
}
const eq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const ids = (layout, g) => layout.groups.find((l) => l.id === g).screens;

test("dragging a frame into another group is a proposal: the layout is not touched until the drop", () => {
  const { layout, gesture } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  const p = gesture.move(slot("g2", 1)); /* over g2, between its two frames */
  eq(p, { kind: "into", id: "g2", idx: 1 });
  assert.equal(layout.snapshot(), before, "the model is exactly as it was");
  eq(ids(layout, "g1"), ["s1", "s2", "s3"]);
  /* what the canvas arranges while the drag is live is the layout as it would be */
  const view = gesture.view();
  eq(view.groups.find((g) => g.id === "g2").screens, ["s4", "s1", "s5"]);
  eq(view.groups.find((g) => g.id === "g1").screens, ["s2", "s3"]);
  assert.equal(layout.undo(), false, "no undo step was made by moving");
});

test("the drop commits once: the frame is in the new group, in its slot, and one undo undoes it", () => {
  const { layout, gesture } = setup({ pos: { s1: { x: 5, y: 5 } } });
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  gesture.move(slot("g2", 1));
  const out = gesture.end();
  eq(ids(layout, "g1"), ["s2", "s3"]);
  eq(ids(layout, "g2"), ["s4", "s1", "s5"]);
  eq(layout.pos.mobile, {}, "a frame in a group has no place of its own");
  assert.deepEqual({ kind: out.kind, group: out.group, moved: out.moved }, { kind: "into", group: "g2", moved: true });
  assert.equal(layout.undo(), true);
  assert.equal(layout.snapshot(), before);
  assert.equal(layout.undo(), false, "that was the only step");
  assert.equal(gesture.active(), false);
});

test("reordering inside a group is a drop into the same group, not a move", () => {
  const { layout, gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  eq(gesture.move(slot("g1", 2)), { kind: "into", id: "g1", idx: 2 });
  const out = gesture.end();
  eq(ids(layout, "g1"), ["s2", "s3", "s1"]);
  assert.deepEqual({ group: out.group, moved: out.moved }, { group: "g1", moved: false });
});

test("a closed group takes the frame at its end", () => {
  const { layout, gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  eq(gesture.move(deck("g3")), { kind: "into", id: "g3", idx: 1 });
  gesture.end();
  eq(ids(layout, "g3"), ["s6", "s1"]);
});

test("a free drop takes the frames out of their group and keeps where they were let go", () => {
  const { layout, gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s1", "s2"], pid: "s1" });
  const p = gesture.move({ x: 2500.4, y: 1000.6 });
  assert.equal(p.kind, "loose");
  const out = gesture.end();
  eq(ids(layout, "g1"), ["s3"]);
  /* each keeps its offset from the frame under the pointer: s2 stands a slot right of s1 */
  const dx = slot("g1", 1).x - slot("g1", 0).x;
  eq(layout.pos.mobile, { s1: { x: 2500, y: 1001 }, s2: { x: Math.round(2500.4 + dx), y: 1001 } });
  assert.deepEqual({ kind: out.kind, moved: out.moved }, { kind: "loose", moved: true });
  layout.undo();
  eq(ids(layout, "g1"), ["s1", "s2", "s3"]);
  eq(layout.pos.mobile, {});
});

test("a free drop of the last frame of a group removes the empty group", () => {
  const { layout, gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s6"], pid: "s6" });
  gesture.move({ x: 2500, y: 1000 });
  gesture.end();
  eq(layout.groups.map((l) => l.id), ["g1", "g2"]);
  layout.undo();
  eq(layout.groups.map((l) => l.id), ["g1", "g2", "g3"]);
});

test("dropping a frame from a group onto a loose frame makes a group pinned at that frame", () => {
  const { layout, gesture } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  eq(gesture.move(corner("s7")), { kind: "merge", id: "s7" });
  assert.equal(layout.snapshot(), before, "still only a proposal");
  const out = gesture.end();
  assert.equal(out.kind, "merge");
  assert.equal(out.group.id, "g4");
  eq(out.ids, ["s7", "s1"]);
  eq(layout.groups.find((l) => l.id === "g4").screens, ["s7", "s1"]);
  eq(ids(layout, "g1"), ["s2", "s3"]);
  /* the group sits where the frame it was dropped on was, though one of its frames came from a group */
  eq(layout.pos.mobile.g4, { x: 6000, y: -WORLD.head });
  assert.equal(layout.undo(), true);
  assert.equal(layout.snapshot(), before, "one step undoes the whole merge");
});

test("dropping loose frames onto a loose frame merges them, pinned at that frame", () => {
  const { layout, gesture } = setup({ pos: { s8: FIXED.s8 } });
  gesture.begin({ kind: "frame", ids: ["s8"], pid: "s8" });
  eq(gesture.move(corner("s7")), { kind: "merge", id: "s7" });
  gesture.end();
  eq(layout.groups.find((l) => l.id === "g4").screens, ["s7", "s8"]);
  eq(layout.pos.mobile, { g4: { x: 6000, y: -WORLD.head } }, "the frames' own places are gone; the group has one");
});

test("a merge that takes the last frame of a group leaves no empty group behind", () => {
  const { layout, gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s6"], pid: "s6" });
  gesture.move(corner("s7"));
  gesture.end();
  eq(layout.groups.map((l) => l.id), ["g1", "g2", "g4"]);
});

test("a frame is never proposed as a merge with itself or with a frame in a group", () => {
  const { gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s7"], pid: "s7" });
  assert.equal(gesture.move(corner("s7")).kind, "loose", "over itself");
});

test("a group dragged by its grip is a proposed move: its place changes only on the drop", () => {
  const { layout, gesture } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "group", id: "g2", pointer: { x: 10, y: 10 } });
  eq(gesture.move({ x: 40, y: -10 }), { kind: "move", id: "g2", at: { x: 30, y: 1380 } });
  assert.equal(layout.snapshot(), before);
  eq(gesture.view().pos.g2, { x: 30, y: 1380 });
  assert.equal(layout.pos.mobile.g2, undefined);
  gesture.end();
  eq(layout.pos.mobile.g2, { x: 30, y: 1380 });
  layout.undo();
  assert.equal(layout.snapshot(), before);
});

test("cancel throws the proposal away: the layout is as it was, nothing saved, no undo step", () => {
  const { layout, gesture, log } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1", "s2"], pid: "s1" });
  gesture.move(slot("g2", 1));
  gesture.move(corner("s7"));
  log.length = 0;
  assert.equal(gesture.cancel(), true);
  assert.equal(layout.snapshot(), before);
  assert.equal(layout.undo(), false);
  assert.equal(gesture.active(), false);
  assert.ok(!log.includes("save"), "nothing was written");
  assert.deepEqual(log, ["settle:s1,s2", "redraw:layout"], "cleaned up, then the page is drawn from the layout again");
  eq(gesture.view().groups.map((g) => g.screens), [["s1", "s2", "s3"], ["s4", "s5"], ["s6"]]);
});

test("cancelling a group drag leaves the group where it was", () => {
  const { layout, gesture } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "group", id: "g1", pointer: { x: 0, y: 0 } });
  gesture.move({ x: 300, y: 300 });
  gesture.cancel();
  assert.equal(layout.snapshot(), before);
  assert.equal(gesture.view().pos.g1, undefined);
});

test("after a cancel (Escape, pointercancel) the rest of the press does nothing", () => {
  const { layout, gesture, log } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  gesture.move(slot("g2", 1));
  gesture.cancel();
  log.length = 0;
  assert.equal(gesture.move(slot("g2", 1)), null);
  assert.equal(gesture.end(), null);
  assert.equal(gesture.cancel(), false, "a second cancel is harmless");
  assert.deepEqual(log, [], "no redraw, no save, no clean-up twice");
  assert.equal(layout.snapshot(), before);
});

test("the page is told what to show: held frames, the group to light up, the frame to merge into", () => {
  const { gesture, shown } = setup();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  let p = shown.at(-1);
  assert.equal(p.kind, "frame");
  eq(p.held, { s1: corner("s1") });
  gesture.move(slot("g2", 1));
  p = shown.at(-1);
  assert.equal(p.dropGroup, "g2");
  assert.equal(p.mergeFrame, null);
  assert.equal(p.regrouped, true);
  gesture.move({ x: slot("g2", 1).x + 10, y: slot("g2", 1).y }); /* still g2, slot 1: the arrangement does not change */
  p = shown.at(-1);
  assert.equal(p.regrouped, false);
  eq(p.held, { s1: { x: slot("g2", 1).x + 10, y: slot("g2", 1).y } });
  gesture.move(corner("s7"));
  p = shown.at(-1);
  assert.equal(p.dropGroup, null);
  assert.equal(p.mergeFrame, "s7");
  gesture.move({ x: 3000, y: 3000 });
  p = shown.at(-1);
  assert.equal(p.dropGroup, null);
  assert.equal(p.mergeFrame, null);
});

test("a group drag is shown as a group drag", () => {
  const { gesture, shown } = setup();
  gesture.begin({ kind: "group", id: "g2", pointer: { x: 0, y: 0 } });
  gesture.move({ x: 5, y: 5 });
  assert.equal(shown.at(-1).kind, "group");
  assert.equal(shown.at(-1).regrouped, true);
});

test("a frame held over its own slot proposes nothing: no group lights up and the arrangement is not redrawn", () => {
  const { gesture, shown } = setup();
  gesture.begin({ kind: "frame", ids: ["s2"], pid: "s2" });
  eq(gesture.move(slot("g1", 1)), { kind: "stay" });
  assert.equal(shown.at(-1).regrouped, false);
  assert.equal(shown.at(-1).dropGroup, null);
  eq(gesture.view().groups.map((g) => g.screens), [["s1", "s2", "s3"], ["s4", "s5"], ["s6"]]);
  /* once it has been somewhere else, coming back to its own slot is a proposal like any other */
  gesture.move(slot("g2", 1));
  assert.equal(shown.at(-1).dropGroup, "g2");
  eq(gesture.move(slot("g1", 1)), { kind: "into", id: "g1", idx: 1 });
  assert.equal(shown.at(-1).regrouped, true);
  assert.equal(shown.at(-1).dropGroup, "g1");
});

test("a loose frame dragged over empty canvas is a free proposal that follows the pointer without a redraw", () => {
  const { gesture, shown } = setup();
  gesture.begin({ kind: "frame", ids: ["s7"], pid: "s7" });
  eq(gesture.move({ x: 2600, y: 900 }), { kind: "loose", at: { s7: { x: 2600, y: 900 } } });
  assert.equal(shown.at(-1).regrouped, false);
  eq(gesture.move({ x: 2700, y: 950 }), { kind: "loose", at: { s7: { x: 2700, y: 950 } } });
});

test("if the layout changes under a live drag (undo, group), the drop is discarded instead of applied to stale data", () => {
  const { layout, gesture, log } = setup();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  gesture.move(slot("g2", 1)); /* over g2 */
  layout.mark();
  layout.takeOut(layout.groups.find((l) => l.id === "g2").screens); /* ⌘Z or ⌘⇧G took the group away meanwhile */
  const changed = layout.snapshot();
  log.length = 0;
  const out = gesture.end();
  assert.equal(out.kind, "stay");
  assert.equal(layout.snapshot(), changed, "the drop did not write anything");
  assert.deepEqual(log, ["settle:s1", "redraw:layout"]);
  assert.equal(gesture.active(), false);
});

test("a drop with no change is no undo step, but the page still settles and draws (frames slide home)", () => {
  const { layout, gesture, log } = setup();
  gesture.begin({ kind: "frame", ids: ["s2"], pid: "s2" });
  eq(gesture.move(slot("g1", 1)), { kind: "stay" });
  log.length = 0;
  const out = gesture.end();
  eq(ids(layout, "g1"), ["s1", "s2", "s3"]);
  assert.equal(layout.undo(), false);
  assert.ok(!log.includes("save"));
  assert.deepEqual(log, ["settle:s2", "redraw:layout"]);
  assert.equal(out.kind, "stay", "it never left its own slot, so there is nothing to say was moved or reordered");
});

test("pressing and letting go without moving changes nothing and does not move the frames", () => {
  const { layout, gesture, log } = setup();
  const before = layout.snapshot();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  log.length = 0;
  gesture.end();
  assert.equal(layout.snapshot(), before);
  assert.equal(layout.undo(), false);
});

test("a drag that starts while one is live refuses, so two never share a proposal", () => {
  const { gesture } = setup();
  gesture.begin({ kind: "frame", ids: ["s1"], pid: "s1" });
  assert.throws(() => gesture.begin({ kind: "group", id: "g1", pointer: { x: 0, y: 0 } }), /already/);
});
