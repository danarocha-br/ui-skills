/* Layout module tests. They run the module on its own, without a page: the script block with
   id="layout-module" is read out of assets/flow-canvas.html and evaluated in a bare context.
   Run:  node --test skills/create-flow-canvas/tests/layout.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowLayout } from "./modules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));

const KEY = "flow-canvas.layout.v1";
const SCREENS = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
const DEFAULTS = {
  groups: [
    { id: "g1", screens: ["s1", "s2", "s3", "s4"], meta: "not persisted", open: true },
    { id: "g2", screens: ["s5", "s6", "s7"], open: false },
    { id: "g3", screens: ["s8", "s9"], open: false },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [
    { id: "c1", from: "s1", to: "s2", label: "Continue" },
    { id: "c2", from: "s2", to: "s3", label: "Continue" },
    { id: "c3", from: "s3", to: "s4", label: "Allow" },
    { id: "c4", from: "s5", to: "s6", label: "Pick plant" },
    { id: "c5", from: "s6", to: "s7", label: "Add to jungle" },
    { id: "c6", from: "s8", to: "s9", label: "Start trial" },
  ],
  notes: [{ id: "s1:Dana", frame: "s1", who: "Dana", text: "Hero image is big", pos: { mobile: [1, 2] } }],
  scans: [{ id: "s3:states", kind: "unreachable-states", frame: "s3", source: "Denied.tsx" }],
};

/* the text a default group has when nothing else says otherwise: none in these defaults, so blank */
const DEFAULTS_TEXT = { g2: { title: "Untitled group", sub: "", subOn: false }, g3: { title: "Untitled group", sub: "", subOn: false } };

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
    ...over,
  });
/* the module runs in its own vm context, so compare through JSON rather than by prototype */
const eq = (actual, expected, message) =>
  assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const plain = (layout) => JSON.parse(layout.snapshot());

test("empty storage gives the defaults, without page-only fields", () => {
  const layout = make();
  eq(layout.groups.map((l) => l.id), ["g1", "g2", "g3"]);
  eq(Object.keys(layout.groups[0]), ["id", "screens", "open", "title", "sub", "subOn"]);
  assert.equal(layout.conns.length, 6);
  eq(layout.pos, { mobile: {}, tablet: {}, desktop: {} });
  eq(layout.scans.map((f) => f.id), ["s3:states"]);
  assert.equal(layout.notes[0].id, "s1:Dana");
});

test("corrupt or foreign storage gives the defaults", () => {
  for (const raw of ["{not json", "null", "[]", '{"lanes":"x"}', '"hello"', "42"]) {
    const layout = make(memory({ [KEY]: raw }));
    eq(layout.groups.map((l) => l.id), ["g1", "g2", "g3"], raw);
    assert.equal(layout.nextId("g"), "g4", raw);
  }
});

test("save then load round-trips every kind and the counters", () => {
  const storage = memory();
  const a = make(storage);
  a.groups[1].open = true;
  a.pos.mobile.s1 = { x: 10, y: 20 };
  a.conns.push({ id: a.nextId("c"), from: "s1", to: "s9", label: "Jump" });
  a.scans[0].pos = { mobile: [1, 2] };
  a.notes.push({ id: "n1", frame: null, who: "You", text: "floating", x: 5, y: 6 });
  a.groupFrames(["s9"], { device: "mobile" });
  a.save();
  const b = make(storage);
  assert.equal(b.snapshot(), a.snapshot());
  assert.equal(b.nextId("c"), "c8");
  assert.equal(b.nextId("g"), "g5");
});

/* Layouts older than v3 are not read: nothing but the author's own browser ever held one, and the module starts
   from the scan instead of guessing. It must never throw, and the scan's counters start the numbering. */
