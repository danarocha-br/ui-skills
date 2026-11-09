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
import { FlowScan, FlowDevice, sampleScan, readScan, block } from "./modules.mjs";

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

test("repeated inferred ids keep every annotation and leave explicit ids available", () => {
  const raw = JSON.parse(tinyRaw);
  raw.links.push({ from: "home", to: "detail", label: "Again" }, { id: "home>detail~2", from: "detail", to: "home" });
  raw.findings.push({ kind: "unreachable-states", frame: "home", source: "Other.tsx" });
  raw.notes.push({ frame: "home", who: "Ana", text: "A second note" });
  const { scan, problems } = readScan(raw);
  eq(problems, []);
  eq(scan.links.map((l) => l.id), ["home>detail", "home>detail~3", "home>detail~2"]);
  eq(scan.findings.map((f) => f.id), ["home:unreachable-states", "detail:reused-component", "home:unreachable-states~2"]);
  eq(scan.notes.map((n) => n.id), ["home:Ana", "home:Ana~2"]);
  const edited = FlowScan.merge(scan.notes, null);
  edited[1].text = "Edited separately";
  eq(FlowScan.merge(scan.notes, FlowScan.diff(scan.notes, edited)).map((n) => n.text),
    ["Is zero the right empty state?", "Edited separately"]);
});

test("discarded annotations cannot rename inferred ids or detach their saved edits", () => {
  const raw = JSON.parse(tinyRaw);
  const original = readScan(raw).scan;
  const collections = [
    ["links", { ...raw.links[0], id: "home>detail", to: "missing" }],
    ["findings", { ...raw.findings[0], id: "home:unreachable-states", frame: "missing" }],
    ["notes", { ...raw.notes[0], id: "home:Ana", frame: "missing" }],
  ];
  for (const [kind, invalid] of collections) {
    const edited = FlowScan.merge(original[kind], null);
    edited[0].review = "My saved edit";
    const saved = FlowScan.diff(original[kind], edited);
    const next = JSON.parse(tinyRaw);
    next[kind].push(invalid);
    const { scan, problems } = readScan(next);
    assert.ok(problems.length > 0);
    assert.equal(scan[kind][0].id, original[kind][0].id, `${kind} changed identity`);
    assert.equal(FlowScan.merge(scan[kind], saved)[0].review, "My saved edit");
  }
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
    approximate: false,
    unrendered: "",
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
  raw.screens.push({ name: "no id" });
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
  /* every drop says what it was */
  for (const word of ["no id", "ghost", "itself", "start"]) assert.ok(problems.some((p) => p.includes(word)), `no problem mentions "${word}": ${problems.join(" | ")}`);
  assert.ok(problems.length >= 8, problems.join("\n"));
});

test("duplicate explicit ids reject the scan instead of returning data that would lose an item", () => {
  for (const kind of ["screens", "groups", "links", "findings", "notes"]) {
    const raw = JSON.parse(tinyRaw);
    const first = raw[kind][0];
    first.id = first.id || "explicit";
    raw[kind].push({ ...first });
    const { scan, problems } = readScan(raw);
    assert.equal(scan, null, `${kind} returned a partial scan`);
    assert.ok(problems.some((p) => p.includes(kind) && p.includes("same id") && p.includes(first.id)), problems.join("\n"));
  }
});

test("duplicate explicit ids are rejected even when an item also has a missing screen reference", () => {
  for (const kind of ["links", "findings", "notes"]) {
    const raw = JSON.parse(tinyRaw);
    raw[kind][0].id = "duplicate";
    raw[kind].push({ ...raw[kind][0], ...(kind === "links" ? { to: "missing" } : { frame: "missing" }) });
    const { scan, problems } = readScan(raw);
    assert.ok(scan === null, `${kind} returned a partial scan`);
    assert.ok(problems.some((p) => p.includes("same id")), problems.join("\n"));
  }
});

test("ids unsafe for saved records and group ids shared with screens reject the scan", () => {
  for (const kind of ["screens", "groups", "links", "findings", "notes"]) {
    for (const id of ["", " ", "__proto__", "constructor", "toString", "line\nbreak", 42]) {
      const raw = JSON.parse(tinyRaw);
      raw[kind][0].id = id;
      const { scan, problems } = readScan(raw);
      assert.ok(scan === null, `${kind} accepted ${JSON.stringify(id)}`);
      assert.ok(problems.some((p) => p.includes("invalid id")), problems.join("\n"));
    }
  }
  const raw = JSON.parse(tinyRaw);
  raw.groups[0].id = "home";
  const { scan, problems } = readScan(raw);
  assert.equal(scan, null);
  assert.ok(problems.some((p) => p.includes("group") && p.includes("screen id")));
});

test("product identity scopes saved layouts and survives a product rename", () => {
  const raw = JSON.parse(tinyRaw);
  raw.product.id = "tally/web";
  const first = readScan(raw).scan;
  raw.product.name = "Renamed";
  raw.product.scanned = "now";
  raw.screens.reverse();
  const renamed = readScan(raw).scan;
  assert.equal(FlowScan.storageKey(first), "flow-canvas.layout.v1:tally%2Fweb");
  assert.equal(FlowScan.storageKey(renamed), FlowScan.storageKey(first));
  raw.product.id = "another-product";
  assert.notEqual(FlowScan.storageKey(readScan(raw).scan), FlowScan.storageKey(first));
  assert.notEqual(FlowScan.storageKey(readScan(tinyRaw).scan), "flow-canvas.layout.v1", "legacy scans also get a product scope");
});

