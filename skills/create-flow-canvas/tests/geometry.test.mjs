/* Geometry: where a frame is meant to be (arrangement), where it is right now (motion), and the
   questions the canvas asks about both. No page, no clock: "now" is a number the test hands in.
   Run:  node --test skills/create-flow-canvas/tests/geometry.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowDevice, FlowGeometry, FlowRouting, html } from "./modules.mjs";

const { arrange, loosePlace, groupH, WORLD, create } = FlowGeometry;
const plain = (x) => JSON.parse(JSON.stringify(x));
const xy = (r) => ({ x: r.x, y: r.y });
const M = FlowDevice.describe("mobile").metrics;
const GROUP_H = groupH(M);
const ids = (n, p = "s") => Array.from({ length: n }, (_, i) => `${p}${i}`);
const group = (id, screens, open = true) => ({ id, screens, open });
/* a canvas of the given groups, plus loose frames, in one list of screens */
const world = (groups, loose = [], pos = {}) => ({
  groups,
  screens: [...groups.flatMap((g) => g.screens), ...loose],
  pos,
});
const deepFreeze = (o) => (Object.values(o).forEach((v) => typeof v === "object" && v && deepFreeze(v)), Object.freeze(o));

/* ---------- arrangement: the pure part ---------- */

test("an open group fans out in a row, one frame per slot, the first on top", () => {
  const a = plain(arrange(world([group("g", ids(3))]), M));
  const x0 = WORLD.groupLeft;
  assert.deepEqual(
    a.places.s1,
    { x: x0 + (M.colW + WORLD.gap), y: WORLD.top0 + WORLD.head, r: 0, s: 1, d: 60, z: 2, fx: 0, fy: 0, deck: false, group: "g", i: 1 },
  );
  assert.equal(a.places.s0.z, 3);
  assert.equal(a.places.s2.x, x0 + 2 * (M.colW + WORLD.gap));
});

test("a closed group stacks into a deck: peeking, tilted, staggered from the back", () => {
  const a = plain(arrange(world([group("g", ids(3), false)]), M));
  const p = a.places.s1;
  assert.equal(p.deck, true);
  assert.equal(p.x, WORLD.groupLeft + M.peekX);
  assert.equal(p.y, WORLD.top0 + 10 + M.peekY * (3 - 1 - 1) - M.phTop * M.deckS);
  assert.equal(p.r, 1.6);
  assert.equal(p.s, M.deckS, "a deck frame is drawn small");
  assert.equal(p.d, (3 - 1 - 1) * 40);
  assert.deepEqual([p.fx, p.fy], [22, -10]);
});

test("groups with no saved position stack down the canvas; an empty group takes no room", () => {
  const a = plain(arrange(world([group("a", ids(2, "a")), group("e", []), group("b", ids(2, "b"), false)]), M));
  assert.equal(a.boxes.a.top, WORLD.top0);
  assert.equal(a.boxes.e.top, WORLD.top0 + GROUP_H + WORLD.groupGap, "the empty group is placed where the next would go");
  assert.equal(a.boxes.b.top, a.boxes.e.top, "and the next group takes the same place");
  assert.equal(a.boxes.a.x, WORLD.groupLeft);
});

test("a group with a saved position goes there and does not push the others down", () => {
  const a = plain(arrange(world([group("a", ids(2, "a")), group("b", ids(2, "b"))], [], { a: { x: 800, y: 900 } }), M));
  assert.deepEqual([a.boxes.a.x, a.boxes.a.top], [800, 900]);
  assert.equal(a.boxes.b.top, WORLD.top0, "b is first in the stack: a is somewhere else");
});

test("a group's box is as wide as its row, or as its deck", () => {
  const a = plain(arrange(world([group("o", ids(3)), group("c", ids(3, "c"), false), group("one", ["x"])]), M));
  assert.equal(a.boxes.o.w, 3 * M.colW + 2 * WORLD.gap + 60);
  assert.equal(a.boxes.o.h, GROUP_H);
  assert.equal(a.boxes.c.w, M.closedW);
  assert.equal(a.boxes.c.h, M.collH);
  assert.equal(a.boxes.one.w, 460, "a short row still has room to drop a frame into");
});

