/* Extents: how big a frame, a row of frames, a deck and a group are, and the bands round a group that a dragged frame
   drops into. FlowGeometry answers each of these once (N4); the gesture, the arrangement edits, the page and the
   leader ask it. Every number below is written out the way the old copies computed it, so a green run says the
   canvas draws the same pixels, on every device.
   Run:  node --test skills/create-flow-canvas/tests/extents.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowDevice, FlowGeometry } from "./modules.mjs";

const { WORLD, EDGES, frame, slotPitch, rowW, deckSpread, groupCornerFor, loosePlace, create } = FlowGeometry;
const plain = (x) => JSON.parse(JSON.stringify(x));
const DEVICES = FlowDevice.ids();
const metricsOf = (dev) => FlowDevice.describe(dev).metrics;
const ids = (n, p = "s") => Array.from({ length: n }, (_, i) => `${p}${i}`);
const group = (id, screens, open = true) => ({ id, screens, open });
/* a geometry arranged with the given groups at the given places, on one device */
function live(dev, groups, pos = {}, loose = []) {
  const g = create({ reduceMotion: true });
  g.setMetrics(metricsOf(dev));
  g.retarget({ groups, screens: [...groups.flatMap((x) => x.screens), ...loose], pos }, 0, { snap: true });
  return g;
}
const each = (name, fn) => DEVICES.forEach((dev) => test(`${name} (${dev})`, () => fn(dev, metricsOf(dev))));

/* ---------- the named offsets: each one pinned ---------- */

test("every offset an extent is built from has a name, and the table is frozen", () => {
  assert.deepEqual(plain(EDGES), {
    rowPad: 60,
    rowMin: 460,
    deckPeeks: 3,
    loosePitch: 70,
    looseRowGap: 100,
    looseTop: 140,
    titlePad: 60,
    titleRise: 100,
    band: {
      open: { left: 90, right: 1.4, top: 30, bottom: 70 },
      closed: { left: 30, right: 70, top: 30, bottom: 20 },
    },
    zone: {
      open: { inset: 28, above: 34, taller: 60 },
      closed: { inset: 34, above: 14, taller: 10 },
    },
    exit: { open: 40, closed: 120 },
  });
  assert.ok(Object.isFrozen(EDGES) && Object.isFrozen(EDGES.band.open) && Object.isFrozen(EDGES.zone.closed));
});

/* ---------- the frame, the row and the deck ---------- */

each("a frame is its screen below the bezel, then its caption", (dev, M) => {
  assert.deepEqual(plain(frame(M)), {
    w: M.colW,
    screenTop: M.phTop,
    screenH: M.phH,
    screenBottom: M.phTop + M.phH,
    caption: M.cap,
    h: M.phTop + M.phH + M.cap,
  });
});

each("the pitch of a row is a frame and the gap; a row is as wide as its frames and the gaps between them", (dev, M) => {
  assert.equal(slotPitch(M), M.colW + WORLD.gap);
  assert.equal(rowW(3, M), 3 * M.colW + 2 * WORLD.gap);
  assert.equal(rowW(1, M), M.colW);
  assert.equal(rowW(0, M), M.colW, "an empty row still has room for one");
});

each("a deck is as wide as its card and the peeks of the cards behind it", (dev, M) => {
  assert.equal(deckSpread(1, M), M.deckW);
  assert.equal(deckSpread(4, M), M.deckW + 3 * M.peekX);
  assert.equal(deckSpread(0, M), M.deckW, "an empty deck is one card wide");
});

each("an open group's box is its row and the padding, never narrower than the minimum; the arrangement agrees", (dev, M) => {
  const g = live(dev, [group("a", ids(1)), group("b", ids(5, "b"))]);
  assert.equal(g.box("a").w, Math.max(M.colW + 60, 460), "a short row still has room to drop a frame into");
  assert.equal(g.box("b").w, 5 * M.colW + 4 * WORLD.gap + 60);
});

test("a group is placed so its first frame lands where the frame it replaces was", () => {
  assert.deepEqual(plain(groupCornerFor({ x: 500, y: 900 })), { x: 500, y: 900 - WORLD.head });
});

each("where frame i of an open group sits, and where it is when a group is dissolved", (dev, M) => {
  const g = live(dev, [group("a", ids(3))], { a: { x: 700, y: 900 } });
  [0, 1, 2].forEach((i) => {
    assert.deepEqual(plain(g.slotPlace("a", i)), { x: 700 + i * (M.colW + WORLD.gap), y: 900 + WORLD.head });
    assert.equal(g.slotPlace("a", i).x, g.place(`s${i}`).x, "the arrangement puts it there too");
    assert.equal(g.slotPlace("a", i).y, g.place(`s${i}`).y);
  });
});

/* ---------- loose frames: rows of five below the groups ---------- */