const OLD_SHAPES = {
  "the real canvas's first layout (whole groups, full lists)": () => fs.readFileSync(path.join(here, "fixtures/saved-layout-v1.json"), "utf8").trim(),
  "whole groups, with their text": () =>
    JSON.stringify({ v: 2, lanes: [{ id: "g1", screens: ["s1"], open: false, title: "Mine", sub: "", subOn: false }], pos: { mobile: { s1: { x: 5, y: 5 } } }, conns: { edits: {}, mine: [] }, cc: 6, gc: 3 }),
  "a list of groups and nothing else": () => JSON.stringify({ lanes: [{ id: "g1", screens: ["s1", "s2"], open: true }] }),
  "a list of groups with text of the wrong type": () =>
    JSON.stringify({ lanes: [{ id: "g1", screens: ["s1"], open: true, title: 7, sub: null, subOn: "yes" }], conns: [], notes: [], gc: 3 }),
};
for (const [name, raw] of Object.entries(OLD_SHAPES)) {
  test(`an older saved layout (${name}) starts from the scan, saves nothing until the next edit, and never throws`, () => {
    const storage = memory({ [KEY]: raw() });
    let layout;
    assert.doesNotThrow(() => (layout = make(storage)));
    eq(layout.groups.map((l) => [l.id, l.screens]), [["g1", ["s1", "s2", "s3", "s4"]], ["g2", ["s5", "s6", "s7"]], ["g3", ["s8", "s9"]]]);
    eq(layout.pos, { mobile: {}, tablet: {}, desktop: {} });
    eq(layout.conns.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c6"]);
    eq(layout.scans.map((f) => f.id), ["s3:states"]);
    eq(layout.notes.map((n) => n.id), ["s1:Dana"]);
    assert.equal(layout.nextId("c"), "c7");
    assert.equal(layout.nextId("g"), "g4");
    assert.equal(storage.data[KEY], raw(), "the old file is left as it was until the user edits something");
    layout.save();
    assert.equal(JSON.parse(storage.data[KEY]).v, 3, "the next save writes the current shape");
    assert.equal(make(storage).snapshot(), layout.snapshot());
  });
}

test("a current layout with one kind in an unreadable shape keeps what is readable and takes that kind from the scan", () => {
  for (const [kind, junk] of [["conns", "nope"], ["conns", [{ id: "c1" }]], ["notes", 7], ["scans", null], ["pos", "abc"], ["pos", [1, 2]]]) {
    const storage = memory();
    const first = make(storage);
    first.groups[0].title = "Mine: renamed";
    first.conns.find((c) => c.id === "c1").label = "My label";
    first.pos.mobile.s1 = { x: 3, y: 4 };
    first.save();
    const onDisk = JSON.parse(storage.data[KEY]);
    onDisk[kind] = junk;
    storage.data[KEY] = JSON.stringify(onDisk);
    let layout;
    assert.doesNotThrow(() => (layout = make(storage)), `${kind}: ${JSON.stringify(junk)}`);
    assert.equal(layout.groups[0].title, "Mine: renamed", `${kind}: groups still come from the file`);
    if (kind === "conns") assert.equal(layout.conns.find((c) => c.id === "c1").label, "Continue", "connectors fall back to the scan");
    else assert.equal(layout.conns.find((c) => c.id === "c1").label, "My label");
    if (kind === "pos") eq(layout.pos, { mobile: {}, tablet: {}, desktop: {} });
    else eq(layout.pos.mobile, { s1: { x: 3, y: 4 } });
  }
});

test("load drops what no longer exists", () => {
  const saved = {
    v: 3,
    lanes: {
      edits: {},
      /* g1 has a frame that is gone and one g2 also holds; g9 holds only a frame that is gone */
      mine: [
        { id: "g7", screens: [], open: true },
        { id: "g9", screens: [], open: true },
        null,
      ],
      place: { ghost: "g9", s2: "g2", s3: "g2" },
      order: {},
      seq: [],
    },
    pos: { mobile: { s1: { x: 1, y: 2 }, ghost: { x: 9, y: 9 } }, odd: 5 },
    conns: {
      edits: {},
      mine: [
        { id: "c9", from: "s1", to: "s2" },
        { id: "c10", from: "s1", to: "ghost" },
        { id: "c11", from: "s3", to: "s3" },
        null,
      ],
    },
    scans: "nope",
    notes: { edits: {}, mine: [{ id: "n1", text: "ok" }, { id: "n2" }, { text: "no id" }, null] },
    cc: 11,
    gc: 9,
  };
  const layout = make(memory({ [KEY]: JSON.stringify(saved) }));
  eq(layout.groups.map((g) => [g.id, g.screens]), [["g1", ["s1", "s4"]], ["g2", ["s5", "s6", "s7", "s2", "s3"]], ["g3", ["s8", "s9"]]], "a group left with no frames goes; a frame is in one group");
  eq(layout.conns.map((c) => c.id), ["c1", "c2", "c3", "c4", "c5", "c6", "c9"], "a connector to a frame that is gone, or to itself, is dropped");
  eq(layout.scans.map((f) => f.id), ["s3:states"], "unreadable findings: the scan's");
  eq(layout.notes.map((n) => n.id), ["s1:Dana", "n1"]);
  eq(layout.pos.mobile, { s1: { x: 1, y: 2 } });
  eq(Object.keys(layout.pos), ["mobile", "tablet", "desktop"], "a place that is not a device's map is not kept");
});

test("a layout whose every group the user dissolved stays empty", () => {
  const edits = { g1: { gone: true }, g2: { gone: true }, g3: { gone: true } };
  const layout = make(memory({ [KEY]: JSON.stringify({ v: 3, lanes: { edits, mine: [], place: {}, order: {}, seq: [] }, cc: 6, gc: 3 }) }));
  eq(layout.groups, []);
});

test("counters never start below an id that is already in use", () => {
  const saved = {
    v: 3,
    lanes: { edits: {}, mine: [{ id: "g7", screens: [], open: true }], place: { s1: "g7" }, order: {}, seq: [] },
    conns: { edits: {}, mine: [{ id: "c9", from: "s1", to: "s2" }] },
    cc: 2,
    gc: 0,
  };
  const layout = make(memory({ [KEY]: JSON.stringify(saved) }));
  assert.equal(layout.nextId("c"), "c10");
  assert.equal(layout.nextId("g"), "g8");
});

test("snapshot is a copy: later edits do not change it, equal state gives an equal string", () => {
  const layout = make();
  const s = layout.snapshot();
  assert.equal(layout.snapshot(), s);
  layout.groups[0].screens.push("s9");
  layout.pos.mobile.s1 = { x: 1, y: 1 };
  assert.notEqual(layout.snapshot(), s);
  layout.restore(s);
  eq(layout.groups[0].screens, ["s1", "s2", "s3", "s4"]);
});

test("snapshot leaves out page-only group fields and the counters", () => {
  const layout = make();
  Object.assign(layout.groups[0], { x: 5, top: 6, pinned: true, el: { not: "serialisable" } });
  const s = plain(layout);
  eq(Object.keys(s), ["lanes", "pos", "conns", "scans", "notes", "caps"]);
  eq(s.lanes.edits, {}, "nothing the page keeps on a group is an edit");
  assert.ok(!layout.snapshot().includes("serialisable"));
});

test("restore puts a snapshot back, replaces the live objects, and saves", () => {
  const storage = memory();
  const layout = make(storage);
  const s = layout.snapshot();
  layout.groups.length = 0;
  layout.conns.push({ id: "c99", from: "s1", to: "s9" });
  layout.notes = [];
  layout.restore(s);
  assert.equal(layout.snapshot(), s);
  assert.equal(make(storage).groups.length, 3);
  // later edits to the restored state do not reach the snapshot string
  layout.groups[0].title = "changed";
  eq(JSON.parse(s).lanes.edits, {});
});

test("restore leaves the counters alone, so undone ids are not reused", () => {
  const layout = make();
  const s = layout.snapshot();
  assert.equal(layout.nextId("c"), "c7");
  layout.restore(s);
  assert.equal(layout.nextId("c"), "c8");
});

test("history: marks come back last-in first-out, and an empty history says so", () => {
  const layout = make();
  layout.mark();
  layout.pos.mobile.s1 = { x: 1, y: 1 };
  layout.mark();
  layout.pos.mobile.s1 = { x: 2, y: 2 };
  layout.pos.mobile.s2 = { x: 3, y: 3 };
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, { s1: { x: 1, y: 1 } });
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {});
  assert.equal(layout.undo(), false);
  eq(layout.pos.mobile, {});
});

