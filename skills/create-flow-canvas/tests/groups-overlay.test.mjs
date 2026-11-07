/* Groups as edits over the scan. mergeGroups lays the user's edits over the scan's groups; diffGroups takes
   them off again. A group's text and state are edits like any other kind's; which group a frame is in is saved
   one frame at a time ("in group X" or "loose"), so a frame the user never moved follows the scan.
   Run:  node --test skills/create-flow-canvas/tests/groups-overlay.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowScan } from "./modules.mjs";

const plain = (o) => JSON.parse(JSON.stringify(o));
const eq = (actual, expected, message) => assert.deepEqual(plain(actual), plain(expected), message);
const g = (id, screens, title = id.toUpperCase()) => ({ id, screens, open: true, title, sub: "", subOn: false });
const SCAN = () => [g("g1", ["a", "b", "c"], "One"), g("g2", ["d", "e"], "Two")];
const members = (r) => Object.fromEntries(r.groups.map((x) => [x.id, x.screens]));
const merged = (scanned, saved, opts) => FlowScan.mergeGroups(scanned, saved, opts);
/* what the user does: change the groups as they are on the canvas, then save */
const edit = (scanned, change) => {
  const groups = merged(scanned, undefined).groups;
  change(groups);
  return FlowScan.diffGroups(scanned, groups);
};

test("nothing saved: the scan's groups as they are, in fresh copies; nothing changed: nothing to save", () => {
  const scan = SCAN();
  const out = merged(scan, undefined);
  eq(out.groups, scan);
  out.groups[0].screens.push("z");
  eq(scan[0].screens, ["a", "b", "c"], "the scan is not touched");
  eq(FlowScan.diffGroups(scan, merged(scan, undefined).groups), { edits: {}, mine: [], place: {}, order: {}, seq: [] });
});

test("a group's text is an edit: the user's wins where they touched it, the scan's reaches everything else", () => {
  const saved = edit(SCAN(), (gs) => ((gs[0].title = "Mine"), (gs[0].subOn = true)));
  eq(saved.edits, { g1: { title: "Mine", subOn: true } });
  const rescanned = [g("g1", ["a", "b", "c"], "One, renamed"), g("g2", ["d", "e"], "Two, renamed")];
  rescanned[0].sub = "new description";
  const out = merged(rescanned, saved).groups;
  eq(out.map((x) => x.title), ["Mine", "Two, renamed"]);
  assert.equal(out[0].sub, "new description", "a field the user never touched follows the scan");
});

test("a frame the user moved stays where they put it; one they never moved follows the scan", () => {
  const saved = edit(SCAN(), (gs) => {
    gs[0].screens = ["b", "c"];
    gs[1].screens = ["d", "e", "a"]; /* a moved from One to Two */
  });
  eq(saved.place, { a: "g2" });
  /* the scan now has c in Two, and a new screen f in One, and puts a back in One */
  const rescanned = [g("g1", ["a", "b", "f"], "One"), g("g2", ["c", "d", "e"], "Two")];
  eq(members(merged(rescanned, saved)), { g1: ["b", "f"], g2: ["c", "d", "e", "a"] });
});

test("a frame the user freed stays loose, even if the scan now puts it in another group", () => {
  const saved = edit(SCAN(), (gs) => (gs[0].screens = ["b", "c"]));
  eq(saved.place, { a: null });
  const rescanned = [g("g1", ["b", "c"], "One"), g("g2", ["a", "d", "e"], "Two")];
  eq(members(merged(rescanned, saved)), { g1: ["b", "c"], g2: ["d", "e"] });
});

test("a screen the scan adds to a group appears in it, loose screens it moves into a group join the group", () => {
  const saved = edit(SCAN(), (gs) => (gs[0].title = "Mine"));
  const rescanned = [g("g1", ["a", "b", "c", "f"], "One"), g("g2", ["d", "e", "x"], "Two")];
  eq(members(merged(rescanned, saved)), { g1: ["a", "b", "c", "f"], g2: ["d", "e", "x"] });
});

test("a group the scan removes goes with its edits; frames the user had put in it fall back to the scan", () => {
  const saved = edit(SCAN(), (gs) => {
    gs[1].title = "Mine";
    gs[1].screens = ["d", "e", "a"];
    gs[0].screens = ["b", "c"];
  });
  const rescanned = [g("g1", ["a", "b", "c"], "One")];
  const out = merged(rescanned, saved);
  eq(members(out), { g1: ["b", "c", "a"] }, "a is back where the scan has it; no trace of g2");
  eq(out.groups.map((x) => x.id), ["g1"]);
});

