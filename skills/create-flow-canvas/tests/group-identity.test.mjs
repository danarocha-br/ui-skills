/* Group identity tests. A group's title, description and "description shown" flag live on the group
   inside the layout, so they are saved with it, undone with it, reset with it and gone when the group
   is. These run the layout (and commit) modules on their own, with an in-memory storage.
   Run:  node --test skills/create-flow-canvas/tests/group-identity.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit } from "./modules.mjs";

const KEY = "flow-canvas.layout.v1";
const SCREENS = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
const DEFAULTS = {
  lanes: [
    { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true, title: "Onboarding: how fast to a first plant?", sub: "Four screens.", subOn: true },
    { id: "g2", screens: ["s5", "s6", "s7"], open: false, title: "First use: add a plant", sub: "A dialog over Home.", subOn: true },
    { id: "g3", screens: ["s8", "s9"], open: false, title: "Upgrade: ask once", sub: "Reached from Settings.", subOn: true },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [],
  notes: [],
  scans: {},
};

const memory = (seed = {}) => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
};
const make = (storage = memory(), over = {}) =>
  FlowLayout.create({ key: KEY, storage, hasScreen: (id) => SCREENS.has(id), defaults: () => DEFAULTS, ...over });
/* the module runs in its own vm context, so compare through JSON rather than by prototype */
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const lane = (layout, id) => layout.lanes.find((l) => l.id === id);

/* a group made the way the page does it: a new id, a blank title, pushed onto the layout */
function addGroup(layout, screens) {
  const g = layout.newGroup(screens);
  layout.lanes.push(g);
  return g;
}

test("the original bug: a group named Billing, Reset layout, a new group with the same id has a blank name", () => {
  const layout = make();
  const billing = addGroup(layout, ["s9"]);
  billing.title = "Billing";
  assert.equal(billing.id, "g4");
  layout.reset();
  const again = addGroup(layout, ["s9"]);
  assert.equal(again.id, "g4");
  assert.equal(FlowLayout.groupName(again), "Untitled group");
  assert.equal(again.sub, "");
  assert.equal(again.subOn, false);
});

test("a new group starts blank and open, with no description shown", () => {
  const layout = make();
  eq(layout.newGroup(["s9"]), { id: "g4", screens: ["s9"], open: true, title: "Untitled group", sub: "", subOn: false });
});

test("a group's name is the part of its title before the colon, and reading it never changes anything", () => {
  const layout = make();
  const before = layout.snapshot();
  assert.equal(FlowLayout.groupName(lane(layout, "g1")), "Onboarding");
  assert.equal(FlowLayout.groupName({ id: "g9" }), "Untitled group");
  assert.equal(FlowLayout.groupName({ id: "g9", title: "   " }), "Untitled group");
  assert.equal(FlowLayout.groupName({ id: "g9", title: ": only a sentence" }), "Untitled group");
  assert.equal(layout.snapshot(), before);
});

test("title, description and its visibility are saved with the layout and come back on load", () => {
  const storage = memory();
  const a = make(storage);
  lane(a, "g3").screens = ["s8"];
  const g = addGroup(a, ["s9"]);
  Object.assign(g, { title: "Billing", sub: "Pay once", subOn: true });
  lane(a, "g1").title = "Welcome";
  a.save();
  const b = make(storage);
  assert.equal(b.snapshot(), a.snapshot());
  eq(lane(b, "g4"), { id: "g4", screens: ["s9"], open: true, title: "Billing", sub: "Pay once", subOn: true });
  assert.equal(lane(b, "g1").title, "Welcome");
});

test("the snapshot carries the text: rename, then undo through the commit seam puts the old name back", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, redraw: { world() {}, layout() {}, scans() {}, notes() {}, conns() {} } });
  const g = commit(() => addGroup(layout, ["s9"]));
  commit(() => {
    lane(layout, g.id).title = "Billing";
  });
  commit(() => {
    lane(layout, g.id).title = "Payments";
  });
  assert.equal(lane(layout, "g4").title, "Payments");
  assert.equal(layout.undo(), true);
  assert.equal(lane(layout, "g4").title, "Billing");
  assert.equal(layout.undo(), true);
  assert.equal(lane(layout, "g4").title, "Untitled group");
  assert.equal(layout.undo(), true);
  assert.equal(lane(layout, "g4"), undefined);
});

test("undoing a group's creation leaves no name behind, and a later group with that id starts blank", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, redraw: { world() {}, layout() {}, scans() {}, notes() {}, conns() {} } });
  commit(() => addGroup(layout, ["s9"]));
  commit(() => {
    lane(layout, "g4").title = "Billing";
  });
  layout.undo();
  layout.undo();
  assert.equal(lane(layout, "g4"), undefined);
  assert.ok(!layout.snapshot().includes("Billing"));
});

test("a group that leaves the layout (as a dissolved one does) takes its name with it, and undo brings both back", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, redraw: { world() {}, layout() {}, scans() {}, notes() {}, conns() {} } });
  commit(() => {
    lane(layout, "g3").title = "Upgrade: pay";
  });
  commit(() => {
    layout.lanes = layout.lanes.filter((l) => l.id !== "g3"); /* what dissolveGroup ends in: no frames, pruned */
  });
  assert.ok(!layout.snapshot().includes("Upgrade: pay"));
  assert.equal(layout.undo(), true);
  assert.equal(lane(layout, "g3").title, "Upgrade: pay");
});

test("Reset layout puts every default group's text back and drops the added groups with theirs", () => {
  const layout = make();
  lane(layout, "g1").title = "My own name";
  lane(layout, "g1").sub = "";
  lane(layout, "g1").subOn = false;
  addGroup(layout, ["s9"]).title = "Billing";
  layout.reset();
  eq(lane(layout, "g1"), { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true, title: "Onboarding: how fast to a first plant?", sub: "Four screens.", subOn: true });
  assert.ok(!layout.snapshot().includes("Billing"));
});

