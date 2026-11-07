/* Annotations module tests. FlowAnnotations owns what notes, scanner cards and connectors share: the
   drag (threshold, scale, cancel), the keyboard move, delete, and the "is this an annotation" check.
   Each kind brings an adapter for what is its own. These tests use a stand-in kind ("dot") whose
   positions live in layout.pos, plus the real layout and commit modules; there is no page.
   Run:  node --test skills/create-flow-canvas/tests/annotations.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit, FlowAnnotations } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const eq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const DEFAULTS = {
  groups: [{ id: "g1", screens: ["s1", "s2"], open: true }],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [],
  notes: [],
  scans: {},
};

/* a "dot" is a thing at layout.pos.mobile[id]; a target is { dot: id } (or { other: true } for anything else) */
function setup({ clock = () => 0, threshold } = {}) {
  const log = [];
  const data = {};
  const storage = { getItem: (k) => data[k] ?? null, setItem: (k, v) => void (data[k] = String(v)) };
  const layout = FlowLayout.create({ key: "k", storage, hasScreen: () => true, defaults: () => DEFAULTS, kinds: builtinKinds(DEFAULTS) });
  layout.pos.mobile.a = { x: 100, y: 100 };
  layout.pos.mobile.b = { x: 300, y: 300 };
  layout.save();
  const redraw = { world: () => log.push("redraw:world"), layout: () => log.push("redraw:layout") };
  const commit = FlowCommit.create({ layout, kinds: builtinKinds(DEFAULTS, { refresh: (name) => log.push("redraw:" + name) }), redraw });
  const dot = {
    name: "dot",
    movable: true,
    preventDefault: true,
    owns: (t) => !!t.dot,
    match: (t, how) => (t.dot && !(how === "pointer" && t.editing) ? t.dot : null),
    origin: (id) => ({ ...layout.pos.mobile[id] }),
    lift: (id) => log.push("lift:" + id),
    place: (id, pos) => log.push(`place:${id}:${pos.x},${pos.y}`),
    save: (id, pos, how) => {
      layout.pos.mobile[id] = { x: pos.x, y: pos.y };
      if (how.nudged) log.push("save:" + id + ":nudged");
    },
    settle: (id, how) => log.push(`settle:${id}:${how.moved ? "moved" : "still"}${how.cancelled ? ":cancelled" : ""}`),
    tap: (id) => log.push("tap:" + id),
    erase: (id) => delete layout.pos.mobile[id],
    erased: (id) => log.push("erased:" + id),
    redraw: ["conns"],
  };
  const caption = { name: "caption", owns: (t) => !!t.caption }; /* only takes part in the check */
  const link = { name: "link", movable: false, match: (t) => t.link || null, owns: (t) => !!t.link, erase: () => {} };
  const annotations = FlowAnnotations.create({ commit, kinds: [dot, caption, link], clock, threshold });
  return { layout, annotations, log, commit };
}

test("a press that never moves far enough is a tap: nothing is lifted, placed or saved", () => {
  const { layout, annotations, log } = setup();
  const grabbed = annotations.down({ dot: "a" }, { x: 10, y: 10 });
  eq(grabbed, { prevent: true });
  assert.equal(annotations.dragging(), true);
  annotations.move({ x: 12, y: 12 }, 1); // 2.8 px: under the 4 px threshold
  eq(annotations.up(), { moved: false });
  assert.deepEqual(log, ["tap:a", "settle:a:still"]);
  assert.equal(annotations.dragging(), false);
  assert.equal(layout.undo(), false);
});

test("past the threshold the item is lifted once and follows the pointer at world scale; letting go commits one undo step", () => {
  const { layout, annotations, log } = setup();
  annotations.down({ dot: "a" }, { x: 10, y: 10 });
  annotations.move({ x: 30, y: 10 }, 2); // 20 screen px at zoom 2 = 10 world px
  annotations.move({ x: 50, y: 30 }, 2); // 40, 20 screen px = 20, 10 world px
  assert.deepEqual(log, ["lift:a", "place:a:110,100", "place:a:120,110"]);
  log.length = 0;
  eq(annotations.up(), { moved: true });
  assert.deepEqual(log, ["redraw:conns", "settle:a:moved"]); // the adapter's own redraw kinds, then the DOM clean-up
  eq(layout.pos.mobile.a, { x: 120, y: 110 });
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile.a, { x: 100, y: 100 });
  assert.equal(layout.undo(), false);
});