test("a group the user dissolved stays dissolved, and a screen the scan adds to it arrives loose", () => {
  const saved = edit(SCAN(), (gs) => gs.splice(1, 1));
  eq(saved.edits, { g2: { gone: true } });
  const rescanned = [g("g1", ["a", "b", "c"], "One"), g("g2", ["d", "e", "f"], "Two")];
  eq(members(merged(rescanned, saved)), { g1: ["a", "b", "c"] });
});

test("a scanned group the user emptied counts as dissolved", () => {
  const saved = edit(SCAN(), (gs) => ((gs[1].screens = []), (gs[0].screens = ["a", "b", "c", "d", "e"])));
  eq(saved.edits.g2, { gone: true });
  eq(Object.keys(members(merged(SCAN(), saved))), ["g1"]);
});

test("a group the user made is kept, with its frames, after the scan's", () => {
  const saved = edit(SCAN(), (gs) => {
    gs[0].screens = ["a", "b"];
    gs.push({ id: "g3", screens: ["c", "f"], open: false, title: "Mine: new", sub: "", subOn: false });
  });
  eq(saved.mine, [{ id: "g3", open: false, title: "Mine: new", sub: "", subOn: false }]);
  const out = merged(SCAN(), saved);
  eq(out.groups.map((x) => x.id), ["g1", "g2", "g3"]);
  eq(members(out), { g1: ["a", "b"], g2: ["d", "e"], g3: ["c", "f"] });
});

test("an order the user chose in a group is kept; frames the scan adds to it go last", () => {
  const saved = edit(SCAN(), (gs) => (gs[0].screens = ["c", "a", "b"]));
  eq(saved.order, { g1: ["c", "a", "b"] });
  eq(members(merged([g("g1", ["a", "b", "c", "f"]), g("g2", ["d", "e"])], saved)).g1, ["c", "a", "b", "f"]);
});

test("the order of the groups themselves is kept, with groups the scan adds last", () => {
  const saved = edit(SCAN(), (gs) => gs.reverse());
  eq(saved.seq, ["g2", "g1"]);
  const out = merged([...SCAN(), g("g9", ["z"])], saved);
  eq(out.groups.map((x) => x.id), ["g2", "g1", "g9"]);
});

test("a group of the user's whose id the scan now uses gets a fresh one, and its frames and order go with it", () => {
  const saved = edit(SCAN(), (gs) => {
    gs[0].screens = ["a", "b"];
    gs.push(g("g3", ["c", "f", "e"], "Mine"));
    gs[1].screens = ["d"];
  });
  const rescanned = [...SCAN(), g("g3", ["z"], "Scanned three")];
  const out = merged(rescanned, saved, { fresh: () => "g7" });
  eq(out.renamed, { g3: "g7" });
  eq(members(out), { g1: ["a", "b"], g2: ["d"], g3: ["z"], g7: ["c", "f", "e"] });
  eq(out.groups.find((x) => x.id === "g3").title, "Scanned three");
  eq(out.groups.find((x) => x.id === "g7").title, "Mine");
});

test("edits that are not edits are ignored", () => {
  const scan = SCAN();
  for (const junk of [null, 5, "x", [], { edits: 3, mine: "no", place: [], order: 1, seq: "g1" }, { place: { a: 4 }, order: { g1: "no" } }])
    eq(members(merged(scan, junk)), { g1: ["a", "b", "c"], g2: ["d", "e"] });
});

test("merging what diff produced gives back the groups it was taken from", () => {
  const scan = SCAN();
  const states = [
    (gs) => ((gs[0].screens = ["c", "b"]), (gs[1].screens = ["d", "a", "e"])),
    (gs) => (gs.splice(0, 1), gs.push(g("g5", ["a", "b"]))),
    (gs) => ((gs[0].screens = []), (gs[1].screens = ["e", "d", "a", "b", "c"]), (gs[1].open = false)),
  ];
  for (const change of states) {
    const groups = merged(scan, undefined).groups;
    change(groups);
    const live = groups.filter((x) => x.screens.length);
    const back = merged(scan, FlowScan.diffGroups(scan, live)).groups;
    eq(back, live);
  }
});