test("history: mark(s) takes a snapshot from earlier, and keeps 40", () => {
  const layout = make();
  const before = layout.snapshot();
  layout.pos.mobile.s1 = { x: 1, y: 1 };
  layout.mark(before);
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {});
  for (let i = 0; i < 45; i++) {
    layout.pos.mobile.s1 = { x: i, y: 0 };
    layout.mark();
  }
  let undone = 0;
  while (layout.undo()) undone++;
  assert.equal(undone, 40);
  // marks 0 to 4 were dropped: the oldest state still reachable is the one marked at x = 5
  eq(layout.pos.mobile.s1, { x: 5, y: 0 });
});

test("reset returns the defaults with the counters at their starting point, and saves", () => {
  const storage = memory();
  const layout = make(storage);
  layout.nextId("c");
  layout.nextId("g");
  layout.nextId("g");
  layout.groups.length = 0;
  layout.conns.length = 0;
  layout.pos.mobile.s1 = { x: 1, y: 1 };
  layout.reset();
  eq(layout.groups.map((l) => l.id), ["g1", "g2", "g3"]);
  assert.equal(layout.conns.length, 6);
  eq(layout.pos.mobile, {});
  assert.equal(layout.nextId("g"), "g4");
  assert.equal(layout.nextId("c"), "c7");
  assert.equal(make(storage).groups.length, 3);
});