test("a cancelled pointer puts the item back where it was and commits nothing", () => {
  const { layout, annotations, log } = setup();
  annotations.down({ dot: "a" }, { x: 10, y: 10 });
  annotations.move({ x: 60, y: 10 }, 1);
  log.length = 0;
  assert.equal(annotations.cancel(), true);
  assert.deepEqual(log, ["place:a:100,100", "settle:a:still:cancelled"]);
  assert.equal(annotations.dragging(), false);
  eq(layout.pos.mobile.a, { x: 100, y: 100 });
  assert.equal(layout.undo(), false);
  assert.equal(annotations.up(), null); // nothing left to release
});

test("cancelling a press that never started dragging only lets go; with nothing pressed it says so", () => {
  const { annotations, log } = setup();
  annotations.down({ dot: "a" }, { x: 10, y: 10 });
  log.length = 0;
  assert.equal(annotations.cancel(), true);
  assert.deepEqual(log, ["settle:a:still:cancelled"]);
  assert.equal(annotations.cancel(), false);
});

test("only a movable annotation can be grabbed: a miss, a kind that does not move, or an item being edited are left to the page", () => {
  const { annotations } = setup();
  assert.equal(annotations.down({ other: true }, { x: 0, y: 0 }), null);
  assert.equal(annotations.down({ link: "c1" }, { x: 0, y: 0 }), null);
  assert.equal(annotations.down({ dot: "a", editing: true }, { x: 0, y: 0 }), null);
  assert.equal(annotations.dragging(), false);
});

test("arrow keys move the focused item 8 px, 32 with Shift, each saved and redrawn; other keys and other targets are not handled", () => {
  const { layout, annotations, log } = setup();
  assert.equal(annotations.keyDown({ dot: "a" }, "ArrowRight", {}), true);
  assert.equal(annotations.keyDown({ dot: "a" }, "ArrowDown", { shift: true }), true);
  eq(layout.pos.mobile.a, { x: 108, y: 132 });
  /* a keyboard move ends like a drop: saved, redrawn, then the kind settles (a note may change frame) */
  assert.deepEqual(log, [
    "place:a:108,100", "save:a:nudged", "redraw:conns", "settle:a:moved",
    "place:a:108,132", "save:a:nudged", "redraw:conns", "settle:a:moved",
  ]);
  assert.equal(annotations.keyDown({ dot: "a" }, "x", {}), false);
  assert.equal(annotations.keyDown({ other: true }, "ArrowLeft", {}), false);
  assert.equal(annotations.keyDown({ link: "c1" }, "ArrowLeft", {}), false); // a kind that does not move
});

test("a quick burst of arrow presses on one item is one undo step; a pause, or another item, starts a new one", () => {
  let now = 0;
  const { layout, annotations } = setup({ clock: () => now });
  for (const t of [0, 100, 300]) {
    now = t;
    annotations.keyDown({ dot: "a" }, "ArrowRight", {});
  }
  eq(layout.pos.mobile.a, { x: 124, y: 100 });
  now = 400;
  annotations.keyDown({ dot: "b" }, "ArrowRight", {}); // another item
  now = 700;
  annotations.keyDown({ dot: "a" }, "ArrowRight", {}); // back to a: the burst moved on to b, so this starts a new step
  now = 1400;
  annotations.keyDown({ dot: "a" }, "ArrowRight", {}); // after a pause
  assert.equal(layout.undo(), true); // the pause one
  eq(layout.pos.mobile.a, { x: 132, y: 100 });
  assert.equal(layout.undo(), true); // a again after b
  eq(layout.pos.mobile.a, { x: 124, y: 100 });
  assert.equal(layout.undo(), true); // b
  eq(layout.pos.mobile.b, { x: 300, y: 300 });
  assert.equal(layout.undo(), true); // the first burst of three, in one step
  eq(layout.pos.mobile.a, { x: 100, y: 100 });
  assert.equal(layout.undo(), false);
});

