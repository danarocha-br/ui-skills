/* The layout owns its writes (N5). Everything it holds is read-only from outside; every edit goes through a mutator,
   and a mutator keeps the layout's rules. Open or closed is view state: its own record, saved with the layout but never
   in a snapshot, so undo does not touch it. These tests run FlowLayout on its own.
   Run:  node --test skills/create-flow-canvas/tests/layout-writes.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const KEY = "flow-canvas.layout.v1";
const SCREENS = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
const DEFAULTS = {
  groups: [
    { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true, title: "Start: first run", sub: "Intro", subOn: true },
    { id: "g2", screens: ["s5", "s6", "s7"], open: false },
    { id: "g3", screens: ["s8", "s9"], open: false },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [{ id: "c1", from: "s1", to: "s2", label: "Continue" }],
  notes: [
    { id: "s1:Dana", frame: "s1", who: "Dana", text: "Hero image is big", pos: { mobile: [1, 2], tablet: [3, 4] } },
    { id: "s2:Ana", frame: "s2", who: "Ana", text: "Copy", pos: { mobile: [5, 6] } },
  ],
  scans: [{ id: "s3:states", kind: "unreachable-states", frame: "s3", source: "Denied.tsx", pos: { mobile: [10, 10] } }],
};
const memory = (seed = {}) => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
};
const make = (storage = memory(), over = {}) =>
  FlowLayout.create({
    key: KEY,
    storage,
    hasScreen: (id) => SCREENS.has(id),
    defaults: () => DEFAULTS,
    kinds: builtinKinds(() => DEFAULTS),
    ...over,
  });
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
/* the module runs in its own context, so its TypeError is not this realm's */
const frozen = (fn) => assert.throws(fn, (e) => e.name === "TypeError");
const saved = (storage) => JSON.parse(storage.data[KEY]);

/* ---------- reads are read-only ---------- */

test("what the layout holds cannot be written from outside: groups, positions, kinds, and every field in them", () => {
  const layout = make();
  frozen(() => layout.groups.push({}));
  frozen(() => (layout.groups[0].title = "x"));
  frozen(() => layout.groups[0].screens.push("s9"));
  frozen(() => (layout.groups[0].open = false));
  frozen(() => (layout.pos.mobile.s1 = { x: 1, y: 1 }));
  frozen(() => layout.notes.push({ id: "n" }));
  frozen(() => (layout.notes[0].text = "x"));
  frozen(() => (layout.notes[0].pos.mobile = [0, 0]));
  frozen(() => layout.conns.splice(0, 1));
  assert.throws(() => (layout.groups = []), /mutator|read-only/i);
  assert.throws(() => (layout.pos = {}), /mutator|read-only/i);
  assert.throws(() => (layout.notes = []), /mutator|read-only/i);
});

test("a group carries no DOM handle: the page cannot hang one on it", () => {
  const layout = make();
  frozen(() => (layout.groups[0].el = {}));
});

test("a read is the same object until something is written, then a fresh one", () => {
  const layout = make();
  const was = layout.groups;
  assert.equal(layout.groups, was);
  assert.equal(layout.groups[0], was[0]);
  layout.setGroupText("g1", { title: "New" });
  assert.notEqual(layout.groups, was);
  assert.equal(was[0].title, "Start: first run", "what was read earlier is not changed behind the reader's back");
  assert.equal(layout.groups[0].title, "New");
});

/* ---------- positions ---------- */

test("place and forgetPlaces are how a position is written and let go of, per device", () => {
  const layout = make();
  layout.place("mobile", "s1", { x: 10.4, y: 20.6 });
  layout.place("mobile", "g2", { x: 1, y: 2 });
  layout.place("tablet", "s1", { x: 5, y: 5 });
  eq(layout.pos.mobile, { s1: { x: 10, y: 21 }, g2: { x: 1, y: 2 } }, "rounded to whole pixels, a group has places too");
  layout.forgetPlaces(["s1"], "mobile");
  eq(layout.pos.mobile, { g2: { x: 1, y: 2 } });
  eq(layout.pos.tablet, { s1: { x: 5, y: 5 } }, "only that device");
  layout.forgetPlaces(["s1", "g2"]);
  eq([layout.pos.mobile, layout.pos.tablet], [{}, {}], "no device named: every device");
});

