/* Arrange module tests: the edits that move frames about as a whole (tidy, take frames out of their groups, dissolve a
   group), run on the real layout and geometry with no page. The module writes to the layout and nothing else: the
   commit, the toasts and the camera are the page's.
   Run:  node --test skills/create-flow-canvas/tests/arrange.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowArrange, FlowDevice, FlowGeometry, FlowLayout } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
const M = FlowDevice.describe("mobile").metrics;
const { WORLD } = FlowGeometry;
const FRAMES = ["s1", "s2", "s3", "s4", "s5", "s6", "s7", "s8", "s9"];
const DEFAULTS = () => ({
  groups: [
    { id: "g1", screens: ["s1", "s2", "s3", "s4"], open: true },
    { id: "g2", screens: ["s5", "s6", "s7"], open: false },
    { id: "g3", screens: ["s8", "s9"], open: false },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [{ id: "c1", from: "s1", to: "s2", label: "Continue" }],
  notes: [{ id: "n1", frame: "s1", who: "Dana", text: "Hero image is big", pos: { mobile: [1, 2] } }],
  scans: [],
});

/* the page's setup in miniature: a layout, a geometry that is told where things go (as relayout does), the arranger */
function setup() {
  const data = {};
  const layout = FlowLayout.create({
    key: "k",
    storage: { getItem: (k) => (k in data ? data[k] : null), setItem: (k, v) => void (data[k] = String(v)) },
    hasScreen: (id) => FRAMES.includes(id),
    defaults: DEFAULTS,
    kinds: builtinKinds(DEFAULTS),
  });
  const geo = FlowGeometry.create({ reduceMotion: true });
  geo.setMetrics(M);
  const input = () => ({
    groups: layout.groups.map(({ id, screens, open }) => ({ id, screens, open })),
    screens: FRAMES,
    pos: layout.pos.mobile,
  });
  const relayout = () => geo.retarget(input(), 0, { snap: true });
  relayout();
  const arrange = FlowArrange.create({ layout, geo, frames: FRAMES, device: () => "mobile", metrics: () => M, input });
  return { layout, geo, arrange, relayout, input };
}
const memberships = (layout) => plain(layout.groups.map((l) => [l.id, l.screens]));
const lose = (layout, ...ids) => layout.takeOut(ids); /* frames that are loose, for the tests that need some */

/* ---------- tidy ---------- */

test("tidy forgets where groups and loose frames were put on this device, and only this device", () => {
  const { layout, arrange } = setup();
  lose(layout, "s9");
  layout.place("mobile", "g1", { x: 700, y: 900 });
  layout.place("mobile", "s9", { x: 5, y: 5 });
  layout.place("tablet", "g1", { x: 11, y: 12 });
  arrange.tidy();
  assert.equal(layout.pos.mobile.g1, undefined);
  assert.deepEqual(plain(layout.pos.tablet.g1), { x: 11, y: 12 });
});

test("tidy lines the loose frames up below the groups, in reading order, and writes that place down", () => {
  const { layout, arrange, input, relayout } = setup();
  lose(layout, "s8", "s9");
  layout.place("mobile", "s8", { x: 900, y: 10 }); /* right */
  layout.place("mobile", "s9", { x: 10, y: 20 }); /* left, a few px lower: the same row */
  relayout();
  arrange.tidy();
  const { bottom } = FlowGeometry.arrange(input(), M);
  assert.deepEqual(plain(layout.pos.mobile.s9), plain(FlowGeometry.loosePlace(0, bottom, M)), "s9 reads first");
  assert.deepEqual(plain(layout.pos.mobile.s8), plain(FlowGeometry.loosePlace(1, bottom, M)));
});

test("tidy keeps the stacking order the groups were arranged in: top to bottom, then left to right", () => {
  const { layout, arrange, relayout } = setup();
  layout.place("mobile", "g3", { x: WORLD.groupLeft, y: -4000 });
  layout.place("mobile", "g2", { x: WORLD.groupLeft, y: -2000 });
  relayout();
  arrange.tidy();
  assert.deepEqual(plain(layout.groups.map((l) => l.id)), ["g3", "g2", "g1"]);
});

test("tidy leaves what the flows are alone: membership, order, connectors, notes' text", () => {
  const { layout, arrange } = setup();
  layout.place("mobile", "g1", { x: 700, y: 900 });
  const was = { groups: memberships(layout), conns: plain(layout.conns), text: layout.notes[0].text };
  arrange.tidy();
  assert.deepEqual(memberships(layout).sort(), was.groups.sort());
  assert.deepEqual(plain(layout.conns), was.conns);
  assert.equal(layout.notes[0].text, was.text);
});

