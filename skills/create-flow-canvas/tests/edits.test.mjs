/* Edits laid over the scan, through the layout. The scan's connectors, findings and notes stay the scanner's;
   the saved layout keeps only what the user changed on them and the ones the user made. So a new scan reaches
   someone who already has a saved layout, and their edits win where they touched it.
   Run:  node --test skills/create-flow-canvas/tests/edits.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowLayout, FlowScan, readScan } from "./modules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const KEY = "flow-canvas.layout.v1";
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);
const memory = (seed = {}) => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
};
/* a layout over a scan, the way the page makes one */
const over = (scan, storage) =>
  FlowLayout.create({
    key: KEY,
    storage,
    hasScreen: (id) => scan.screens.some((s) => s.id === id),
    defaults: () => ({ lanes: scan.groups, pos: { mobile: {}, tablet: {}, desktop: {} }, conns: scan.links, scans: scan.findings, notes: scan.notes }),
  });

const SCREENS = ["s1", "s2", "s3", "s4"].map((id) => ({ id }));
const FIRST = {
  screens: SCREENS,
  groups: [{ id: "g1", screens: ["s1", "s2"], open: true }],
  links: [
    { id: "c1", from: "s1", to: "s2", label: "Continue" },
    { id: "c2", from: "s2", to: "s3", label: "Next" },
  ],
  findings: [
    { id: "s3:states", kind: "unreachable-states", frame: "s3", source: "Denied.tsx" },
    { id: "s2:reuse", kind: "reused-component", frame: "s2", component: "Dialog" },
  ],
  notes: [
    { id: "s1:Dana", frame: "s1", who: "Dana", text: "first words", pos: { mobile: [1, 1], tablet: [2, 2] } },
    { id: "s2:Sam", frame: "s2", who: "Sam", text: "Sam said", pos: { mobile: [3, 3] } },
    { id: "s3:Ana", frame: "s3", who: "Ana", text: "soon gone" },
  ],
};

test("what is saved is the edits, not copies of the scan", () => {
  const storage = memory();
  const layout = over(FIRST, storage);
  layout.notes[0].text = "my words";
  layout.notes.push({ id: "n1", frame: null, who: "You", text: "mine", x: 1, y: 2 });
  layout.conns[0].label = "Go";
  layout.conns.push({ id: layout.nextId("c"), from: "s1", to: "s4", label: "Jump" });
  layout.scans = layout.scans.filter((f) => f.id !== "s2:reuse");
  layout.scans[0].pos = { mobile: [0, 600] };
  layout.save();
  const onDisk = JSON.parse(storage.data[KEY]);
  assert.equal(onDisk.v, 3);
  eq(onDisk.notes, { edits: { "s1:Dana": { text: "my words" } }, mine: [{ id: "n1", frame: null, who: "You", text: "mine", x: 1, y: 2 }] });
  eq(onDisk.conns, { edits: { c1: { label: "Go" } }, mine: [{ id: "c3", from: "s1", to: "s4", label: "Jump" }] });
  eq(onDisk.scans, { edits: { "s3:states": { pos: { mobile: [0, 600] } }, "s2:reuse": { gone: true } }, mine: [] });
  /* and it reads back as the user left it */
  assert.equal(over(FIRST, storage).snapshot(), layout.snapshot());
});

test("a new scan reaches someone with saved edits: theirs win where they touched it, the scan wins everywhere else", () => {
  const storage = memory();
  const before = over(FIRST, storage);
  before.notes[0].text = "my words"; // edited text
  before.notes[1].pos.mobile = [30, 30]; // moved, text untouched
  before.notes.push({ id: "n1", frame: "s4", who: "You", text: "mine" });
  before.conns = before.conns.filter((c) => c.id !== "c2"); // deleted a connector
  before.scans = before.scans.filter((f) => f.id !== "s2:reuse"); // dismissed a finding
  before.save();

  const NEXT = {
    ...FIRST,
    links: [...FIRST.links.map((l) => ({ ...l, label: l.label + "!" })), { id: "c9", from: "s3", to: "s4", label: "Done" }],
    findings: [
      { id: "s3:states", kind: "unreachable-states", frame: "s3", source: "Denied.tsx" },
      { id: "s2:reuse", kind: "reused-component", frame: "s2", component: "Dialog" },
      { id: "s4:reuse", kind: "reused-component", frame: "s4", component: "Card" },
    ],
    notes: [
      { id: "s1:Dana", frame: "s1", who: "Dana", text: "rescanned words", pos: { mobile: [1, 1], tablet: [2, 2] } },
      { id: "s2:Sam", frame: "s2", who: "Sam", text: "Sam said it again", pos: { mobile: [3, 3], desktop: [4, 4] } },
      { id: "s4:Bo", frame: "s4", who: "Bo", text: "new in this scan" },
    ],
  };
  const after = over(NEXT, storage);
  eq(after.notes.map((n) => [n.id, n.text]), [
    ["s1:Dana", "my words"],
    ["s2:Sam", "Sam said it again"],
    ["s4:Bo", "new in this scan"],
    ["n1", "mine"],
  ]);
  eq(after.notes[1].pos, { mobile: [30, 30], desktop: [4, 4] }, "my move kept, the new scan's other devices taken");
  eq(after.conns.map((c) => [c.id, c.label]), [["c1", "Continue!"], ["c9", "Done"]], "the deleted one stays deleted");
  eq(after.scans.map((f) => f.id), ["s3:states", "s4:reuse"]);
});