test("reset hands out fresh copies, so editing after a reset never touches the defaults", () => {
  const layout = make();
  layout.reset();
  layout.groups[0].screens.push("s9");
  layout.conns[0].label = "changed";
  layout.notes[0].text = "changed";
  layout.pos.mobile.s1 = { x: 1, y: 1 };
  eq(DEFAULTS.groups[0].screens, ["s1", "s2", "s3", "s4"]);
  assert.equal(DEFAULTS.conns[0].label, "Continue");
  assert.equal(DEFAULTS.notes[0].text, "Hero image is big");
  eq(DEFAULTS.pos.mobile, {});
  layout.reset();
  eq(layout.groups[0].screens, ["s1", "s2", "s3", "s4"]);
});

test("nextId counts up per kind and refuses unknown kinds", () => {
  const layout = make();
  eq([layout.nextId("c"), layout.nextId("c"), layout.nextId("g")], ["c7", "c8", "g4"]);
  assert.throws(() => layout.nextId("x"), /unknown kind/);
});

test("a storage that throws neither breaks loading nor saving", () => {
  const broken = {
    getItem() {
      throw new Error("blocked");
    },
    setItem() {
      throw new Error("quota");
    },
  };
  const layout = make(broken);
  assert.equal(layout.groups.length, 3);
  assert.doesNotThrow(() => layout.save());
  assert.doesNotThrow(() => layout.reset());
  layout.mark();
  assert.equal(layout.undo(), true);
});

test("restore keeps each group's current open state: open or closed is view state, not an edit", () => {
  const layout = make();
  layout.mark(); // g1 open, g2 closed
  layout.groups[0].screens.pop(); // an edit
  layout.groups[0].open = false; // collapsed since
  layout.groups[1].open = true; // expanded since
  assert.equal(layout.undo(), true);
  eq(layout.groups[0].screens, ["s1", "s2", "s3", "s4"]); // the edit is undone
  assert.equal(layout.groups[0].open, false); // the collapse stays
  assert.equal(layout.groups[1].open, true); // the expand stays
});

test("a group that comes back through restore returns with the open state it had", () => {
  const layout = make();
  layout.groups[1].open = true;
  layout.mark();
  layout.groups.splice(1, 1); // the group is dissolved
  assert.equal(layout.undo(), true);
  eq(layout.groups.map((l) => [l.id, l.open]), [["g1", true], ["g2", true], ["g3", false]]);
});

test("restore never leaves a counter below an id it has just brought back, so undoing a reset cannot hand out a used id", () => {
  const layout = make();
  layout.groupFrames(["s9"], { device: "mobile" }); // g4
  layout.conns.push({ id: "c7", from: "s1", to: "s9", label: "Jump" });
  layout.mark();
  layout.reset(); // counters back to c6 / g3
  assert.equal(layout.undo(), true); // the groups and connectors come back, c7 among them
  assert.equal(layout.nextId("c"), "c8");
  assert.equal(layout.nextId("g"), "g5");
});

/* layout.groupFrames: the one data change that makes a group out of frames (⌘G and a drop onto a frame share it) */
test("groupFrames takes the frames out of their groups, drops empty groups, and adds one new group, in the order given", () => {
  const layout = make();
  const g = layout.groupFrames(["s6", "s1", "s5"], { device: "mobile" });
  assert.equal(g.id, "g4");
  eq(g.screens, ["s6", "s1", "s5"]);
  assert.equal(g.open, true);
  assert.equal(layout.groups.at(-1), g);
  eq(layout.groups.map((l) => [l.id, l.screens]), [
    ["g1", ["s2", "s3", "s4"]],
    ["g2", ["s7"]],
    ["g3", ["s8", "s9"]],
    ["g4", ["s6", "s1", "s5"]],
  ]);
  const emptied = make().groupFrames(["s8", "s9"], { device: "mobile" });
  assert.equal(emptied.id, "g4");
});

