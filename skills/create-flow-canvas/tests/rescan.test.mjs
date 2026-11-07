/* A rescan reaches a user who already has a saved layout, and their edits stay. The layout is run on its own,
   against two versions of one scan (the tiny scan, grown): the user edits against the first, the layout is
   saved, and a layout is made again from the same storage against the second.
   Run:  node --test skills/create-flow-canvas/tests/rescan.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowLayout, FlowCommit, FlowScan, readScan } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const tiny = JSON.parse(fs.readFileSync(path.join(here, "fixtures/tiny-scan.json"), "utf8"));
const KEY = FlowScan.storageKey(readScan(tiny).scan);
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
  const defaults = () => ({ groups: scan.groups, pos: { mobile: {}, tablet: {}, desktop: {} } });
  const kinds = FlowScan.dataKinds(() => scan);
  return FlowLayout.create({ key: FlowScan.storageKey(scan), storage, hasScreen: (id) => scan.screens.some((s) => s.id === id), defaults, kinds, ...over });
};
const members = (layout) => Object.fromEntries(layout.groups.map((l) => [l.id, l.screens]));
const cap = (layout, id) => layout.caps.find((c) => c.id === id);

test("two products on one origin keep separate edits, and reopening each finds its own layout", () => {
  const storage = memory({ "flow-canvas.layout.v1": "unscoped legacy data" });
  const first = v1(), second = v1();
  first.product.id = "first";
  second.product.id = "second";
  const a = layoutFor(first, storage);
  a.setGroupText("g1", { title: "First product's edits" });
  a.save();
  const b = layoutFor(second, storage);
  assert.equal(b.groups[0].title, "Tally: count fast");
  b.setGroupText("g1", { title: "Second product's edits" });
  b.save();
  assert.equal(layoutFor(first, storage).groups[0].title, "First product's edits");
  assert.equal(layoutFor(second, storage).groups[0].title, "Second product's edits");
  assert.equal(storage.data["flow-canvas.layout.v1"], "unscoped legacy data", "unknown legacy ownership is never guessed");
});

test("a saved user's group keeps its edits, place and view when a rescan adds a screen with its id", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  const made = a.groupFrames(["settings"], { device: "tablet", at: { x: 5, y: 6 } });
  a.setGroupText(made.id, { title: "My group" });
  a.setOpen(made.id, false);
  a.save();
  const rescanned = v1();
  rescanned.screens.push(screen(made.id, "New screen"));
  const b = layoutFor(rescanned, storage);
  const mine = b.groups.find((g) => g.title === "My group");
  assert.notEqual(mine.id, made.id, "the group and new screen must have separate positions");
  eq(mine.screens, ["settings"]);
  eq(b.pos.tablet[mine.id], { x: 5, y: 6 });
  assert.equal(b.pos.tablet[made.id], undefined, "the new screen cannot inherit the group's position");
  assert.equal(mine.open, false);
  assert.equal(layoutFor(rescanned, storage).snapshot(), b.snapshot(), "the repaired identity is saved");
});

/* the user's session against version 1 */
const userSession = () => {
  const storage = memory();
  const layout = layoutFor(v1(), storage);
  layout.setGroupText(layout.groupOf("settings").id, { title: "My settings" });
  layout.moveInto(["help"], "g2", 0); /* help goes to Settings, ahead of its frame */
  const mine = layout.groupFrames(["detail", "about"], { device: "mobile", at: { x: 50, y: 60 } });
  layout.setGroupText(mine.id, { title: "Mine: details" });
  layout.place("mobile", "g2", { x: 7, y: 8 });
  layout.edit("caps", "detail", { title: "Mine, the detail" });
  layout.save();
  return { storage, mineId: mine.id };
};