test("a loose frame with a saved position goes there", () => {
  const a = plain(arrange(world([], ["f"], { f: { x: 5, y: 7 } }), M));
  assert.deepEqual(plain(a.places.f), { x: 5, y: 7, r: 0, s: 1, d: 0, z: 5, fx: 0, fy: 0, deck: false, group: null, i: -1 });
});

test("loose frames with no saved position line up in rows of five below the groups, and nothing is written back", () => {
  const input = deepFreeze(world([group("g", ids(2))], ids(7, "f"), {}));
  const a = plain(arrange(input, M));
  const bottom = WORLD.top0 + GROUP_H;
  assert.equal(a.bottom, bottom);
  assert.deepEqual(plain(a.places.f0), { ...plain(a.places.f0), x: loosePlace(0, bottom, M).x, y: loosePlace(0, bottom, M).y });
  assert.deepEqual([a.places.f5.x, a.places.f5.y], [loosePlace(5, bottom, M).x, loosePlace(5, bottom, M).y]);
  assert.equal(a.places.f5.y > a.places.f0.y, true, "the sixth starts a new row");
  assert.deepEqual(input.pos, {}, "arranging is a question, not a save");
});

test("a loose frame's default place follows the groups when one grows", () => {
  const closed = plain(arrange(world([group("g", ids(2), false)], ["f"]), M));
  const open = plain(arrange(world([group("g", ids(2), true)], ["f"]), M));
  assert.equal(open.places.f.y - closed.places.f.y, GROUP_H - M.collH);
});

test("default places are handed out only to the frames that have none", () => {
  const a = plain(arrange(world([], ["a", "b", "c"], { b: { x: 1, y: 1 } }), M));
  assert.deepEqual([a.places.c.x, a.places.c.y], [loosePlace(1, a.bottom, M).x, loosePlace(1, a.bottom, M).y]);
});

/* ---------- easing ---------- */

test("the open curve starts at 0, ends at 1 and overshoots in between", () => {
  const e = FlowGeometry.bezier(0.22, 1.12, 0.36, 1);
  assert.equal(e(0), 0);
  assert.equal(e(1), 1);
  assert.ok(Math.max(...Array.from({ length: 101 }, (_, i) => e(i / 100))) > 1.002, "a slight overshoot, as the stylesheet had");
});

test("a curve with the same control points as CSS gives the same value CSS would", () => {
  const ease = FlowGeometry.bezier(0.25, 0.1, 0.25, 1); /* CSS "ease" */
  assert.ok(Math.abs(ease(0.5) - 0.8024) < 0.002);
});

/* ---------- motion ---------- */

const live = (screens, groups, now = 0, opts) => {
  const g = create(opts);
  g.setMetrics(M);
  g.retarget(world(groups, screens), now);
  return g;
};

test("a frame the geometry has never seen appears at its place without moving", () => {
  const g = live([], [group("g", ids(3))]);
  assert.deepEqual(xy(g.rect("s2", 0)), { x: g.place("s2").x, y: g.place("s2").y });
  assert.equal(g.settled(0), true);
});

test("closing a group slides each frame to its place in the deck, in turn, and they come to rest", () => {
  const g = live([], [group("g", ids(3))], 0);
  const from = xy(g.rect("s0", 0));
  g.retarget(world([group("g", ids(3), false)]), 1000);
  const to = g.place("s0");
  assert.deepEqual(xy(g.rect("s0", 1000)), from, "still at the start the moment it is told");
  const mid = g.rect("s0", 1000 + (3 - 1 - 0) * 40 + 300);
  assert.ok(mid.y !== from.y && mid.y !== to.y, "on its way");
  assert.deepEqual(xy(g.rect("s0", 1000 + 80 + 600)), { x: to.x, y: to.y }, "at rest once its wait and 0.6s are over");
  assert.equal(g.settled(1000 + 80 + 600 - 1), false, "s0 waits the longest when closing, so it is the last to arrive");
  assert.equal(g.settled(1000 + 80 + 600), true);
});