test("malformed product ids return a problem before a storage key can throw", () => {
  for (const id of ["", " ", 42, "line\nbreak", "\ud800"]) {
    const raw = JSON.parse(tinyRaw);
    raw.product.id = id;
    const { scan, problems } = readScan(raw);
    assert.ok(scan === null, `product accepted ${JSON.stringify(id)}`);
    assert.ok(problems.some((p) => p.includes("product") && p.includes("invalid id")), problems.join("\n"));
  }
});

test("id diagnostics never coerce an object supplied in JSON", () => {
  for (const kind of ["screens", "groups", "links", "findings", "notes", "product"]) {
    const raw = JSON.parse(tinyRaw);
    const item = kind === "product" ? raw.product : raw[kind][0];
    item.id = { toString: null, valueOf: null };
    const { scan, problems } = readScan(JSON.stringify(raw));
    assert.ok(scan === null, `${kind} accepted an object as an id`);
    assert.ok(problems.some((p) => p.includes("invalid id")), problems.join("\n"));
  }
});

test("component selectors are validated by the host parser; a bad one is reported and cannot reach Inspect", () => {
  const raw = JSON.parse(tinyRaw);
  raw.components = { Button: "button", Broken: "[", Empty: " ", Number: 3, Total: ".total" };
  raw.screens[0].components.push("Broken");
  const { scan, problems } = FlowScan.read(raw, {
    devices: ["mobile"],
    validateSelector(selector) {
      if (selector === "[") throw new SyntaxError("invalid selector"); // the browser parser is the host seam
      return true;
    },
  });
  eq(scan.components, { Button: "button", Total: ".total" });
  assert.ok(scan.screens[0].components.includes("Broken"), "component inventory is still available");
  for (const name of ["Broken", "Empty", "Number"]) {
    assert.ok(problems.some((p) => p.includes(name) && p.includes("selector")), problems.join("\n"));
  }
});

test("any thrown selector rejection is reported without crashing the scan", () => {
  for (const rejection of [null, undefined, "bad selector", new SyntaxError("bad selector")]) {
    const { scan, problems } = FlowScan.read(tinyRaw, {
      devices: ["mobile"],
      validateSelector() { throw rejection; },
    });
    assert.ok(scan);
    eq(scan.components, {});
    for (const name of ["Button", "Total"]) {
      assert.ok(problems.some((p) => p.includes(name) && p.includes("bad selector")), problems.join("\n"));
    }
  }
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

/* ---------- approximate and unrendered screens ---------- */

test("a screen the scanner stubbed part of reads as approximate, and nothing else is", () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens[0].approximate = true;
  raw.screens[1].approximate = "yes"; /* only a real true counts */
  const { scan, problems } = readScan(raw);
  eq(problems, []);
  assert.equal(scan.screens[0].approximate, true);
  assert.equal(scan.screens[1].approximate, false);
});

test("a screen that could not render gives its reason and a placeholder for every device", () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens[1].html = {};
  raw.screens[1].unrendered = "Needs a payment session the mocks do not provide";
  const { scan, problems } = readScan(raw);
  eq(problems, []);
  const s = scan.screens[1];
  assert.equal(s.unrendered, "Needs a payment session the mocks do not provide");
  for (const d of FlowDevice.ids()) {
    assert.match(s.html[d], /Needs a payment session the mocks do not provide/, d + " shows the reason");
    assert.match(s.html[d], /could not be rendered/i);
  }
});

test("the reason on a placeholder is text, never markup", () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens[1].html = {};
  raw.screens[1].unrendered = '<img src=x onerror="alert(1)">';
  const { scan } = readScan(raw);
  assert.ok(!scan.screens[1].html.mobile.includes("<img"), "escaped");
  assert.match(scan.screens[1].html.mobile, /&lt;img/);
});

test("a render the scanner did give wins over the placeholder, and the reason is still kept", () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens[0].unrendered = "ignored for the render";
  const { scan } = readScan(raw);
  assert.equal(scan.screens[0].html.mobile, JSON.parse(tinyRaw).screens[0].html.mobile);
  assert.equal(scan.screens[0].html.tablet, JSON.parse(tinyRaw).screens[0].html.tablet);
  assert.match(scan.screens[0].html.desktop, /<p class="total">0<\/p>/);
  assert.equal(scan.screens[0].unrendered, "ignored for the render");
});

/* ---------- a state that exists on some devices only ---------- */

const withDesktopOnlyState = () => {
  const raw = JSON.parse(tinyRaw);
  raw.screens[0].states = [
    { name: "Default" },
    { name: "Dialog", html: { desktop: '<p class="dlg">Sign in</p>' } },
  ];
  return raw;
};

test("a state with no render for a device shows a placeholder that says so, on that device only", () => {
  const { scan, problems } = readScan(withDesktopOnlyState());
  eq(problems, []);
  const st = scan.screens[0].states[1];
  assert.match(st.html.desktop, /class="dlg"/, "the device it exists on still renders it");
  for (const d of FlowDevice.ids().filter((x) => x !== "desktop")) {
    assert.match(st.html[d], /This state doesn&#39;t exist on |This state doesn't exist on /, d + " says why");
    assert.ok(st.html[d].includes(d), d + " is named");
    assert.ok(!/could not be rendered/i.test(st.html[d]), "it is not the unrendered-screen wording");
  }
});

test("a state placeholder leaves the first state and a state with no html of its own alone", () => {
  const { scan } = readScan(withDesktopOnlyState());
  assert.equal(scan.screens[0].states[0].html, undefined, "the first state is the screen's own render");
  assert.equal(scan.screens[0].html.mobile, JSON.parse(tinyRaw).screens[0].html.mobile);
});