test("tidy puts a moved note back where the scan had it", () => {
  const { layout, arrange } = setup();
  layout.edit("notes", "n1", { pos: { mobile: [300, 400] } });
  arrange.tidy();
  assert.deepEqual(plain(layout.notes[0].pos.mobile), [1, 2]);
});

test("tidy says whether it changed anything: a layout that is already tidy is left as it was", () => {
  const { layout, arrange, relayout } = setup();
  lose(layout, "s9");
  layout.place("mobile", "g1", { x: 700, y: 900 });
  relayout();
  assert.equal(arrange.tidy(), true);
  relayout();
  const before = layout.snapshot();
  assert.equal(arrange.tidy(), false, "the second time there is nothing to tidy");
  assert.equal(layout.snapshot(), before);
});

/* ---------- taking frames out of their groups ---------- */

test("frames taken out of an open group are set down to its right, in a row, where they were vertically", () => {
  const { layout, geo, arrange } = setup();
  const box = geo.box("g1"),
    y1 = geo.place("s1").y,
    y3 = geo.place("s3").y;
  const taken = arrange.takeOut(["s1", "s3"]);
  assert.deepEqual(plain(taken), ["s1", "s3"]);
  const end = box.x + 4 * (M.colW + WORLD.gap) + 40;
  assert.deepEqual(plain(layout.pos.mobile.s1), { x: end, y: y1 });
  assert.deepEqual(plain(layout.pos.mobile.s3), { x: end + (M.colW + 70), y: y3 });
  assert.deepEqual(memberships(layout)[0], ["g1", ["s2", "s4"]]);
});

test("frames taken out of a closed group are set down beside its deck, at the group's own height", () => {
  const { layout, geo, arrange } = setup();
  const box = geo.box("g2");
  arrange.takeOut(["s6"]);
  assert.deepEqual(plain(layout.pos.mobile.s6), { x: box.x + M.deckW + M.peekX * 3 + 120, y: box.top + WORLD.head });
});

test("frames from different groups each go beside their own group", () => {
  const { layout, geo, arrange } = setup();
  const b1 = geo.box("g1"),
    b2 = geo.box("g2");
  arrange.takeOut(["s2", "s5"]);
  assert.equal(layout.pos.mobile.s2.x, b1.x + 4 * (M.colW + WORLD.gap) + 40);
  assert.equal(layout.pos.mobile.s5.x, b2.x + M.deckW + M.peekX * 3 + 120);
});

test("a group left with no frames goes", () => {
  const { layout, arrange } = setup();
  arrange.takeOut(["s8", "s9"]);
  assert.deepEqual(plain(layout.groups.map((l) => l.id)), ["g1", "g2"]);
});

test("taking out a frame that is loose does nothing, and says so", () => {
  const { layout, arrange } = setup();
  lose(layout, "s9");
  const before = layout.snapshot();
  assert.deepEqual(plain(arrange.takeOut(["s9"])), []);
  assert.deepEqual(plain(arrange.takeOut([])), []);
  assert.equal(layout.snapshot(), before);
});

test("frames taken out with some that are loose: only the grouped ones are taken, and reported", () => {
  const { layout, arrange } = setup();
  lose(layout, "s9");
  assert.deepEqual(plain(arrange.takeOut(["s9", "s8"])), ["s8"]);
});

/* ---------- dissolving a group ---------- */

test("a dissolved group's frames stay on the canvas in a row where the group was, in their order", () => {
  const { layout, geo, arrange } = setup();
  const box = geo.box("g1");
  arrange.dissolve(layout.groups[0]);
  ["s1", "s2", "s3", "s4"].forEach((id, k) => {
    assert.deepEqual(plain(layout.pos.mobile[id]), { x: box.x + k * (M.colW + WORLD.gap), y: box.top + WORLD.head }, id);
  });
  assert.deepEqual(plain(layout.groups.map((l) => l.id)), ["g2", "g3"]);
});

test("dissolving a group does not touch the other groups", () => {
  const { layout, arrange } = setup();
  arrange.dissolve(layout.groups[1]);
  assert.deepEqual(memberships(layout), [["g1", ["s1", "s2", "s3", "s4"]], ["g3", ["s8", "s9"]]]);
});