test("undoing a Reset layout brings back the group as it was named", () => {
  const layout = make();
  addGroup(layout, ["s9"]).title = "Billing";
  layout.mark();
  layout.reset();
  assert.equal(layout.undo(), true);
  assert.equal(lane(layout, "g4").title, "Billing");
});

test("resetGroupText puts the scanned text on default groups and blanks the rest, without touching membership", () => {
  const layout = make();
  lane(layout, "g2").title = "Mine";
  lane(layout, "g2").subOn = false;
  lane(layout, "g2").screens = ["s5"];
  const added = addGroup(layout, ["s9"]);
  Object.assign(added, { title: "Billing", sub: "x", subOn: true });
  layout.resetGroupText();
  eq(lane(layout, "g2"), { id: "g2", screens: ["s5"], open: false, title: "First use: add a plant", sub: "A dialog over Home.", subOn: true });
  eq(lane(layout, "g4"), { id: "g4", screens: ["s9"], open: true, title: "Untitled group", sub: "", subOn: false });
});

/* ---------- layouts and annotations saved before this change ---------- */
const OLD_LANES = [
  { id: "g1", screens: ["s1", "s2"], open: true },
  { id: "g4", screens: ["s9"], open: true },
];
const oldLayout = (lanes = OLD_LANES) => JSON.stringify({ lanes, pos: { mobile: {} }, conns: [], notes: [], cc: 0, gc: 4 });

test("a layout saved before this change loads, and each group takes its name from the old annotations", () => {
  const storage = memory({ [KEY]: oldLayout() });
  const legacy = {
    g1: { title: "Renamed onboarding", sub: "My words", on: false },
    g4: { title: "Billing", sub: "", on: true },
    g7: { title: "Orphan", sub: "", on: true } /* no such group: dropped */,
  };
  const layout = make(storage, { legacyGroupText: () => legacy });
  eq(layout.lanes, [
    { id: "g1", screens: ["s1", "s2"], open: true, title: "Renamed onboarding", sub: "My words", subOn: false },
    { id: "g4", screens: ["s9"], open: true, title: "Billing", sub: "", subOn: true },
  ]);
  assert.ok(!layout.snapshot().includes("Orphan"));
});

test("the migration is saved at once, so the old annotations are not needed again", () => {
  const storage = memory({ [KEY]: oldLayout() });
  make(storage, { legacyGroupText: () => ({ g4: { title: "Billing", sub: "", on: true } }) });
  const again = make(storage, { legacyGroupText: () => ({ g4: { title: "STALE", sub: "", on: true } }) });
  assert.equal(lane(again, "g4").title, "Billing");
});

test("an old group with no old annotation falls back to the scanned text for a default id, blank otherwise", () => {
  const layout = make(memory({ [KEY]: oldLayout() }), { legacyGroupText: () => ({}) });
  assert.equal(lane(layout, "g1").title, "Onboarding: how fast to a first plant?");
  assert.equal(lane(layout, "g4").title, "Untitled group");
  assert.equal(lane(layout, "g4").subOn, false);
});

test("an old annotation that lacks a field keeps the scanned text for that field", () => {
  const layout = make(memory({ [KEY]: oldLayout() }), { legacyGroupText: () => ({ g1: { sub: "only my sub" }, g4: { on: true } }) });
  eq(lane(layout, "g1"), { id: "g1", screens: ["s1", "s2"], open: true, title: "Onboarding: how fast to a first plant?", sub: "only my sub", subOn: true });
  eq(lane(layout, "g4"), { id: "g4", screens: ["s9"], open: true, title: "Untitled group", sub: "", subOn: true });
});

test("no layout saved yet, but old annotations exist: the default groups take the user's text", () => {
  const storage = memory();
  const layout = make(storage, {
    legacyGroupText: () => ({ g2: { title: "Mine", sub: "words", on: false }, g5: { title: "Orphan", sub: "", on: true } }),
  });
  eq(lane(layout, "g2"), { id: "g2", screens: ["s5", "s6", "s7"], open: false, title: "Mine", sub: "words", subOn: false });
  assert.ok(!layout.snapshot().includes("Orphan"));
  assert.ok(storage.data[KEY], "saved at once");
  assert.equal(lane(make(storage), "g2").title, "Mine");
});

test("nothing to migrate and no layout saved yet: nothing is written", () => {
  const storage = memory();
  make(storage, { legacyGroupText: () => ({}) });
  assert.equal(storage.data[KEY], undefined);
});

test("a throwing or missing legacy reader changes nothing", () => {
  const throwing = make(memory({ [KEY]: oldLayout() }), {
    legacyGroupText: () => {
      throw new Error("blocked");
    },
  });
  assert.equal(lane(throwing, "g4").title, "Untitled group");
  assert.equal(lane(make(memory({ [KEY]: oldLayout() })), "g1").title, "Onboarding: how fast to a first plant?");
});

test("garbage in a saved group's text is ignored rather than kept", () => {
  const raw = JSON.stringify({
    lanes: [{ id: "g1", screens: ["s1"], open: true, title: 7, sub: null, subOn: "yes" }],
    conns: [],
    notes: [],
    gc: 3,
  });
  const layout = make(memory({ [KEY]: raw }), { legacyGroupText: () => ({}) });
  eq(lane(layout, "g1"), { id: "g1", screens: ["s1"], open: true, title: "Onboarding: how fast to a first plant?", sub: "Four screens.", subOn: true });
});