test("a connector of the user's own that a new scan's link would share an id with gets a new id", () => {
  const storage = memory();
  const before = over(FIRST, storage);
  before.conns.push({ id: before.nextId("c"), from: "s1", to: "s4", label: "Mine" }); // c3
  before.save();
  const after = over({ ...FIRST, links: [...FIRST.links, { id: "c3", from: "s2", to: "s4", label: "Scanned" }] }, storage);
  eq(after.conns.map((c) => [c.id, c.label]), [["c1", "Continue"], ["c2", "Next"], ["c3", "Scanned"], ["c4", "Mine"]]);
  assert.equal(after.nextId("c"), "c5");
});

const onDisk = (layout, storage) => (layout.save(), JSON.parse(storage.data[KEY]));

test("a note the user put back where the scan had it leaves no edit behind (what tidy relies on)", () => {
  const storage = memory();
  const layout = over(FIRST, storage);
  layout.notes[0].pos.mobile = [50, 50];
  eq(onDisk(layout, storage).notes.edits, { "s1:Dana": { pos: { mobile: [50, 50] } } });
  layout.notes[0].pos.mobile = [1, 1];
  eq(onDisk(layout, storage).notes.edits, {});
});

test("reset drops every edit and everything the user made", () => {
  const storage = memory();
  const layout = over(FIRST, storage);
  layout.notes[0].text = "mine";
  layout.notes.push({ id: "n1", text: "x" });
  layout.scans = [];
  layout.reset();
  const saved = JSON.parse(storage.data[KEY]);
  eq(saved.notes, { edits: {}, mine: [] });
  eq(saved.scans, { edits: {}, mine: [] });
  assert.equal(layout.notes[0].text, "first words");
  assert.equal(layout.scans.length, 2);
});

test("undo across an edit to a scanned note puts the scanned text back", () => {
  const layout = over(FIRST, memory());
  layout.mark();
  layout.notes[0].text = "mine";
  assert.equal(layout.undo(), true);
  assert.equal(layout.notes[0].text, "first words");
});

/* ---------- the layout the real canvas saved before edits were split from the scan ---------- */

const LOAM = {
  screens: ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"].map((id) => ({ id })),
  groups: [
    { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true },
    { id: "g2", screens: ["s5", "s6", "s7"], open: false },
    { id: "g3", screens: ["s8", "s9"], open: false },
  ],
  links: [
    { id: "c1", from: "s1", to: "s2", label: "Continue" },
    { id: "c2", from: "s2", to: "s3", label: "Continue" },
    { id: "c3", from: "s3", to: "s4", label: "Allow" },
    { id: "c4", from: "s5", to: "s6", label: "Pick plant" },
    { id: "c5", from: "s6", to: "s7", label: "Add to jungle" },
    { id: "c6", from: "s8", to: "s9", label: "Start trial" },
  ],
  findings: [
    { id: "s3:states", kind: "unreachable-states", frame: "s3", source: "NotificationsDenied.tsx" },
    { id: "s5:reuse", kind: "reused-component", frame: "s5", component: "AddPlantDialog" },
  ],
  notes: [
    { id: "s1:Dana", frame: "s1", who: "Dana", t: "2h", text: "Hero image is 2.1 MB. Lazy-load it?", pos: { mobile: [164, 330], tablet: [210, 120], desktop: [370, 250] } },
    { id: "s3:Sam", frame: "s3", who: "Sam", t: "1d", text: "38% of people skip this step. Move it after their first plant?", pos: { mobile: [168, 410], tablet: [224, 300], desktop: [408, 276] } },
    { id: "s6:Priya", frame: "s6", who: "Priya", t: "3h", text: "Show the first reminder time here too.", pos: { mobile: [200, 150], tablet: [186, 110], desktop: [22, 262] } },
  ],
};