test("a frame that waits its turn has not moved yet; the next one starts after it", () => {
  const g = live([], [group("g", ids(3), false)], 0);
  g.retarget(world([group("g", ids(3), true)]), 500);
  const s2 = g.place("s2");
  const before = xy(g.rect("s2", 500));
  assert.deepEqual(xy(g.rect("s2", 500 + 2 * 60 - 1)), before, "s2 waits 120ms before it starts");
  assert.notDeepEqual(xy(g.rect("s2", 500 + 2 * 60 + 100)), before);
  assert.deepEqual(xy(g.rect("s2", 500 + 120 + 800)), { x: s2.x, y: s2.y });
});

test("the open curve overshoots its place on the way in, then settles on it", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  g.retarget(world([group("g", ids(2), true)]), 0);
  const to = g.place("s0");
  const ys = Array.from({ length: 81 }, (_, i) => g.rect("s0", i * 10).y);
  assert.ok(ys[0] < to.y, "it comes down from the deck");
  assert.ok(Math.max(...ys) > to.y, "it goes a little past");
  assert.equal(ys.at(-1), to.y);
});

test("the geometry says when everything is at rest: the longest wait plus the time to move", () => {
  const g = live([], [group("g", ids(5), false)], 0);
  g.retarget(world([group("g", ids(5), true)]), 100);
  assert.equal(g.restsAt(), 100 + 4 * 60 + 800);
  assert.equal(g.settled(g.restsAt() - 1), false);
  assert.equal(g.settled(g.restsAt()), true);
});

test("a long flow takes longer to settle than a short one, because the stagger is added up, not capped", () => {
  const rest = (n) => {
    const g = live([], [group("g", ids(n), false)], 0);
    g.retarget(world([group("g", ids(n), true)]), 0);
    return g.restsAt();
  };
  assert.ok(rest(14) > 1500, "14 frames outlast the old 1.5s follow window");
  assert.ok(rest(20) > rest(14));
});

test("new targets in the middle of a slide start from where the frame is, not from where it was", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  g.retarget(world([group("g", ids(2), true)]), 0);
  const here = xy(g.rect("s0", 300));
  g.retarget(world([group("g", ids(2), false)]), 300);
  assert.deepEqual(xy(g.rect("s0", 300)), here, "no jump");
  assert.deepEqual(xy(g.rect("s0", 300 + 40 * 1 + 600)), { x: g.place("s0").x, y: g.place("s0").y });
});

test("moving again while a frame is still waiting does not make it wait all over again", () => {
  const g = live([], [group("g", ids(4))], 0);
  const move = (now, x) => g.retarget(world([group("g", ids(4))], [], { g: { x, y: 400 } }), now);
  move(0, 300); /* s3 waits 180ms */
  const startsAt = (now) => g.rect("s3", now).x !== g.rect("s3", 0).x;
  move(100, 320);
  move(170, 340);
  assert.equal(g.rect("s3", 170).x, g.rect("s3", 0).x, "still its first position at 170");
  assert.equal(startsAt(185), true, "it left at ~180 as first promised, not 170 + 180");
});

test("a frame that is already sliding is not made to wait its turn again when its target moves", () => {
  const g = live([], [group("g", ids(4))], 0);
  const move = (now, x) => g.retarget(world([group("g", ids(4))], [], { g: { x, y: 400 } }), now);
  move(0, 300); /* s3 sets off at 180 */
  move(400, 320); /* a group being dragged: the target moves under a frame that is on its way */
  const here = xy(g.rect("s3", 400));
  assert.notDeepEqual(xy(g.rect("s3", 416)), here, "it is still moving a frame later, not standing 180ms again");
});

