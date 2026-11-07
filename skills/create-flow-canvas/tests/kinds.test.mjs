/* The annotation-kind seam. A kind is one object: a data half (its layout field, the items the scan gives, how
   they are cleaned on load) and a view half (refresh, owns, match, drag, delete). The page declares one list and
   hands the same list to FlowLayout, FlowCommit and FlowAnnotations. This file proves the claim "a new kind is one
   adapter": a throwaway fifth kind, "flags", is declared below as one object and nothing else in the engine is
   touched. It also guards that the engine modules name no kind of their own.
   Run:  node --test skills/create-flow-canvas/tests/kinds.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit, FlowAnnotations, FlowScan, block, html } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const eq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
const KEY = "k";
const memory = () => {
  const data = {};
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
};

/* the throwaway kind: little flags the user drops on the canvas. The scan gives none. */
function flagKind(layoutRef, log) {
  const at = (id) => layoutRef().flags.find((f) => f.id === id);
  return {
    name: "flags",
    scanned: () => [],
    refresh: () => log.push("refresh:flags"),
    movable: true,
    owns: (t) => !!t.flag,
    match: (t) => t.flag || null,
    origin: (id) => ({ x: at(id).x, y: at(id).y }),
    place: (id, p) => log.push(`place:${id}:${p.x},${p.y}`),
    save: (id, p) => layoutRef().edit("flags", id, { x: p.x, y: p.y }),
    erase: (id) => layoutRef().remove("flags", id),
  };
}

function setup({ storage = memory(), typing } = {}) {
  const log = [];
  let layout;
  const kinds = [...builtinKinds({}), flagKind(() => layout, log)];
  layout = FlowLayout.create({
    key: KEY,
    storage,
    hasScreen: () => true,
    defaults: () => ({ groups: [{ id: "g1", screens: ["s1"], open: true }], pos: { mobile: {} } }),
    kinds,
  });
  const redraw = { world: () => log.push("redraw:world"), layout: () => log.push("redraw:layout") };
  const wired = kinds.map((k) => (k.name === "flags" ? k : { ...k, refresh: () => log.push("refresh:" + k.name) }));
  const commit = FlowCommit.create({ layout, kinds: wired, redraw });
  const annotations = FlowAnnotations.create({ commit, kinds: wired, typing });
  return { layout, commit, annotations, log, storage };
}

test("a fifth kind is saved with the layout and comes back after a reload", () => {
  const { layout, commit, storage } = setup();
  eq(layout.flags, []);
  commit(() => layout.add("flags", { id: "f1", x: 5, y: 6 }));
  const again = setup({ storage }).layout;
  eq(again.flags, [{ id: "f1", x: 5, y: 6 }]);
});

test("a fifth kind is one undo step, and undo refreshes it", () => {
  const { layout, commit, log } = setup();
  commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }), { redraw: ["flags"] });
  log.length = 0;
  assert.equal(commit.undo(), true);
  eq(layout.flags, []);
  assert.ok(log.includes("refresh:flags"));
});

test("redraw runs the world, then the layout, then each kind in the order of the list", () => {
  const { commit, layout, log } = setup();
  commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }), { redraw: ["flags", "world", "notes", "layout"] });
  eq(log, ["redraw:world", "redraw:layout", "refresh:notes", "refresh:flags"]);
});

test("redraw 'all' is the layout and every kind, the world excluded", () => {
  const { commit, layout, log } = setup();
  commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }), { redraw: "all" });
  eq(log, ["redraw:layout", "refresh:caps", "refresh:scans", "refresh:notes", "refresh:conns", "refresh:flags"]);
});

test("asking for a kind nobody declared fails before anything changes", () => {
  const { commit, layout } = setup();
  assert.throws(() => commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }), { redraw: ["flagz"] }), /unknown redraw kind "flagz"/);
  eq(layout.flags, []);
});

