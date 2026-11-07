/* Group identity tests. A group's title, description and "description shown" flag live on the group
   inside the layout, so they are saved with it, undone with it, reset with it and gone when the group
   is. These run the layout (and commit) modules on their own, with an in-memory storage.
   Run:  node --test skills/create-flow-canvas/tests/group-identity.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const KEY = "flow-canvas.layout.v1";
const SCREENS = new Set(["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"]);
const DEFAULTS = {
  groups: [
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
  FlowLayout.create({ key: KEY, storage, hasScreen: (id) => SCREENS.has(id), defaults: () => DEFAULTS, kinds: builtinKinds(() => DEFAULTS), ...over });
/* the module runs in its own vm context, so compare through JSON rather than by prototype */
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const groupById = (layout, id) => layout.groups.find((l) => l.id === id);

/* a group made the way the page does it: the frames leave their groups, and a blank new one is added */
function addGroup(layout, screens) {
  return layout.groupFrames(screens, { device: "mobile" });
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
  assert.equal(FlowLayout.groupName(groupById(layout, "g1")), "Onboarding");
  assert.equal(FlowLayout.groupName({ id: "g9" }), "Untitled group");
  assert.equal(FlowLayout.groupName({ id: "g9", title: "   " }), "Untitled group");
  assert.equal(FlowLayout.groupName({ id: "g9", title: ": only a sentence" }), "Untitled group");
  assert.equal(layout.snapshot(), before);
});

test("title, description and its visibility are saved with the layout and come back on load", () => {
  const storage = memory();
  const a = make(storage);
  groupById(a, "g3").screens = ["s8"];
  const g = addGroup(a, ["s9"]);
  Object.assign(g, { title: "Billing", sub: "Pay once", subOn: true });
  groupById(a, "g1").title = "Welcome";
  a.save();
  const b = make(storage);
  assert.equal(b.snapshot(), a.snapshot());
  eq(groupById(b, "g4"), { id: "g4", screens: ["s9"], open: true, title: "Billing", sub: "Pay once", subOn: true });
  assert.equal(groupById(b, "g1").title, "Welcome");
});

test("the snapshot carries the text: rename, then undo through the commit seam puts the old name back", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, kinds: builtinKinds(), redraw: { world() {}, layout() {} } });
  const g = commit(() => addGroup(layout, ["s9"]));
  commit(() => {
    groupById(layout, g.id).title = "Billing";
  });
  commit(() => {
    groupById(layout, g.id).title = "Payments";
  });
  assert.equal(groupById(layout, "g4").title, "Payments");
  assert.equal(layout.undo(), true);
  assert.equal(groupById(layout, "g4").title, "Billing");
  assert.equal(layout.undo(), true);
  assert.equal(groupById(layout, "g4").title, "Untitled group");
  assert.equal(layout.undo(), true);
  assert.equal(groupById(layout, "g4"), undefined);
});

test("undoing a group's creation leaves no name behind, and a later group with that id starts blank", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, kinds: builtinKinds(), redraw: { world() {}, layout() {} } });
  commit(() => addGroup(layout, ["s9"]));
  commit(() => {
    groupById(layout, "g4").title = "Billing";
  });
  layout.undo();
  layout.undo();
  assert.equal(groupById(layout, "g4"), undefined);
  assert.ok(!layout.snapshot().includes("Billing"));
});

test("a group that leaves the layout (as a dissolved one does) takes its name with it, and undo brings both back", () => {
  const layout = make();
  const commit = FlowCommit.create({ layout, kinds: builtinKinds(), redraw: { world() {}, layout() {} } });
  commit(() => {
    groupById(layout, "g3").title = "Upgrade: pay";
  });
  commit(() => {
    layout.groups = layout.groups.filter((l) => l.id !== "g3"); /* what dissolveGroup ends in: no frames, pruned */
  });
  assert.ok(!layout.snapshot().includes("Upgrade: pay"));
  assert.equal(layout.undo(), true);
  assert.equal(groupById(layout, "g3").title, "Upgrade: pay");
});

test("Reset layout puts every default group's text back and drops the added groups with theirs", () => {
  const layout = make();
  groupById(layout, "g1").title = "My own name";
  groupById(layout, "g1").sub = "";
  groupById(layout, "g1").subOn = false;
  addGroup(layout, ["s9"]).title = "Billing";
  layout.reset();
  eq(groupById(layout, "g1"), { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true, title: "Onboarding: how fast to a first plant?", sub: "Four screens.", subOn: true });
  assert.ok(!layout.snapshot().includes("Billing"));
});

test("undoing a Reset layout brings back the group as it was named", () => {
  const layout = make();
  addGroup(layout, ["s9"]).title = "Billing";
  layout.mark();
  layout.reset();
  assert.equal(layout.undo(), true);
  assert.equal(groupById(layout, "g4").title, "Billing");
});

test("resetText puts the scanned text on default groups and blanks the rest, without touching membership", () => {
  const layout = make();
  groupById(layout, "g2").title = "Mine";
  groupById(layout, "g2").subOn = false;
  groupById(layout, "g2").screens = ["s5"];
  const added = addGroup(layout, ["s9"]);
  Object.assign(added, { title: "Billing", sub: "x", subOn: true });
  layout.resetText();
  eq(groupById(layout, "g2"), { id: "g2", screens: ["s5"], open: false, title: "First use: add a plant", sub: "A dialog over Home.", subOn: true });
  eq(groupById(layout, "g4"), { id: "g4", screens: ["s9"], open: true, title: "Untitled group", sub: "", subOn: false });
});