test("a place for a frame or group that does not exist is refused, and nothing changes", () => {
  const layout = make();
  const s = layout.snapshot();
  assert.equal(layout.place("mobile", "nope", { x: 1, y: 1 }), false);
  assert.equal(layout.snapshot(), s);
});

/* ---------- groups ---------- */

test("setGroupText changes a group's title, description and visibility, and nothing else", () => {
  const layout = make();
  assert.equal(layout.setGroupText("g2", { title: "Plants: pick some", sub: "Why", subOn: true }), true);
  eq(layout.groups[1], { id: "g2", screens: ["s5", "s6", "s7"], open: false, title: "Plants: pick some", sub: "Why", subOn: true });
  assert.equal(layout.setGroupText("g2", { subOn: false }), true);
  assert.equal(layout.groups[1].sub, "Why", "hiding keeps the text");
  assert.equal(layout.setGroupText("nope", { title: "x" }), false);
  assert.throws(() => layout.setGroupText("g2", { screens: [] }), /title|sub/, "only the text is its to set");
  assert.throws(() => layout.setGroupText("g2", { title: 3 }), /string/);
});

test("orderGroups reorders the groups and never adds or drops one", () => {
  const layout = make();
  layout.orderGroups(["g3", "g1"]);
  eq(layout.groups.map((g) => g.id), ["g3", "g1", "g2"], "the ones not named follow, in their order");
  layout.orderGroups(["g2", "g2", "zz", "g3", "g1"]);
  eq(layout.groups.map((g) => g.id), ["g2", "g3", "g1"], "a repeated or unknown id is ignored");
});

/* ---------- annotation kinds ---------- */

test("add puts an item of a kind in the layout; an id is never used twice, and a kind that must be valid says no", () => {
  const layout = make();
  assert.equal(layout.add("notes", { id: "n1", frame: null, who: "You", text: "hi", x: 1, y: 2 }), true);
  eq(layout.notes.at(-1), { id: "n1", frame: null, who: "You", text: "hi", x: 1, y: 2 });
  assert.throws(() => layout.add("notes", { id: "n1", text: "again" }), /n1/);
  assert.throws(() => layout.add("nope", { id: "x" }), /nope/);
  assert.throws(() => layout.add("notes", { text: "no id" }), /id/);
  assert.equal(layout.add("conns", { id: "c9", from: "s1", to: "s1", label: "Loop" }), false, "a frame cannot connect to itself");
  assert.equal(layout.add("conns", { id: "c9", from: "s1", to: "zz", label: "Lost" }), false, "nor to a frame that is not there");
  assert.equal(layout.add("notes", { id: "n2", frame: null, who: "You", text: 5 }), false, "a note has text");
});

test("an item added is a copy: changing the object the caller kept does not reach the layout", () => {
  const layout = make();
  const mine = { id: "n1", frame: null, who: "You", text: "hi", x: 1, y: 2 };
  layout.add("notes", mine);
  mine.text = "changed";
  assert.equal(layout.notes.at(-1).text, "hi");
});

test("edit changes the fields of one item: a value replaces, undefined takes the field away, the id stays", () => {
  const layout = make();
  assert.equal(layout.edit("notes", "s1:Dana", { text: "mine", x: 4, pos: undefined }), true);
  const n = layout.notes.find((x) => x.id === "s1:Dana");
  assert.equal(n.text, "mine");
  assert.equal(n.x, 4);
  assert.ok(!("pos" in n));
  assert.equal(layout.edit("notes", "gone", { text: "x" }), false);
  assert.throws(() => layout.edit("notes", "s1:Dana", { id: "other" }), /id/);
  assert.throws(() => layout.edit("nope", "s1:Dana", {}), /nope/);
});

test("an edit's values are copied in: a later change to the patch does not reach the layout", () => {
  const layout = make();
  const pos = { mobile: [7, 7] };
  layout.edit("notes", "s1:Dana", { pos });
  pos.mobile[0] = 99;
  eq(layout.notes[0].pos, { mobile: [7, 7] });
});