test("reduced motion: every frame is at its place the moment it is told", () => {
  const g = live([], [group("g", ids(4))], 0, { reduceMotion: true });
  g.retarget(world([group("g", ids(4), false)]), 50);
  assert.deepEqual(xy(g.rect("s3", 50)), { x: g.place("s3").x, y: g.place("s3").y });
  assert.equal(g.settled(50), true);
});

test("step reports the frames that moved, then nothing once they are at rest", () => {
  const g = live([], [group("g", ids(3), false)], 0);
  g.retarget(world([group("g", ids(3), true)]), 0);
  assert.deepEqual(plain(g.step(0)), [], "nothing has moved at the instant of the change");
  assert.ok(g.step(100).length > 0);
  g.step(g.restsAt());
  assert.deepEqual(plain(g.step(g.restsAt() + 16)), []);
  assert.equal(g.settled(g.restsAt() + 16), true);
});

test("a frame held under the pointer is where the pointer put it, and a new arrangement leaves it there", () => {
  const g = live([], [group("g", ids(3))], 0);
  g.hold("s1", 123, 456);
  assert.deepEqual(xy(g.rect("s1", 0)), { x: 123, y: 456 });
  g.retarget(world([group("g", ["s0", "s2"])], ["s1"]), 10);
  assert.deepEqual(xy(g.rect("s1", 10)), { x: 123, y: 456 });
  assert.deepEqual([g.place("s1").x, g.place("s1").y], [123, 456], "its place is the hold too");
});

test("letting go sends the frame from where it was dropped to its place", () => {
  const g = live([], [group("g", ids(3))], 0);
  g.hold("s1", 1000, 1000);
  g.release(["s1"]);
  g.retarget(world([group("g", ids(3))]), 200);
  assert.deepEqual(xy(g.rect("s1", 200)), { x: 1000, y: 1000 });
  const to = g.place("s1");
  assert.deepEqual(xy(g.rect("s1", 200 + 60 + 800)), { x: to.x, y: to.y });
});

test("a frame is a deck frame unless it is being held", () => {
  const g = live([], [group("g", ids(3), false)], 0);
  assert.equal(g.isDeck("s1"), true);
  g.hold("s1", 0, 0);
  assert.equal(g.isDeck("s1"), false);
  g.release(["s1"]);
  assert.equal(g.isDeck("s1"), true);
});

test("a frame shrinks into the deck and grows back out as it slides: its size is part of where it is", () => {
  const g = live([], [group("g", ids(2))], 0);
  assert.equal(g.rect("s0", 0).s, 1);
  g.retarget(world([group("g", ids(2), false)]), 0);
  const mid = g.rect("s1", 40 + 300);
  assert.ok(mid.s < 1 && mid.s > M.deckS, "part way down");
  assert.equal(g.rect("s1", 40 + 600).s, M.deckS);
});

test("the screen area is the size the frame is drawn at, so a connector can meet a frame that is still growing", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  g.retarget(world([group("g", ids(2), true)]), 0);
  const small = g.screenRect("s0", 0);
  assert.ok(Math.abs(small.w - M.colW * M.deckS) < 1e-9 && Math.abs(small.h - M.phH * M.deckS) < 1e-9);
  assert.deepEqual(plain(g.screenRect("s0", 10000)), plain({ ...g.screenRect("s0"), w: M.colW, h: M.phH }));
});

/* ---------- queries ---------- */

test("which frame is under a point: its screen, with a margin, looked up where the frame is now", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  g.retarget(world([group("g", ids(2), true)]), 0);
  const to = g.place("s1");
  const cx = to.x + M.colW / 2,
    cy = to.y + M.phTop + M.phH / 2;
  assert.equal(g.frameAt({ x: cx, y: cy }, 800 + 60), "s1", "at rest, s1 is under its own centre");
  assert.equal(g.frameAt({ x: cx, y: cy }, 0), null, "at the start of the slide the point is over nothing");
  assert.equal(g.frameAt({ x: to.x + M.colW + 15, y: cy }, 1000, { margin: 20 }), "s1");
  assert.equal(g.frameAt({ x: to.x + M.colW + 25, y: cy }, 1000, { margin: 20 }), null);
});

