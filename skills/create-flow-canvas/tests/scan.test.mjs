/* Scan module tests. FlowScan is the seam between what a scanner found and the engine: read() takes the scan
   block and gives back a clean scan plus the problems it found; merge() and diff() lay the user's edits over
   what the scan says, and take them back off for saving.
   Run:  node --test skills/create-flow-canvas/tests/scan.test.mjs   (from the repo root) */
import { test } from "node:test";
import vm from "node:vm";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowScan, sampleScan, readScan, block } from "./modules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tinyRaw = fs.readFileSync(path.join(here, "fixtures/tiny-scan.json"), "utf8");
const eq = (actual, expected, message) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected, message);

/* ---------- read ---------- */

test("the scan module needs no other module: it loads and reads in a bare context", () => {
  const bare = {};
  vm.runInNewContext(block("scan-module"), bare);
  const { scan } = bare.FlowScan.read(tinyRaw, { devices: ["mobile", "watch"] });
  eq(Object.keys(scan.screens[0].html), ["mobile", "watch"], "the devices the caller names, not a list the module knows");
});

test("read asks which devices it is for, rather than guessing", () => {
  assert.throws(() => FlowScan.read(tinyRaw), /devices/);
  assert.throws(() => FlowScan.read(tinyRaw, { devices: [] }), /devices/);
});

test("a clean scan reads with no problems, and ids the scanner left out are made from the facts", () => {
  const { scan, problems } = readScan(tinyRaw);
  eq(problems, []);
  assert.equal(scan.product.name, "Tally");
  assert.equal(scan.start, "home");
  eq(scan.screens.map((s) => s.id), ["home", "detail"]);
  eq(scan.links, [{ id: "home>detail", from: "home", to: "detail", label: "Open" }]);
  eq(scan.findings.map((f) => f.id), ["home:unreachable-states", "detail:reused-component"]);
  eq(scan.notes.map((n) => n.id), ["home:Ana"]);
  eq(scan.components, { Button: "button", Total: ".total" });
});

test("a screen gets every field the engine reads, even when the scanner left some out", () => {
  const { scan } = readScan(tinyRaw);
  const detail = scan.screens[1];
  eq(detail.caption, { title: "", body: "", on: false });
  assert.equal(detail.note, "");
  const minimal = readScan({ screens: [{ id: "x" }] }).scan.screens[0];
  eq(minimal, {
    id: "x",
    name: "x",
    route: "",
    file: "",
    components: [],
    states: [],
    note: "",
    caption: { title: "", body: "", on: false },
    html: { mobile: "", tablet: "", desktop: "" },
  });
});

test("the scanner's own words are kept: a state says whether the UI reaches it, and may bring its own render", () => {
  const home = readScan(tinyRaw).scan.screens[0];
  eq(home.states, [
    { name: "empty", reachable: true },
    { name: "offline", reachable: false, html: { mobile: "<p>offline</p>", tablet: "<p>offline</p>", desktop: "<p>offline</p>" } },
  ]);
});

test("whatever points at a screen the scan does not have is dropped, and each drop is reported", () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens.push({ name: "no id" }, { id: "home", name: "twice" });
  raw.groups.push({ id: "g2", screens: ["ghost", "home"] }); // home is already in g1, ghost does not exist
  raw.links.push({ from: "home", to: "ghost" }, { from: "home", to: "home" });
  raw.findings.push({ kind: "reused-component", frame: "ghost", component: "Button" });
  raw.notes.push({ frame: "ghost", who: "Bo", text: "lost" }, { frame: "home", who: "Cy" });
  raw.start = "ghost";
  const { scan, problems } = readScan(raw);
  eq(scan.screens.map((s) => s.id), ["home", "detail"]);
  eq(scan.groups.map((g) => g.id), ["g1"]);
  eq(scan.links.map((l) => l.id), ["home>detail"]);
  assert.equal(scan.findings.length, 2);
  eq(scan.notes.map((n) => n.id), ["home:Ana"]);
  assert.equal(scan.start, null);
  /* every one of the nine things dropped says what it was: none is dropped silently */
  for (const word of ["no id", "twice", "ghost", "itself", "start"]) assert.ok(problems.some((p) => p.includes(word)), `no problem mentions "${word}": ${problems.join(" | ")}`);
  assert.ok(problems.length >= 9, problems.join("\n"));
});

test("two scanned items with one id are not both kept: the second is dropped and reported", () => {
  const raw = JSON.parse(tinyRaw);
  raw.groups.push({ id: "g1", screens: ["detail"] });
  raw.links.push({ id: "home>detail", from: "detail", to: "home" });
  raw.findings.push({ id: "home:unreachable-states", kind: "unreachable-states", frame: "home" });
  raw.notes.push({ id: "home:Ana", frame: "detail", who: "Ana", text: "again" });
  const { scan, problems } = readScan(raw);
  eq(scan.links.map((l) => l.from), ["home"]);
  assert.equal(scan.findings.length, 2);
  assert.equal(scan.notes.length, 1);
  assert.equal(problems.filter((p) => /same id/.test(p)).length, 4, problems.join("\n"));
});