test("remove takes one item out, and says whether there was one", () => {
  const layout = make();
  assert.equal(layout.remove("conns", "c1"), true);
  assert.equal(layout.conns.length, 0);
  assert.equal(layout.remove("conns", "c1"), false);
  assert.throws(() => layout.remove("nope", "c1"), /nope/);
});

test("letGoOfMoves puts notes and findings back where the scan put them on one device, and leaves the other devices alone", () => {
  const layout = make();
  layout.edit("notes", "s1:Dana", { pos: { mobile: [50, 50], tablet: [3, 4] } });
  layout.edit("notes", "s2:Ana", { pos: { mobile: [60, 60], tablet: [9, 9] } });
  layout.edit("scans", "s3:states", { pos: { mobile: [70, 70], tablet: [8, 8] } });
  layout.add("notes", { id: "mine", frame: "s1", who: "You", text: "x", pos: { mobile: [1, 1] } });
  layout.letGoOfMoves("mobile");
  eq(layout.notes.find((n) => n.id === "s1:Dana").pos, { mobile: [1, 2], tablet: [3, 4] }, "the scan's own place on this device");
  eq(layout.notes.find((n) => n.id === "s2:Ana").pos, { mobile: [5, 6], tablet: [9, 9] });
  eq(layout.scans[0].pos, { mobile: [10, 10] }, "a finding goes back to the scan's places on every device");
  eq(layout.notes.find((n) => n.id === "mine").pos, { mobile: [1, 1] }, "a note the user made has no scanned place to go back to");
});

/* ---------- the groups' own mutators keep working on private state ---------- */

test("takeOut, moveInto and groupFrames write the layout and hand back read-only results", () => {
  const layout = make();
  const g = layout.groupFrames(["s9", "s1"], { device: "mobile", at: { x: 5, y: 6 } });
  assert.equal(g.id, "g4");
  eq(g.screens, ["s9", "s1"]);
  assert.equal(g.open, true, "a new group is open");
  assert.equal(layout.groups.at(-1), g);
  frozen(() => g.screens.push("s2"));
  eq(layout.pos.mobile.g4, { x: 5, y: 6 });
  layout.moveInto(["s2"], "g4", 1);
  eq(layout.groups.find((x) => x.id === "g4").screens, ["s9", "s2", "s1"]);
  layout.takeOut(["s9", "s2", "s1"]);
  assert.equal(layout.groups.find((x) => x.id === "g4"), undefined, "a group left empty goes");
});

/* ---------- view state: open or closed ---------- */

test("a group is open as the scan says until the view record says otherwise", () => {
  const layout = make();
  eq(layout.groups.map((g) => g.open), [true, false, false]);
  assert.equal(layout.setOpen("g2", true), true);
  assert.equal(layout.groups[1].open, true);
  assert.equal(layout.setOpen("g2", true), false, "already open: nothing changed");
  assert.equal(layout.setOpen(["g1", "g3", "zz"], true), true, "several at once; an unknown id is ignored");
  eq(layout.groups.map((g) => g.open), [true, true, true]);
});

test("open or closed is not in the snapshot and not in the undo history", () => {
  const layout = make();
  const s = layout.snapshot();
  layout.setOpen("g2", true);
  layout.setOpen("g1", false);
  assert.equal(layout.snapshot(), s, "the same layout, however the groups are shown");
  assert.ok(!layout.snapshot().includes("open"));
  layout.mark();
  layout.setGroupText("g1", { title: "x" });
  assert.equal(layout.undo(), true);
  eq(layout.groups.map((g) => g.open), [false, true, false], "undo undid the edit and left how the groups are shown");
});

test("how the groups are shown is saved with the layout and comes back on a reload", () => {
  const storage = memory();
  const layout = make(storage);
  layout.setOpen("g2", true);
  layout.setOpen("g1", false);
  layout.save();
  eq(saved(storage).view, { open: { g1: false, g2: true } }, "only what differs from the scan");
  eq(make(storage).groups.map((g) => g.open), [false, true, false]);
  layout.setOpen("g2", false);
  layout.save();
  eq(saved(storage).view, { open: { g1: false } }, "back to what the scan says: nothing to remember");
});

test("a group the user made is open until they close it, and remembered closed", () => {
  const storage = memory();
  const layout = make(storage);
  const g = layout.groupFrames(["s9"], { device: "mobile" });
  layout.setOpen(g.id, false);
  layout.save();
  eq(make(storage).groups.map((x) => [x.id, x.open]), [["g1", true], ["g2", false], ["g3", false], ["g4", false]]);
});

