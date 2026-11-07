/* A rescan reaches a user who already has a saved layout, and their edits stay. The layout is run on its own,
   against two versions of one scan (the tiny scan, grown): the user edits against the first, the layout is
   saved, and a layout is made again from the same storage against the second.
   Run:  node --test skills/create-flow-canvas/tests/rescan.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowLayout, FlowCommit, readScan } from "./modules.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tiny = JSON.parse(fs.readFileSync(path.join(here, "fixtures/tiny-scan.json"), "utf8"));
const KEY = "flow-canvas.layout.v1";
const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);

const screen = (id, name, caption) => ({
  ...plain(tiny.screens[1]),
  id,
  name,
  route: "/" + id,
  caption: caption || { title: name, body: "", on: false },
});
/* version 1 of the scan: Tally with four screens in two groups */
const v1 = () => {
  const s = plain(tiny);
  s.screens = [tiny.screens[0], screen("detail", "Detail"), screen("settings", "Settings"), screen("about", "About"), screen("help", "Help")].map(plain);
  s.groups = [
    { id: "g1", screens: ["home", "detail", "help"], open: true, title: "Tally: count fast", sub: "Two screens.", subOn: true, meta: "src/routes/*" },
    { id: "g2", screens: ["settings", "about"], open: true, title: "Settings", sub: "", subOn: false, meta: "" },
  ];
  s.links = [{ from: "home", to: "detail", label: "Open" }, { from: "settings", to: "about", label: "More" }];
  return s;
};
/* version 2: a group renamed, a screen moved between groups, one added, one removed, a group dropped, a new one */
const v2 = () => {
  const s = v1();
  s.screens = s.screens.filter((x) => x.id !== "about").concat(screen("extra", "Extra"), screen("new2", "New two"));
  s.screens.find((x) => x.id === "home").caption.title = "Start here, again";
  s.groups = [
    { id: "g1", screens: ["home", "extra"], open: true, title: "Tally: count faster", sub: "Two screens.", subOn: true, meta: "src/routes/*" },
    { id: "g2", screens: ["detail", "settings"], open: true, title: "Preferences", sub: "", subOn: false, meta: "" },
    { id: "g8", screens: ["help", "new2"], open: true, title: "Help", sub: "", subOn: false, meta: "" },
  ];
  s.links = [{ from: "home", to: "extra", label: "Open" }];
  return s;
};

const memory = (seed = {}) => {
  const data = { ...seed };
  return { data, getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) };
};
const layoutFor = (raw, storage, over = {}) => {
  const scan = readScan(raw).scan;
  const defaults = () => ({
    lanes: scan.groups,
    pos: { mobile: {}, tablet: {}, desktop: {} },
    conns: scan.links,
    notes: scan.notes,
    scans: scan.findings,
    caps: scan.screens.map((s) => ({ id: s.id, ...s.caption })),
  });
  return FlowLayout.create({ key: KEY, storage, hasScreen: (id) => scan.screens.some((s) => s.id === id), defaults, ...over });
};
const members = (layout) => Object.fromEntries(layout.lanes.map((l) => [l.id, l.screens]));
const cap = (layout, id) => layout.caps.find((c) => c.id === id);

/* the user's session against version 1 */
const userSession = () => {
  const storage = memory();
  const layout = layoutFor(v1(), storage);
  layout.groupOf("settings").title = "My settings";
  layout.moveInto(["help"], "g2", 0); /* help goes to Settings, ahead of its frame */
  const mine = layout.groupFrames(["detail", "about"], { device: "mobile", at: { x: 50, y: 60 } });
  mine.title = "Mine: details";
  layout.pos.mobile.g2 = { x: 7, y: 8 };
  cap(layout, "detail").title = "Mine, the detail";
  layout.save();
  return { storage, mineId: mine.id };
};

test("a rescan that renames, regroups, adds and removes reaches a saved layout, and the user's edits stay", () => {
  const { storage, mineId } = userSession();
  const layout = layoutFor(v2(), storage);
  /* the scan's own news */
  assert.equal(layout.lanes.find((l) => l.id === "g1").title, "Tally: count faster", "a group the user never retitled is renamed");
  assert.deepEqual(plain(members(layout).g8), ["new2"], "a group the scan added, minus the frame the user had put elsewhere");
  assert.ok(members(layout).g1.includes("extra"), "a screen the scan added to a group lands in it, not loose");
  assert.equal(cap(layout, "home").title, "Start here, again", "a caption the user never touched");
  /* the user's edits */
  assert.equal(layout.lanes.find((l) => l.id === "g2").title, "My settings", "a retitled group keeps the user's title");
  assert.deepEqual(plain(members(layout).g2), ["help", "settings"], "a frame the user moved stays, in the place they gave it; the frame the scan moved in but the user had taken out does not follow");
  assert.deepEqual(plain(members(layout)[mineId]), ["detail"], "the user's own group stays, minus the screen the scan no longer has");
  assert.equal(layout.lanes.find((l) => l.id === mineId).title, "Mine: details");
  assert.equal(cap(layout, "detail").title, "Mine, the detail");
  eq(layout.pos.mobile.g2, { x: 7, y: 8 }, "a group the user pinned is still pinned");
  eq(layout.pos.mobile[mineId], { x: 50, y: 60 });
});