test("a scan that is not JSON, or not a scan, reads as nothing, with the reason", () => {
  for (const raw of ["{nope", "42", "null", "[]"]) {
    const { scan, problems } = readScan(raw);
    assert.equal(scan, null, raw);
    assert.equal(problems.length, 1, raw);
  }
});

test("the sample in the canvas is a clean scan", () => {
  const { scan, problems } = readScan(sampleScan);
  eq(problems, []);
  assert.equal(scan.product.name, "Loam");
  assert.equal(scan.screens.length, 9);
  assert.equal(scan.start, "s2");
});

/* ---------- edits laid over the scan ---------- */

const SCANNED = [
  { id: "a", frame: "s1", text: "scanned a", pos: { mobile: [1, 2], tablet: [3, 4] } },
  { id: "b", frame: "s2", text: "scanned b" },
];

test("no edits: the scan as it is, in fresh copies", () => {
  const merged = FlowScan.merge(SCANNED, null);
  eq(merged, SCANNED);
  merged[0].pos.mobile[0] = 99;
  assert.equal(SCANNED[0].pos.mobile[0], 1);
});

test("an unchanged scan diffs to no edits", () => {
  eq(FlowScan.diff(SCANNED, FlowScan.merge(SCANNED, null)), { edits: {}, mine: [] });
});

test("the diff keeps only what the user changed, down to one device's position", () => {
  const now = FlowScan.merge(SCANNED, null);
  now[0].text = "mine";
  now[0].pos.mobile = [10, 20];
  now.splice(1, 1); // b dismissed
  now.push({ id: "n1", frame: null, text: "my own", x: 5, y: 6 });
  eq(FlowScan.diff(SCANNED, now), {
    edits: { a: { text: "mine", pos: { mobile: [10, 20] } }, b: { gone: true } },
    mine: [{ id: "n1", frame: null, text: "my own", x: 5, y: 6 }],
  });
});

test("a field the user took away comes back as null", () => {
  const now = FlowScan.merge(SCANNED, null);
  delete now[0].pos;
  now[0].frame = null;
  now[0].x = 7;
  const saved = FlowScan.diff(SCANNED, now);
  eq(saved.edits.a, { pos: null, frame: null, x: 7 });
  const back = FlowScan.merge(SCANNED, saved)[0];
  assert.equal(back.pos, null);
  assert.equal(back.frame, null);
  assert.equal(back.x, 7);
});

test("merge then diff gives back the same edits", () => {
  const saved = { edits: { a: { text: "mine", pos: { mobile: [10, 20] } }, b: { gone: true } }, mine: [{ id: "n1", text: "x" }] };
  eq(FlowScan.diff(SCANNED, FlowScan.merge(SCANNED, saved)), saved);
});

test("a new scan reaches someone with edits: their edits win where they touched it, the scan wins everywhere else", () => {
  const saved = { edits: { a: { text: "mine", pos: { mobile: [10, 20] } }, b: { pos: { mobile: [7, 7] } }, gone: { gone: true } }, mine: [{ id: "n1", text: "x" }] };
  const rescanned = [
    { id: "a", frame: "s1", text: "rescanned a", pos: { mobile: [1, 2], tablet: [30, 40], desktop: [5, 5] } },
    { id: "b", frame: "s2", text: "rescanned b" },
    { id: "c", frame: "s3", text: "new in this scan" },
  ];
  const merged = FlowScan.merge(rescanned, saved);
  eq(merged, [
    { id: "a", frame: "s1", text: "mine", pos: { mobile: [10, 20], tablet: [30, 40], desktop: [5, 5] } },
    { id: "b", frame: "s2", text: "rescanned b", pos: { mobile: [7, 7] } },
    { id: "c", frame: "s3", text: "new in this scan" },
    { id: "n1", text: "x" },
  ]);
  /* an edit to something the scan no longer has is forgotten at the next save */
  eq(Object.keys(FlowScan.diff(rescanned, merged).edits), ["a", "b"]);
});

test("an item of the user's own that now shares an id with the scan is kept, after the scan's", () => {
  const merged = FlowScan.merge(SCANNED, { edits: {}, mine: [{ id: "a", text: "mine too" }] });
  eq(merged.map((x) => [x.id, x.text]), [["a", "scanned a"], ["b", "scanned b"], ["a", "mine too"]]);
});

test("edits that are not edits are ignored", () => {
  eq(FlowScan.merge(SCANNED, { edits: "nope", mine: "nope" }), SCANNED);
  eq(FlowScan.merge(SCANNED, { edits: { a: 5, b: null }, mine: [null, 3, { text: "no id" }] }), SCANNED);
});