each("loose frames stand in rows of five, a column and 70 apart, the first row 140 below the groups", (dev, M) => {
  const rowH = M.phTop + M.phH + M.cap + 100;
  assert.deepEqual(plain(loosePlace(0, 1000, M)), { x: WORLD.groupLeft, y: 1000 + 140 });
  assert.deepEqual(plain(loosePlace(3, 1000, M)), { x: WORLD.groupLeft + 3 * (M.colW + 70), y: 1000 + 140 });
  assert.deepEqual(plain(loosePlace(5, 1000, M)), { x: WORLD.groupLeft, y: 1000 + 140 + rowH }, "the sixth starts the next row");
  assert.deepEqual(plain(loosePlace(7, 1000, M)), { x: WORLD.groupLeft + 2 * (M.colW + 70), y: 1000 + 140 + rowH });
});

/* ---------- where frames taken out of a group land ---------- */

each("frames let out of an open group land right of its row, one loose pitch apart", (dev, M) => {
  const g = live(dev, [group("a", ids(3))], { a: { x: 700, y: 900 } });
  const end = 700 + 3 * (M.colW + WORLD.gap) + 40;
  assert.equal(g.exitX("a"), end);
  assert.equal(g.exitX("a", 2), end + 2 * (M.colW + 70));
});

each("frames let out of a closed group land right of the deck's widest fan", (dev, M) => {
  const g = live(dev, [group("a", ids(2), false)], { a: { x: 700, y: 900 } });
  const end = 700 + M.deckW + M.peekX * 3 + 120;
  assert.equal(g.exitX("a"), end, "three peeks, whatever the size of the deck");
  assert.equal(g.exitX("a", 1), end + (M.colW + 70));
});

each("an open group with no frames lets them out just right of where its row would start", (dev, M) => {
  const g = live(dev, [group("a", [])], { a: { x: 700, y: 900 } });
  assert.equal(g.exitX("a"), 700 + 40);
});

/* ---------- the drop zone: the box the page lights up ---------- */

each("an open group's drop zone surrounds its row and the frames' column", (dev, M) => {
  const g = live(dev, [group("a", ids(3))]);
  assert.deepEqual(plain(g.dropZone("a")), {
    left: -28,
    top: -34,
    w: 3 * (M.colW + WORLD.gap) - WORLD.gap + 56,
    h: M.phTop + M.phH + M.cap + 60,
  });
});

each("a closed group's drop zone surrounds its deck, the head above it and the collapsed height", (dev, M) => {
  const g = live(dev, [group("a", ids(3), false)]);
  assert.deepEqual(plain(g.dropZone("a")), {
    left: -34,
    top: -WORLD.head - 14,
    w: M.deckW + M.peekX * 2 + 68,
    h: M.collH + 10,
  });
});

each("an empty group's drop zone is one slot wide when open and one card wide when closed", (dev, M) => {
  const open = live(dev, [group("a", [])]).dropZone("a");
  assert.equal(open.w, M.colW + 56);
  const closed = live(dev, [group("a", [], false)]).dropZone("a");
  assert.equal(closed.w, M.deckW + 68);
});

each("a closed group's title sits right of its deck, and half-way down the collapsed height less the head's offset", (dev, M) => {
  const g = live(dev, [group("a", ids(3), false), group("e", [], false)]);
  assert.deepEqual(plain(g.closedTitle("a")), { x: M.deckW + M.peekX * 2 + 60, y: Math.max(0, Math.round(M.collH / 2 - 100)) });
  assert.equal(live(dev, [group("t", [], false)]).closedTitle("t").y >= 0, true, "never above the group's corner");
  assert.equal(g.closedTitle("e").x, M.deckW + 60, "an empty deck still has one card");
});

/* ---------- the drop band: where a dragged frame joins a group ---------- */

each("an open group's band: wide on the left, a column and a half past its slots, a head and a frame tall", (dev, M) => {
  const g = live(dev, [group("a", ids(3))], { a: { x: 700, y: 900 } });
  assert.deepEqual(plain(g.dropBand("a", { count: 2 })), {
    x0: 700 - 90,
    x1: 700 + 2 * (M.colW + WORLD.gap) + M.colW * 1.4,
    y0: 900 - 30,
    y1: 900 + WORLD.head + M.phTop + M.phH + M.cap + 70,
  });
});

each("an open group with no other frames has a band of one empty row", (dev, M) => {
  const g = live(dev, [group("a", ids(1))], { a: { x: 700, y: 900 } });
  const b = g.dropBand("a", { count: 0 });
  assert.equal(b.x1, 700 + M.colW * 1.4);
  assert.equal(b.x0, 700 - 90);
});