test("a layout saved by the real canvas before edits were split from the scan loads as it was, and is saved as edits", () => {
  const raw = fs.readFileSync(path.join(here, "fixtures/saved-layout-v1.json"), "utf8").trim();
  const saved = JSON.parse(raw);
  const storage = memory({ [KEY]: raw });
  const layout = over(LOAM, storage);
  /* the canvas shows what it showed before */
  eq(layout.conns, saved.conns);
  eq(layout.notes, saved.notes);
  eq(layout.scans.map((f) => f.id), ["s5:reuse"], "the finding dismissed back then stays dismissed");
  eq(layout.pos, saved.pos);
  /* and from now on only the edits are on disk */
  const onDisk = JSON.parse(storage.data[KEY]);
  assert.equal(onDisk.v, 3);
  eq(onDisk.conns, { edits: { c2: { gone: true } }, mine: [{ id: "c7", from: "s1", to: "s9", label: "Jump" }] });
  eq(onDisk.scans, { edits: { "s3:states": { gone: true } }, mine: [] });
  eq(onDisk.notes, { edits: {}, mine: saved.notes.slice(3) });
  assert.equal(layout.nextId("c"), "c8");
  assert.equal(layout.nextId("g"), "g5");
  assert.equal(over(LOAM, storage).snapshot(), layout.snapshot());
});

test("an old layout gets the links a newer scan added, and keeps the ones the user deleted deleted", () => {
  /* before v2 every connector, scanned or drawn, had a numbered id no higher than the saved counter; a scanned
     link with any other id, or a higher number, cannot have been in that layout, so it is new, not deleted */
  const raw = fs.readFileSync(path.join(here, "fixtures/saved-layout-v1.json"), "utf8").trim(); // c2 deleted, cc 7
  const rescanned = { ...LOAM, links: [...LOAM.links, { id: "s4>s5", from: "s4", to: "s5", label: "Add a plant" }, { id: "c12", from: "s7", to: "s8", label: "Upgrade" }] };
  const storage = memory({ [KEY]: raw });
  const layout = over(rescanned, storage);
  eq(layout.conns.map((c) => c.id), ["c1", "c3", "c4", "c5", "c6", "s4>s5", "c12", "c7"]);
  eq(JSON.parse(storage.data[KEY]).conns.edits, { c2: { gone: true } });
  assert.equal(over(rescanned, storage).snapshot(), layout.snapshot());
});

test("a connector the user drew by hand where a newer scan now has a link is that link, wearing the user's label", () => {
  const raw = JSON.stringify({ lanes: [{ id: "g1", screens: ["s1", "s4"], open: true }], conns: [{ id: "c7", from: "s4", to: "s5", label: "My name for it" }], cc: 7 });
  const rescanned = { ...LOAM, links: [...LOAM.links, { id: "s4>s5", from: "s4", to: "s5", label: "Add a plant" }] };
  const storage = memory({ [KEY]: raw });
  const layout = over(rescanned, storage);
  eq(layout.conns.filter((c) => c.from === "s4" && c.to === "s5").map((c) => [c.id, c.label]), [["s4>s5", "My name for it"]]);
  eq(JSON.parse(storage.data[KEY]).conns.mine, []);
});

test("an old layout that lost its counter does not bring back connectors the user deleted", () => {
  const raw = JSON.stringify({ lanes: [{ id: "g1", screens: ["s1", "s2"], open: true }], conns: [{ id: "c1", from: "s1", to: "s2", label: "Continue" }] });
  eq(over(LOAM, memory({ [KEY]: raw })).conns.map((c) => c.id), ["c1"]);
});

test("an old layout's findings, saved as positions and dismissals by id, keep their positions", () => {
  const old = { lanes: [{ id: "g1", screens: ["s1"], open: true }], scans: { "s5:reuse": { pos: { mobile: [0, 700] } } } };
  const layout = over(LOAM, memory({ [KEY]: JSON.stringify(old) }));
  eq(layout.scans.map((f) => [f.id, f.pos || null]), [["s3:states", null], ["s5:reuse", { mobile: [0, 700] }]]);
});

/* ---------- another product: the engine has no Loam in it ---------- */

test("a scan of another product reads, lays out, saves and reloads", () => {
  const { scan, problems } = readScan(fs.readFileSync(path.join(here, "fixtures/tiny-scan.json"), "utf8"));
  eq(problems, []);
  const storage = memory();
  const layout = over(scan, storage);
  eq(layout.lanes.map((l) => [l.id, l.screens, l.title]), [["g1", ["home", "detail"], "Tally: count fast"]]);
  eq(layout.conns.map((c) => c.id), ["home>detail"]);
  eq(layout.notes.map((n) => n.id), ["home:Ana"]);
  assert.equal(layout.nextId("c"), "c1", "scanned links named by their screens leave the user's numbering alone");
  layout.notes[0].text = "edited";
  layout.save();
  assert.equal(over(scan, storage).notes[0].text, "edited");
});