test("a rescan that renames, regroups, adds and removes reaches a saved layout, and the user's edits stay", () => {
  const { storage, mineId } = userSession();
  const layout = layoutFor(v2(), storage);
  /* the scan's own news */
  assert.equal(layout.groups.find((l) => l.id === "g1").title, "Tally: count faster", "a group the user never retitled is renamed");
  assert.deepEqual(plain(members(layout).g8), ["new2"], "a group the scan added, minus the frame the user had put elsewhere");
  assert.ok(members(layout).g1.includes("extra"), "a screen the scan added to a group lands in it, not loose");
  assert.equal(cap(layout, "home").title, "Start here, again", "a caption the user never touched");
  /* the user's edits */
  assert.equal(layout.groups.find((l) => l.id === "g2").title, "My settings", "a retitled group keeps the user's title");
  assert.deepEqual(plain(members(layout).g2), ["help", "settings"], "a frame the user moved stays, in the place they gave it; the frame the scan moved in but the user had taken out does not follow");
  assert.deepEqual(plain(members(layout)[mineId]), ["detail"], "the user's own group stays, minus the screen the scan no longer has");
  assert.equal(layout.groups.find((l) => l.id === mineId).title, "Mine: details");
  assert.equal(cap(layout, "detail").title, "Mine, the detail");
  eq(layout.pos.mobile.g2, { x: 7, y: 8 }, "a group the user pinned is still pinned");
  eq(layout.pos.mobile[mineId], { x: 50, y: 60 });
});

test("what the scan no longer has is gone from every kind, and what it points at is cleaned up", () => {
  const { storage } = userSession();
  const layout = layoutFor(v2(), storage);
  assert.equal(cap(layout, "about"), undefined);
  assert.deepEqual(plain(layout.conns.map((c) => c.id)), ["home>extra"], "a link the scan dropped is dropped");
  assert.ok(layout.groups.every((l) => l.screens.every((id) => id !== "about")));
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
  a.setGroupText(g.id, { title: "Mine: settings" });
  a.save();
  assert.equal(g.id, "g3");
  const s2 = v1();
  s2.groups.push({ id: "g3", screens: ["extra"], open: true, title: "Scanner's three", sub: "", subOn: false, meta: "" });
  s2.screens.push(screen("extra", "Extra"));
  const b = layoutFor(s2, storage);
  assert.equal(b.groups.find((l) => l.id === "g3").title, "Scanner's three");
  const mine = b.groups.find((l) => l.title === "Mine: settings");
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
  a.place("mobile", "about", { x: 1, y: 1 });
  const raw = JSON.parse(a.snapshot());
  raw.pos.mobile.nothing = { x: 2, y: 2 }; /* a place for something that was never there: a saved file can hold one */
  storage.data[KEY] = JSON.stringify({ ...JSON.parse((a.save(), storage.data[KEY])), pos: raw.pos });
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
  a.edit("caps", "home", { body: "My words" });
  a.save();
  assert.deepEqual(plain(Object.keys(storage.data)), [KEY]);
  const saved = JSON.parse(storage.data[KEY]);
  eq(saved.caps.edits, { home: { body: "My words" } });
  assert.equal(cap(layoutFor(v1(), storage), "home").body, "My words");
});

test("a caption edit is an undo step like a group's text", () => {
  const storage = memory();
  const layout = layoutFor(v1(), storage);
  const commit = FlowCommit.create({ layout, kinds: builtinKinds(), redraw: { world() {}, layout() {} } });
  commit.typing.change(() => layout.edit("caps", "home", { title: "Changed" }));
  commit.typing.end();
  assert.equal(cap(layout, "home").title, "Changed");
  commit.undo(() => {});
  assert.equal(cap(layout, "home").title, tiny.screens[0].caption.title);
});

test("a caption the scan changed reaches the user unless they edited that field", () => {
  const storage = memory();
  const a = layoutFor(v1(), storage);
  a.edit("caps", "home", { body: "Mine" });
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
  layout.edit("caps", "home", { title: "Mine" });
  layout.setGroupText("g1", { title: "Mine too" });
  layout.moveInto(["settings"], "g1", 0);
  layout.reset();
  assert.equal(cap(layout, "home").title, "Mine", "Reset layout is about groups, places and connectors");
  assert.equal(layout.groups[0].title, "Tally: count fast");
  eq(members(layout).g1, ["home", "detail", "help"]);
  layout.setGroupText("g1", { title: "Again" });
  layout.resetText();
  assert.equal(cap(layout, "home").title, tiny.screens[0].caption.title);
  assert.equal(layout.groups[0].title, "Tally: count fast");
});

/* ---------- layouts saved before groups were edits ---------- */

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