test("a frame in a deck is not under any point, and one being dragged out of it is", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  const p = g.place("s0");
  const pt = { x: p.x + 20, y: p.y + M.phTop + 20 };
  assert.equal(g.frameAt(pt, 0), null);
  g.hold("s0", p.x, p.y);
  assert.equal(g.frameAt(pt, 0), "s0");
});

test("a frame can be left out of the question (a connector does not land on its own start)", () => {
  const g = live([], [group("g", ids(2))], 0);
  const p = g.place("s0");
  const pt = { x: p.x + 10, y: p.y + M.phTop + 10 };
  assert.equal(g.frameAt(pt, 0), "s0");
  assert.equal(g.frameAt(pt, 0, { skip: "s0" }), null);
});

test("the screen's area is the frame's column below its device bezel; the frame's box adds the caption", () => {
  const g = live([], [group("g", ids(2))], 0);
  const p = g.place("s1");
  assert.deepEqual(plain(g.screenRect("s1", 0)), { x: p.x, y: p.y + M.phTop, w: M.colW, h: M.phH });
  assert.deepEqual(plain(g.frameBox("s1", 0)), { x: p.x, y: p.y, w: M.colW, h: M.phTop + M.phH + M.cap });
});

test("without a time, rect questions are about where the frame is going", () => {
  const g = live([], [group("g", ids(2), false)], 0);
  g.retarget(world([group("g", ids(2), true)]), 0);
  assert.deepEqual(plain(g.screenRect("s1")), { x: g.place("s1").x, y: g.place("s1").y + M.phTop, w: M.colW, h: M.phH });
});

test("the canvas's extent covers the groups and the loose frames, and the camera gets room around it", () => {
  const empty = live([], [], 0);
  assert.deepEqual(plain(empty.bounds()), { x: 0, y: 0, w: 900, h: 600 });
  const g = live(["f"], [group("g", ids(2))], 0);
  const b = g.bounds();
  const box = g.box("g");
  assert.ok(b.x <= box.x - 20 - 40 && b.y <= box.top - 20 - 60);
  const f = g.frameBox("f");
  assert.ok(b.y + b.h >= f.y + f.h + 20 + 60);
});

test("a group's box can be asked for by id, and a missing one is undefined", () => {
  const g = live([], [group("g", ids(2))], 0);
  assert.equal(g.box("g").x, WORLD.groupLeft);
  assert.equal(g.box("nope"), undefined);
});

/* ---------- the connector case that motivated this ---------- */

test("connector ends land on the frames once a long flow has finished sliding open, not at the 1.5s mark", () => {
  const N = 14;
  const g = live([], [group("g", ids(N), false)], 0);
  g.retarget(world([group("g", ids(N), true)]), 0);
  const routeAt = (now) => ids(N - 1).map((id, i) => FlowRouting.route(g.screenRect(id, now), g.screenRect(`s${i + 1}`, now), M.edge));
  const wanted = routeAt(undefined); /* where the connectors belong: between the frames' places */
  const ends = (rs) => rs.map((r) => [r.pts[0].x, r.pts[0].y, r.pts.at(-1).x, r.pts.at(-1).y]);
  assert.notDeepEqual(ends(routeAt(1500)), ends(wanted), "at 1.5s the last frames are still sliding");
  assert.ok(g.restsAt() > 1500);
  assert.deepEqual(ends(routeAt(g.restsAt())), ends(wanted), "once the geometry says it is at rest, every end is on its frame");
});

test("the page no longer polls the document to find where a frame is, or waits out a timer for it to arrive", () => {
  const page = html.replace(/\/\*[\s\S]*?\*\//g, "");
  for (const gone of ["followConns", "liveRect", "setTimeout(drawConns"])
    assert.ok(!page.includes(gone), `${gone} is still in the page`);
  assert.ok(!/querySelector\("\.pwrap"\)\.getBoundingClientRect/.test(page), "a frame's rect is read from the page");
});
