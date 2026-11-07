/* Connector routing: where a connector leaves one frame and lands on another, for rects handed in.
   No page, no animation: the rects are fixed numbers.
   Run:  node --test skills/create-flow-canvas/tests/routing.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowRouting } from "./modules.mjs";

const { ortho, shape, route } = FlowRouting;
/* the module runs in its own realm, so plain data is compared by value */
const plain = (x) => JSON.parse(JSON.stringify(x));
const sidePt = (...a) => plain(FlowRouting.sidePt(...a));
const pickSides = (...a) => plain(FlowRouting.pickSides(...a));
const EDGE = 100; /* how far down a screen a side port sits */
const R = (x, y, w = 270, h = 585) => ({ x, y, w, h });

test("a side port sits on the screen's edge, EDGE down, and never lower than the screen allows", () => {
  const r = R(10, 20);
  assert.deepEqual(sidePt(r, "R", EDGE), { x: 280, y: 120, nx: 1, ny: 0 });
  assert.deepEqual(sidePt(r, "L", EDGE), { x: 10, y: 120, nx: -1, ny: 0 });
  assert.deepEqual(sidePt(r, "B", EDGE), { x: 145, y: 605, nx: 0, ny: 1 });
  assert.deepEqual(sidePt(r, "T", EDGE), { x: 145, y: 20, nx: 0, ny: -1 });
  assert.equal(sidePt(R(0, 0, 100, 50), "R", EDGE).y, 44, "a short screen keeps the port 6px inside");
});

test("a frame to the right is left by its right side and entered by the left", () => {
  assert.deepEqual(pickSides(R(0, 0), R(374, 0)), ["R", "L"]);
  assert.deepEqual(pickSides(R(374, 0), R(0, 0)), ["L", "R"]);
});

test("frames that overlap in x connect top to bottom, whichever is lower", () => {
  assert.deepEqual(pickSides(R(0, 0), R(0, 800)), ["B", "T"]);
  assert.deepEqual(pickSides(R(0, 800), R(0, 0)), ["T", "B"]);
});

test("level neighbours get one straight, clean line from port to port", () => {
  const a = R(0, 0),
    b = R(374, 0);
  const r = route(a, b, EDGE);
  assert.deepEqual(plain(r.p0), sidePt(a, "R", EDGE));
  assert.deepEqual([r.pts[0].x, r.pts[0].y], [r.p0.x, r.p0.y]);
  assert.deepEqual([r.pts.at(-1).x, r.pts.at(-1).y], [374, EDGE]);
  assert.equal(r.pts.length, 2, "no jog when both ports are at the same height");
});

test("a route lands exactly on the screen's side port at both ends, wherever the frames are", () => {
  const cases = [
    [R(0, 0), R(374, 0)],
    [R(0, 0), R(374, 700)],
    [R(374, 700), R(0, 0)],
    [R(0, 0), R(60, 900)],
    [R(0, 900), R(60, 0)],
  ];
  for (const [a, b] of cases) {
    const [sa, sb] = pickSides(a, b);
    const r = route(a, b, EDGE);
    const p0 = sidePt(a, sa, EDGE),
      p3 = sidePt(b, sb, EDGE);
    assert.deepEqual([r.pts[0].x, r.pts[0].y], [p0.x, p0.y]);
    assert.deepEqual([r.pts.at(-1).x, r.pts.at(-1).y], [p3.x, p3.y]);
  }
});

test("a route has no repeated points and no point that sits on a straight run", () => {
  const r = route(R(0, 0), R(374, 300), EDGE);
  for (let i = 1; i < r.pts.length; i++)
    assert.ok(Math.hypot(r.pts[i].x - r.pts[i - 1].x, r.pts[i].y - r.pts[i - 1].y) > 0.5, "no zero-length segment");
  for (let i = 1; i < r.pts.length - 1; i++) {
    const [a, q, n] = [r.pts[i - 1], r.pts[i], r.pts[i + 1]];
    assert.ok(Math.abs((q.x - a.x) * (n.y - q.y) - (q.y - a.y) * (n.x - q.x)) >= 0.5, "every point is a corner");
  }
});

test("a free end (dragging, no target) is joined to the port with right-angle runs only", () => {
  const p0 = sidePt(R(0, 0), "R", EDGE);
  const pts = ortho(p0, { x: 500, y: 400, nx: 0, ny: 0 });
  for (let i = 1; i < pts.length; i++)
    assert.ok(pts[i].x === pts[i - 1].x || pts[i].y === pts[i - 1].y, "each run is horizontal or vertical");
  assert.deepEqual([pts.at(-1).x, pts.at(-1).y], [500, 400]);
});

test("the drawn shape starts at the port, ends its arrowhead on the target, and has a midpoint on the line", () => {
  const a = R(0, 0),
    b = R(374, 300);
  const r = route(a, b, EDGE);
  const s = shape(r);
  assert.ok(s.d.startsWith(`M${r.p0.x} ${r.p0.y}`));
  const tip = s.arr.split(" ")[0].split(",").map(Number);
  const end = r.pts.at(-1);
  assert.deepEqual(tip, [end.x, end.y]);
  assert.ok(Number.isFinite(s.mid.x) && Number.isFinite(s.mid.y));
});