test("Delete or Backspace on an annotation removes it as one undoable commit, then lets the kind clean up its DOM", () => {
  const { layout, annotations, log } = setup();
  assert.equal(annotations.keyDown({ dot: "a" }, "Delete", {}), true);
  assert.equal(layout.pos.mobile.a, undefined);
  assert.deepEqual(log, ["redraw:conns", "erased:a"]);
  assert.equal(annotations.keyDown({ dot: "b" }, "Backspace", {}), true);
  assert.equal(layout.pos.mobile.b, undefined);
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile.b, { x: 300, y: 300 });
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile.a, { x: 100, y: 100 });
  assert.equal(layout.undo(), false);
});

test("a key on something that is not an annotation is left alone; a kind with nothing to clean up still works", () => {
  const { annotations } = setup();
  assert.equal(annotations.keyDown({ other: true }, "Delete", {}), false);
  assert.equal(annotations.keyDown({ link: "c1" }, "Delete", {}), true);
});

test("remove(kind, id) is the same path for a × button; an unknown kind fails loudly", () => {
  const { layout, annotations, log } = setup();
  annotations.remove("dot", "a");
  assert.equal(layout.pos.mobile.a, undefined);
  assert.deepEqual(log, ["redraw:conns", "erased:a"]);
  assert.throws(() => annotations.remove("sticker", "a"), /unknown annotation kind "sticker"/);
});

test("owns(target) is true for anything any kind recognises as its own, including kinds that only take part in this check", () => {
  const { annotations } = setup();
  assert.equal(annotations.owns({ dot: "a" }), true);
  assert.equal(annotations.owns({ link: "c1" }), true);
  assert.equal(annotations.owns({ caption: true }), true);
  assert.equal(annotations.owns({ other: true }), false);
});

test("a keyboard move tells the kind it is a nudge (so a note can move in place instead of re-homing); a drop does not", () => {
  const { annotations, log } = setup();
  annotations.keyDown({ dot: "a" }, "ArrowRight", {});
  assert.ok(log.includes("save:a:nudged"));
  log.length = 0;
  annotations.down({ dot: "b" }, { x: 0, y: 0 });
  annotations.move({ x: 30, y: 0 }, 1);
  annotations.up();
  assert.ok(!log.includes("save:b:nudged"));
});

test("a drag or a click between two arrow presses ends the burst, so the next press is a new undo step", () => {
  const { layout, annotations } = setup({ clock: () => 0 });
  annotations.keyDown({ dot: "a" }, "ArrowRight", {});
  annotations.down({ dot: "b" }, { x: 0, y: 0 }); // something else happened in between
  annotations.up();
  annotations.keyDown({ dot: "a" }, "ArrowRight", {});
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile.a, { x: 108, y: 100 }); // only the second press was undone
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile.a, { x: 100, y: 100 });
});

test("the drag threshold is a setting, not a constant", () => {
  const { annotations, log } = setup({ threshold: 10 });
  annotations.down({ dot: "a" }, { x: 0, y: 0 });
  annotations.move({ x: 8, y: 0 }, 1);
  assert.deepEqual(log, []);
  annotations.move({ x: 10, y: 0 }, 1);
  assert.deepEqual(log, ["lift:a", "place:a:110,100"]);
});

test("a movable kind without origin, place or save, or a kind without a name, fails at creation rather than mid-drag", () => {
  const { commit } = setup();
  const make = (kind) => () => FlowAnnotations.create({ commit, kinds: [kind] });
  assert.throws(make({ name: "x", movable: true, origin() {}, place() {} }), /"x" is movable but has no save/);
  assert.throws(make({ movable: false }), /every kind needs a name/);
  assert.doesNotThrow(make({ name: "caption", owns: () => false }));
});

test("a kind with no owns() is simply not part of the ownership check", () => {
  const { commit } = setup();
  const quiet = FlowAnnotations.create({ commit, kinds: [{ name: "q", match: () => ({}) }] });
  assert.equal(quiet.owns({ anything: true }), false);
});