test("a fifth kind is dragged, nudged and deleted through the shared annotation paths", () => {
  const { layout, commit, annotations, log } = setup();
  commit(() => layout.add("flags", { id: "f1", x: 10, y: 10 }));
  assert.equal(annotations.owns({ flag: "f1" }), true);
  assert.equal(annotations.owns({ other: 1 }), false);
  annotations.down({ flag: "f1" }, { x: 0, y: 0 });
  annotations.move({ x: 20, y: 0 }, 1);
  annotations.up();
  eq(layout.flags, [{ id: "f1", x: 30, y: 10 }]);
  assert.equal(annotations.keyDown({ flag: "f1" }, "ArrowDown", {}), true);
  eq(layout.flags, [{ id: "f1", x: 30, y: 18 }]);
  assert.equal(annotations.keyDown({ flag: "f1" }, "Delete", {}), true);
  eq(layout.flags, []);
  assert.ok(log.includes("place:f1:30,10"));
  commit.undo();
  eq(layout.flags, [{ id: "f1", x: 30, y: 18 }]);
});

test("remove(name, id) is the same removal as the Delete key", () => {
  const { layout, commit, annotations } = setup();
  commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }));
  annotations.remove("flags", "f1");
  eq(layout.flags, []);
  assert.throws(() => annotations.remove("flagz", "f1"), /unknown annotation kind "flagz"/);
});

test("while the page says the user is typing, no kind acts on Delete or an arrow", () => {
  const { layout, commit, annotations } = setup({ typing: (t) => !!t.typing });
  commit(() => layout.add("flags", { id: "f1", x: 0, y: 0 }));
  assert.equal(annotations.keyDown({ flag: "f1", typing: true }, "Delete", {}), false);
  assert.equal(annotations.keyDown({ flag: "f1", typing: true }, "ArrowLeft", {}), false);
  eq(layout.flags, [{ id: "f1", x: 0, y: 0 }]);
});

test("a kind that is missing what a module reads is refused when the module is made", () => {
  const storage = memory();
  const base = { key: KEY, storage, hasScreen: () => true, defaults: () => ({ groups: [], pos: {} }) };
  assert.throws(() => FlowLayout.create({ ...base }), /kinds is required/);
  assert.throws(() => FlowLayout.create({ ...base, kinds: [{ name: "x" }] }), /"x" has no scanned/);
  assert.throws(() => FlowLayout.create({ ...base, kinds: [{ name: "groups", scanned: () => [] }] }), /"groups" is taken/);
  const layout = FlowLayout.create({ ...base, kinds: [{ name: "x", scanned: () => [] }] });
  assert.throws(() => FlowCommit.create({ layout, kinds: [{ name: "x" }], redraw: { world() {}, layout() {} } }), /"x" has no refresh/);
  assert.throws(() => FlowCommit.create({ layout, kinds: [], redraw: { layout() {} } }), /missing redraw function for "world"/);
  assert.throws(() => FlowCommit.create({ layout, kinds: [{ refresh() {} }], redraw: { world() {}, layout() {} } }), /every kind needs a name/);
  assert.throws(() => FlowCommit.create({ layout, kinds: [{ name: "x", refresh() {} }, { name: "x", refresh() {} }], redraw: { world() {}, layout() {} } }), /"x" is taken/);
  assert.throws(() => FlowAnnotations.create({ commit: () => {}, kinds: [{ name: "x" }, { name: "x" }] }), /two kinds are named "x"/);
  const movable = { name: "m", movable: true, refresh() {} };
  assert.throws(() => FlowAnnotations.create({ commit: () => {}, kinds: [movable] }), /"m" is movable but has no origin/);
});

/* The engine modules know the seam, not the kinds. Their code (comments left out) never names a kind. */
const code = (id) =>
  block(id)
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .replace(/^\s*\/\/.*$/gm, "");
for (const id of ["layout-module", "commit-module", "annotations-module", "arrange-module"]) {
  test(`${id}: no kind of the page is named in its code`, () => {
    const names = [...code(id).matchAll(/\b(notes|scans|conns|caps)\b/g)].map((m) => m[1]);
    assert.deepEqual(names, [], `${id} names ${names.join(", ")}`);
  });
}