test("a group undo brings back returns with the open state it had", () => {
  const layout = make();
  layout.setOpen("g2", true);
  layout.mark();
  layout.takeOut(["s5", "s6", "s7"]); // g2 is dissolved
  assert.equal(layout.undo(), true);
  eq(layout.groups.map((l) => [l.id, l.open]), [["g1", true], ["g2", true], ["g3", false]]);
});

test("a layout saved before the view record existed (open inside the groups' edits) still loads, and opens as it was", () => {
  const old = {
    v: 3,
    lanes: { edits: { g1: { open: false }, g2: { open: true } }, mine: [{ id: "g4", open: false, title: "Mine", sub: "", subOn: false }], place: { s9: "g4" }, order: {}, seq: [] },
    pos: { mobile: {} },
    caps: { edits: {}, mine: [] },
    scans: { edits: {}, mine: [] },
    notes: { edits: {}, mine: [] },
    conns: { edits: {}, mine: [] },
    gc: 4,
    cc: 6,
  };
  const layout = make(memory({ [KEY]: JSON.stringify(old) }));
  eq(layout.groups.map((g) => [g.id, g.open]), [["g1", false], ["g2", true], ["g3", false], ["g4", false]]);
  assert.ok(!layout.snapshot().includes('"open"'), "and it is not an edit any more");
});

test("the view record names only groups that exist; what a reload finds for a gone group is dropped", () => {
  const storage = memory();
  const layout = make(storage);
  layout.setOpen("g2", true);
  layout.save();
  const s = saved(storage);
  s.view.open.zz = true;
  s.view.open.g3 = "yes";
  storage.data[KEY] = JSON.stringify(s);
  eq(make(storage).groups.map((g) => g.open), [true, true, false]);
});

test("reset puts every group back as the scan shows it", () => {
  const layout = make();
  layout.setOpen("g2", true);
  layout.setOpen("g1", false);
  layout.reset();
  eq(layout.groups.map((g) => g.open), [true, false, false]);
});

/* ---------- the snapshot is not worked out again when nothing was written ---------- */

test("snapshot is worked out once per change, however often it is asked for", () => {
  let asked = 0;
  const layout = make(memory(), {
    defaults: () => (asked++, DEFAULTS),
  });
  const s = layout.snapshot();
  const after = asked;
  for (let i = 0; i < 20; i++) assert.equal(layout.snapshot(), s);
  assert.equal(asked, after, "no more work for an unchanged layout");
  layout.place("mobile", "s1", { x: 1, y: 1 });
  assert.notEqual(layout.snapshot(), s);
  layout.place("mobile", "s1", { x: 0, y: 0 });
  layout.forgetPlaces(["s1"]);
  assert.equal(layout.snapshot(), s, "equal state, equal string");
});

/* ---------- what a mutator touched, for the commit ---------- */

test("the layout says what was touched since it was last asked, so a commit knows what to redraw", () => {
  const layout = make();
  eq(layout.takeTouched(), []);
  layout.place("mobile", "s1", { x: 1, y: 1 });
  layout.takeOut(["s2"]);
  layout.edit("conns", "c1", { label: "Go" });
  layout.edit("notes", "s1:Dana", { text: "x" });
  eq([...layout.takeTouched()].sort(), ["conns", "layout", "notes"]);
  eq(layout.takeTouched(), [], "asking clears it");
  layout.setOpen("g2", true);
  eq(layout.takeTouched(), ["layout"]);
  layout.setGroupText("g1", { title: "t" });
  eq(layout.takeTouched(), [], "text is drawn by the page as it is typed");
});

test("viewStamp changes when how the groups are shown does, and only then", () => {
  const layout = make();
  const v = layout.viewStamp();
  layout.place("mobile", "s1", { x: 1, y: 1 });
  assert.equal(layout.viewStamp(), v);
  layout.setOpen("g2", true);
  assert.notEqual(layout.viewStamp(), v);
  const w = layout.viewStamp();
  layout.setOpen("g2", true);
  assert.equal(layout.viewStamp(), w);
});