test("what the scan no longer has is gone from every kind, and what it points at is cleaned up", () => {
  const { storage } = userSession();
  const layout = layoutFor(v2(), storage);
  assert.equal(cap(layout, "about"), undefined);
  assert.deepEqual(plain(layout.conns.map((c) => c.id)), ["home>extra"], "a link the scan dropped is dropped");
  assert.ok(layout.lanes.every((l) => l.screens.every((id) => id !== "about")));
});

test("the version change is saved: a layout made again from what was saved is the same layout", () => {
  const { storage } = userSession();
  const first = layoutFor(v2(), storage);
  first.save();
  const again = layoutFor(v2(), storage);
  assert.equal(again.snapshot(), first.snapshot());
  const saved = JSON.parse(storage.data[KEY]);
  assert.equal(saved.v, 3);
  assert.ok(!Array.isArray(saved.lanes), "groups are saved as edits, not as a list");
  assert.equal(saved.lanes.edits.g2.title, "My settings");
  assert.ok(!JSON.stringify(saved).includes("count faster"), "no copy of the scan's text in what is saved");
});

test("a group or screen the user has not touched follows the scan back and forth", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  a.save();
  const b = layoutFor(v2(), storage);
  eq(members(b), { g1: ["home", "extra"], g2: ["detail", "settings"], g8: ["help", "new2"] });
  b.save();
  eq(members(layoutFor(v1(), storage)), { g1: ["home", "detail", "help"], g2: ["settings", "about"] }, "and back to version 1");
});

test("a group the user dissolved stays dissolved after a rescan; its screens the scan adds are loose", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  a.takeOut(["settings", "about"]);
  a.save();
  const s2 = v1();
  s2.screens.push(screen("fresh1", "Fresh"));
  s2.groups[1].screens.push("fresh1");
  eq(members(layoutFor(s2, storage)), { g1: ["home", "detail", "help"] });
});

test("a user's group whose id a rescan now uses gets a fresh id, with its frames, place and title", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  const g = a.groupFrames(["settings"], { device: "tablet", at: { x: 5, y: 6 } });
  g.title = "Mine: settings";
  a.save();
  assert.equal(g.id, "g3");
  const s2 = v1();
  s2.groups.push({ id: "g3", screens: ["extra"], open: true, title: "Scanner's three", sub: "", subOn: false, meta: "" });
  s2.screens.push(screen("extra", "Extra"));
  const b = layoutFor(s2, storage);
  assert.equal(b.lanes.find((l) => l.id === "g3").title, "Scanner's three");
  const mine = b.lanes.find((l) => l.title === "Mine: settings");
  assert.notEqual(mine.id, "g3");
  eq(mine.screens, ["settings"]);
  eq(b.pos.tablet[mine.id], { x: 5, y: 6 });
  assert.equal(b.pos.tablet.g3, undefined);
  assert.notEqual(b.nextId("g"), mine.id, "the fresh id is not handed out again");
});

test("positions of things the scan no longer has are dropped when the layout is loaded", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  a.takeOut(["about"]);
  a.pos.mobile.about = { x: 1, y: 1 };
  a.pos.mobile.nothing = { x: 2, y: 2 };
  a.save();
  const s2 = v1();
  s2.screens = s2.screens.filter((x) => x.id !== "about");
  s2.groups[1].screens = ["settings"];
  s2.links = [];
  const b = layoutFor(s2, storage);
  eq(b.pos.mobile, {});
});

/* ---------- captions are part of the layout ---------- */

test("captions are saved with the layout, as edits, under the one key", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  cap(a, "home").body = "My words";
  a.save();
  assert.deepEqual(plain(Object.keys(storage.data)), [KEY]);
  const saved = JSON.parse(storage.data[KEY]);
  eq(saved.caps.edits, { home: { body: "My words" } });
  assert.equal(cap(layoutFor(v1(), storage), "home").body, "My words");
});