/* One style: a kind is found by id, and finds its own DOM from it. A handle hung on the element itself is the
   second style this seam replaced. */
test("the page hangs no private handle on a card, and has one list of kinds", () => {
  assert.ok(!/\._scan\b/.test(html), "a finding card must not carry a _scan expando");
  assert.equal([...html.matchAll(/FlowAnnotations\.create\(\{ commit, kinds: KINDS/g)].length, 1);
  assert.equal([...html.matchAll(/FlowLayout\.create\(\{[\s\S]*?kinds: KINDS/g)].length, 1);
  assert.equal([...html.matchAll(/FlowCommit\.create\(\{ layout, kinds: KINDS/g)].length, 1);
});

test("FlowScan.dataKinds: captions, findings, notes and connectors, in redraw order, with the rules the layout used to hold", () => {
  const scan = {
    screens: [{ id: "a", caption: { title: "T", body: "B", on: true } }, { id: "b", caption: { title: "", body: "", on: false } }],
    findings: [{ id: "f", kind: "x", frame: "a" }],
    notes: [{ id: "n", frame: "a", text: "hi" }],
    links: [{ id: "c3", from: "a", to: "b", label: "Go" }],
  };
  const kinds = FlowScan.dataKinds(() => scan);
  eq(kinds.map((k) => k.name), ["caps", "scans", "notes", "conns"]);
  const by = Object.fromEntries(kinds.map((k) => [k.name, k]));
  eq(by.caps.scanned(), [{ id: "a", title: "T", body: "B", on: true }, { id: "b", title: "", body: "", on: false }]);
  eq(by.scans.scanned(), scan.findings);
  eq(by.conns.counter, { prefix: "c", saved: "cc" });
  assert.equal(by.caps.resetBy, "annotations");
  const has = (id) => id === "a" || id === "b";
  const valid = (k, items, ctx) => items.filter((x) => k.valid(x, ctx));
  eq(valid(by.conns, [{ id: "1", from: "a", to: "a" }, { id: "2", from: "a", to: "z" }, { id: "3", from: "a", to: "b" }], { hasScreen: has }), [{ id: "3", from: "a", to: "b" }]);
  eq(valid(by.notes, [{ id: "n", text: "x" }, { id: "m" }, { text: "y" }], {}), [{ id: "n", text: "x" }]);
  /* what Tidy lets go of: a note back to the scan's place on one device, a finding to the scan's on every device */
  const note = { id: "n", frame: "a", text: "hi", pos: { mobile: [9, 9], tablet: [8, 8] } };
  by.notes.letGo(note, { id: "n", frame: "a", pos: { mobile: [1, 1] } }, "mobile");
  eq(note.pos, { mobile: [1, 1], tablet: [8, 8] });
  const finding = { id: "f", pos: { mobile: [9, 9] } };
  by.scans.letGo(finding, { id: "f" }, "mobile");
  assert.ok(!("pos" in finding));
  /* one caption per screen the scan has, whatever was saved */
  eq(by.caps.clean([{ id: "a", title: "mine" }, { id: "gone" }], { hasScreen: has, scanned: by.caps.scanned() }).map((c) => c.id), ["a", "b"]);
  scan.links = [];
  eq(by.conns.scanned(), [], "the scan is asked each time, so a new one is seen");
});

test("a kind that matches a delete but cannot erase is never offered one", () => {
  const { annotations } = setup();
  const quiet = FlowAnnotations.create({ commit: () => {}, kinds: [{ name: "q", match: () => "x" }] });
  assert.equal(quiet.keyDown({}, "Delete", {}), false);
  assert.equal(annotations.keyDown({ other: 1 }, "Delete", {}), false);
});