each("a closed group's band: its deck at the widest fan, and the collapsed height", (dev, M) => {
  const g = live(dev, [group("a", ids(2), false)], { a: { x: 700, y: 900 } });
  const want = { x0: 700 - 30, x1: 700 + M.deckW + M.peekX * 3 + 70, y0: 900 - 30, y1: 900 + M.collH + 20 };
  assert.deepEqual(plain(g.dropBand("a", { count: 2 })), want);
  assert.deepEqual(plain(g.dropBand("a", { count: 9 })), want, "how many cards there are does not change it");
});

/* ---------- which group a point is over, and at which slot ---------- */

each("over an open group, the slot is the one nearest the point's x among the frames that stay", (dev, M) => {
  const g = live(dev, [group("a", ids(3))], { a: { x: 700, y: 900 } });
  const y = 900 + WORLD.head + M.phTop + M.phH / 2;
  const at = (x) => plain(g.slotAt({ x, y }));
  const pitch = M.colW + WORLD.gap;
  assert.deepEqual(at(700 + M.colW / 2), { group: "a", idx: 0 });
  assert.deepEqual(at(700 + M.colW / 2 + pitch), { group: "a", idx: 1 });
  assert.deepEqual(at(700 + M.colW / 2 + pitch * 3), { group: "a", idx: 3 }, "past the end, the end");
  assert.deepEqual(at(700 + M.colW / 2 - 80), { group: "a", idx: 0 }, "left of the first, the first");
});

each("frames being dragged do not count as staying, so the slots and the band shrink with them", (dev, M) => {
  const g = live(dev, [group("a", ids(3))], { a: { x: 700, y: 900 } });
  const y = 900 + WORLD.head + M.phTop + M.phH / 2;
  const far = 700 + M.colW / 2 + 5 * (M.colW + WORLD.gap);
  assert.deepEqual(plain(g.slotAt({ x: far, y }, { skip: ["s0", "s1"] })), null, "one frame left: the band ends a column and a half past its slot");
  const end = 700 + (M.colW + WORLD.gap) + M.colW * 1.4;
  assert.deepEqual(plain(g.slotAt({ x: end, y }, { skip: ["s0", "s1"] })), { group: "a", idx: 1 });
});

each("over a closed group the drop goes to the end of the deck", (dev, M) => {
  const g = live(dev, [group("a", ids(2), false)], { a: { x: 700, y: 900 } });
  assert.deepEqual(plain(g.slotAt({ x: 700 + 5, y: 900 + 5 })), { group: "a", idx: 2 });
  assert.deepEqual(plain(g.slotAt({ x: 700 + 5, y: 900 + 5 }, { skip: ["s0"] })), { group: "a", idx: 1 });
  assert.equal(g.slotAt({ x: 700 + M.deckW + M.peekX * 3 + 71, y: 900 + 5 }), null, "past the band");
});

each("the band's four edges are in: a point on an edge is over the group, one pixel beyond is not", (dev, M) => {
  const g = live(dev, [group("a", ids(2))], { a: { x: 700, y: 900 } });
  const b = g.dropBand("a", { count: 2 });
  const mid = { x: (b.x0 + b.x1) / 2, y: (b.y0 + b.y1) / 2 };
  const over = (p) => g.slotAt(p) !== null;
  assert.ok(over({ x: b.x0, y: mid.y }) && !over({ x: b.x0 - 1, y: mid.y }));
  assert.ok(over({ x: b.x1, y: mid.y }) && !over({ x: b.x1 + 1, y: mid.y }));
  assert.ok(over({ x: mid.x, y: b.y0 }) && !over({ x: mid.x, y: b.y0 - 1 }));
  assert.ok(over({ x: mid.x, y: b.y1 }) && !over({ x: mid.x, y: b.y1 + 1 }));
});

each("two groups in reach: the open one whose row centre is nearer wins; a closed one always wins", (dev, M) => {
  const g = live(dev, [group("a", ids(2)), group("b", ids(2, "b"))], { a: { x: 700, y: 900 }, b: { x: 700 + M.colW, y: 900 } });
  const y = 900 + WORLD.head + M.phTop + M.phH / 2;
  assert.equal(g.slotAt({ x: 700 + M.colW / 2, y }).group, "a", "nearer a's row centre");
  assert.equal(g.slotAt({ x: 700 + M.colW * 2, y }).group, "b");
  const c = live(dev, [group("a", ids(2)), group("c", ids(2, "c"), false)], { a: { x: 700, y: 900 }, c: { x: 700, y: 900 } });
  assert.equal(c.slotAt({ x: 700 + 10, y: 900 + 10 }).group, "c");
});

each("away from every group there is no slot", (dev) => {
  const g = live(dev, [group("a", ids(2))], { a: { x: 700, y: 900 } });
  assert.equal(g.slotAt({ x: 0, y: 0 }), null);
});