test("groupFrames leaves no empty group behind", () => {
  const layout = make();
  layout.groupFrames(["s8", "s9"], { device: "mobile" });
  eq(layout.groups.map((l) => l.id), ["g1", "g2", "g4"]);
});

test("groupFrames forgets the frames' own places on every device and pins the group only when asked", () => {
  const layout = make();
  layout.pos.mobile = { s1: { x: 1, y: 1 }, s7: { x: 2, y: 2 } };
  layout.pos.tablet = { s1: { x: 3, y: 3 } };
  const g = layout.groupFrames(["s1", "s7"], { device: "mobile" });
  eq(layout.pos, { mobile: {}, tablet: {}, desktop: {} });
  const h = layout.groupFrames(["s2"], { device: "mobile", at: { x: 10.4, y: 20.6 } });
  eq(layout.pos.mobile, { [h.id]: { x: 10, y: 21 } });
  assert.notEqual(g.id, h.id);
});

test("groupFrames is a change like any other: snapshot, undo", () => {
  const layout = make();
  const before = layout.snapshot();
  layout.mark();
  layout.groupFrames(["s1", "s2"], { device: "mobile" });
  assert.notEqual(layout.snapshot(), before);
  assert.equal(layout.undo(), true);
  assert.equal(layout.snapshot(), before);
});

/* the three small questions a drag, a group and a ungroup all ask of the groups */
test("groupOf says which group a frame is in, or nothing for a loose frame", () => {
  const layout = make();
  assert.equal(layout.groupOf("s6").id, "g2");
  assert.equal(layout.groupOf("s6"), layout.groups[1], "the group itself, not a copy");
  layout.groups[1].screens = [];
  assert.equal(layout.groupOf("s6"), undefined);
});

test("takeOut removes frames from every group and drops a group it leaves empty, leaving their places alone", () => {
  const layout = make();
  layout.pos.mobile = { s8: { x: 1, y: 2 } };
  layout.takeOut(["s8", "s9", "s1"]);
  eq(layout.groups.map((l) => [l.id, l.screens]), [["g1", ["s2", "s3", "s4"]], ["g2", ["s5", "s6", "s7"]]]);
  eq(layout.pos.mobile, { s8: { x: 1, y: 2 } }, "where a frame was put on a device is not a group's business");
});

test("takeOut with nothing to take still drops the groups that are already empty", () => {
  const layout = make();
  layout.groups[2].screens = [];
  layout.takeOut([]);
  eq(layout.groups.map((l) => l.id), ["g1", "g2"]);
});

test("moveInto puts frames into a group at a slot, takes them out of the others, and forgets their own places", () => {
  const layout = make();
  layout.pos.mobile = { s1: { x: 1, y: 1 }, g2: { x: 9, y: 9 } };
  layout.pos.desktop = { s1: { x: 3, y: 3 } };
  layout.moveInto(["s1", "s2"], "g2", 1);
  eq(layout.groups.map((l) => [l.id, l.screens]), [
    ["g1", ["s3", "s4"]],
    ["g2", ["s5", "s1", "s2", "s6", "s7"]],
    ["g3", ["s8", "s9"]],
  ]);
  eq(layout.pos, { mobile: { g2: { x: 9, y: 9 } }, tablet: {}, desktop: {} }, "a group's own place stays; the frames' are gone");
});

test("moveInto drops a group it empties, but not the group the frames are going into", () => {
  const layout = make();
  layout.moveInto(["s8", "s9"], "g1", 0);
  eq(layout.groups.map((l) => [l.id, l.screens]), [["g1", ["s8", "s9", "s1", "s2", "s3", "s4"]], ["g2", ["s5", "s6", "s7"]]]);
  /* all of a group's frames, back into that group: it is still there */
  const again = make();
  again.moveInto(["s8", "s9"], "g3", 0);
  eq(again.groups.map((l) => [l.id, l.screens]).at(-1), ["g3", ["s8", "s9"]]);
});