test("a caption edit is an undo step like a group's text", () => {
  const storage = memory();
  const layout = layoutFor(v1(), storage);
  const commit = FlowCommit.create({ layout, redraw: { world() {}, layout() {}, scans() {}, notes() {}, conns() {} } });
  const before = layout.snapshot();
  cap(layout, "home").title = "Changed";
  commit.since(before);
  assert.equal(cap(layout, "home").title, "Changed");
  commit.undo(() => {});
  assert.equal(cap(layout, "home").title, tiny.screens[0].caption.title);
});

test("a caption the scan changed reaches the user unless they edited that field", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  cap(a, "home").body = "Mine";
  a.save();
  const s2 = v1();
  s2.screens[0].caption = { title: "New title", body: "Scanner's body", on: true };
  const b = layoutFor(s2, storage);
  assert.equal(cap(b, "home").title, "New title");
  assert.equal(cap(b, "home").body, "Mine");
});

test("resetting the layout leaves captions alone; resetting the text puts captions and group text back to the scan", () => {
  const storage = memory();
  const layout = layoutFor(v1(), storage);
  cap(layout, "home").title = "Mine";
  layout.lanes[0].title = "Mine too";
  layout.moveInto(["settings"], "g1", 0);
  layout.reset();
  assert.equal(cap(layout, "home").title, "Mine", "Reset layout is about groups, places and connectors");
  assert.equal(layout.lanes[0].title, "Tally: count fast");
  eq(members(layout).g1, ["home", "detail", "help"]);
  layout.lanes[0].title = "Again";
  layout.resetText();
  assert.equal(cap(layout, "home").title, tiny.screens[0].caption.title);
  assert.equal(layout.lanes[0].title, "Tally: count fast");
});

test("captions the older build kept in its own store are folded in once, as edits", () => {
  const storage = memory();
  const legacyCaptions = () => ({ home: { title: "Old title" }, nope: { title: "x" } });
  const a = layoutFor(v1(), storage, { legacyCaptions });
  assert.equal(cap(a, "home").title, "Old title");
  assert.deepEqual(plain(Object.keys(JSON.parse(storage.data[KEY]).caps.edits)), ["home"], "saved at once, so the old store can go");
  /* the next load has the layout, which wins; the old store is not read again */
  const b = layoutFor(v1(), storage, { legacyCaptions: () => ({ home: { title: "Stale" } }) });
  assert.equal(cap(b, "home").title, "Old title");
});

/* ---------- layouts saved before groups were edits ---------- */

test("a layout saved with whole groups (v2) still loads: it is read against the current scan, and saved as edits", () => {
  const storage = memory({
    [KEY]: JSON.stringify({
      v: 2,
      lanes: [
        { id: "g1", screens: ["home", "detail"], open: false, title: "Tally: count fast", sub: "Two screens.", subOn: true },
        { id: "g2", screens: ["settings"], open: true, title: "Settings, mine", sub: "", subOn: false },
      ],
      pos: { mobile: {}, tablet: {}, desktop: {} },
      conns: { edits: {}, mine: [] },
      scans: { edits: {}, mine: [] },
      notes: { edits: {}, mine: [] },
      cc: 0,
      gc: 2,
    }),
  });
  const layout = layoutFor(v1(), storage);
  eq(members(layout), { g1: ["home", "detail"], g2: ["settings"] }, "about and help were loose in the old layout and stay loose");
  assert.equal(layout.lanes[0].open, false);
  assert.equal(layout.lanes[1].title, "Settings, mine");
  const saved = JSON.parse(storage.data[KEY]);
  assert.equal(saved.v, 3);
  eq(saved.lanes.edits.g1, { open: false });
  eq(saved.lanes.edits.g2.title, "Settings, mine");
  eq(saved.lanes.place, { about: null, help: null });
});

test("in a layout saved with whole groups, a scanned group it could not have had (an id above its counter) is new, one below it that is missing was dissolved", () => {
  const old = JSON.stringify({
    v: 2,
    lanes: [{ id: "g2", screens: ["settings", "about"], open: true, title: "Settings", sub: "", subOn: false }],
    pos: {},
    cc: 0,
    gc: 2,
  });
  const layout = layoutFor(v2(), memory({ [KEY]: old }));
  assert.ok(!layout.lanes.some((l) => l.id === "g1"), "g1 is below the counter and missing: the user dissolved it");
  assert.ok(layout.lanes.some((l) => l.id === "g8"), "g8 is above it: the scan added it");
});

test("a saved layout cannot take a caption away: every screen the scan has keeps one", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  a.save();
  const saved = JSON.parse(storage.data[KEY]);
  saved.caps.edits = { home: { gone: true } };
  storage.data[KEY] = JSON.stringify(saved);
  const b = layoutFor(v1(), storage);
  assert.equal(cap(b, "home").title, tiny.screens[0].caption.title);
  assert.equal(b.caps.length, 5);
});
