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

/* ---------- the leader of a scanner finding: from the frame's bottom edge to its card ---------- */
const LF = { w: 270, screenBottom: 625 }; /* the frame's anatomy (FlowGeometry.frame): the dock sits w - 62 = 208 across */
const leader = (...a) => plain(FlowRouting.leader(LF, ...a));

test("an unmoved card whose top is past the gutter run is reached from above: down the gutter to its top", () => {
  /* left 300 is right of the run (colW + 22 = 292), so the line lands on the card's top edge at the run */
  const l = leader(300, 700, 240, 100, false);
  assert.deepEqual([l.x0, l.y0], [208, 625]);
  assert.deepEqual(l.end, [292, 700]);
  assert.ok(l.d.startsWith("M208 625V635Q208 649 222 649H278Q292 649 292 663"), "slips between frame and caption, runs down the gutter");
  assert.ok(l.d.endsWith("V700"));
});

test("an unmoved card that reaches over the gutter run is entered from its right edge, half a line down", () => {
  const l = leader(0, 700, 240, 100, false);
  assert.deepEqual(l.end, [240, 726], "the card's right edge, 26 below its top");
  assert.ok(l.d.endsWith("V712Q292 726 278 726H240"));
});

test("a moved card below the frame is docked at its top edge, the dock clamped to the card", () => {
  const l = leader(0, 700, 240, 100, true);
  assert.deepEqual([l.x0, l.y0], [208, 625]);
  assert.deepEqual(l.end, [208, 700]);
  assert.deepEqual(leader(0, 700, 120, 100, true).end, [102, 700], "a narrow card: the dock is kept 18px inside its right edge");
  assert.deepEqual(leader(300, 700, 120, 100, true).end, [318, 700], "and 18px inside its left edge");
});

test("a moved card beside the frame is docked at the middle of its near side", () => {
  assert.deepEqual(leader(400, 100, 240, 100, true).end, [400, 150], "right of the frame: its left edge");
  assert.deepEqual(leader(-300, 100, 240, 100, true).end, [-60, 150], "left of the frame: its right edge");
});

test("a moved card over the frame is docked at its bottom edge", () => {
  assert.deepEqual(leader(0, 100, 240, 100, true).end, [208, 200]);
});

test("a moved card's line is the connector's own right-angle path, rounded", () => {
  const l = leader(0, 700, 240, 100, true);
  const pts = FlowRouting.ortho({ x: 208, y: 625, nx: 0, ny: 1 }, { x: 208, y: 700, nx: 0, ny: -1 });
  assert.equal(l.d, FlowRouting.rounded(pts, 12));
});

/* ---------- around the frames ---------- */
const { planner, placeLabels } = FlowRouting;
const box = (id, x, y, w = 270, h = 755) => ({ id, x, y, w, h });
const screenOf = (b) => ({ x: b.x, y: b.y + 28, w: b.w, h: 585 });
/* one row of n frames, 104 apart, then the scene the planner is handed */
const row = (n, y = 0, from = 0) => Array.from({ length: n }, (_, i) => box(`f${from + i}`, i * 374, y));
const scene = (hard, soft = []) => ({ hard, soft, edge: EDGE });
const ask = (id, a, b) => ({ id, from: a.id, to: b.id, a: screenOf(a), b: screenOf(b) });
const interior = (p, r) => p.x > r.x && p.x < r.x + r.w && p.y > r.y && p.y < r.y + r.h;
/* does any run of the line pass through this rect? sampled every 2px */
const crosses = (pts, r) => {
  for (let i = 1; i < pts.length; i++) {
    const [a, b] = [pts[i - 1], pts[i]], n = Math.ceil(Math.hypot(b.x - a.x, b.y - a.y) / 2);
    for (let k = 0; k <= n; k++) if (interior({ x: a.x + ((b.x - a.x) * k) / n, y: a.y + ((b.y - a.y) * k) / n }, r)) return true;
  }
  return false;
};
const orthogonal = (pts) => pts.slice(1).every((q, i) => Math.abs(q.x - pts[i].x) < 0.01 || Math.abs(q.y - pts[i].y) < 0.01);

test("neighbours in a row keep the plain straight line", () => {
  const h = row(2), p = planner().plan([ask("c", h[0], h[1])], scene(h)).get("c");
  assert.equal(p.pts.length, 2);
  assert.equal(p.crossed, false);
});

test("a connector that skips a frame goes round it, on right angles, from a side port to a side port", () => {
  const h = row(3), p = planner().plan([ask("c", h[0], h[2])], scene(h)).get("c");
  assert.equal(p.crossed, false);
  assert.ok(!crosses(p.pts, h[1]), "does not cross the frame between");
  assert.ok(orthogonal(p.pts));
  assert.deepEqual([p.pts[0].x, p.pts.at(-1).x], [270, 748], "right side out, left side in");
});

test("frames stacked in rows connect by their sides, so the line stays off captions and titles", () => {
  const h = [box("a", 0, 0), box("b", 0, 1000)], p = planner().plan([ask("c", h[0], h[1])], scene(h)).get("c");
  assert.equal(p.crossed, false);
  assert.ok(!crosses(p.pts, h[0]) && !crosses(p.pts, h[1]));
});

test("a route across rows threads the gutters and misses every frame", () => {
  const h = [...row(5), ...row(5, 1000, 5)], p = planner().plan([ask("c", h[1], h[8])], scene(h)).get("c");
  assert.equal(p.crossed, false);
  h.forEach((r) => assert.ok(!crosses(p.pts, r), r.id));
});

test("a soft area is avoided when there is another way", () => {
  const h = row(3), over = { x: 0, y: -60, w: 1100, h: 30 };
  const p = planner().plan([ask("c", h[0], h[2])], scene(h, [over])).get("c");
  assert.ok(!crosses(p.pts, over));
});

test("a frame walled in cannot be avoided: the line takes the fewest frames and says so", () => {
  const target = box("t", 2000, 0), wall = box("w", 1800, -5000, 500, 11000);
  /* the target is inside the wall: nothing reaches it clear */
  const p = planner().plan([ask("c", box("a", 0, 0), target)], scene([box("a", 0, 0), wall, target])).get("c");
  assert.equal(p.crossed, true);
  assert.ok(orthogonal(p.pts));
});

test("lines sharing a channel run side by side, not on top of each other", () => {
  const h = row(4);
  const m = planner().plan([ask("x", h[0], h[2]), ask("y", h[1], h[3])], scene(h));
  const run = (p) => p.pts.slice(1, -1).find((q, i, a) => i < a.length - 1 && Math.abs(a[i + 1].y - q.y) < 0.01 && Math.abs(a[i + 1].x - q.x) > 300);
  const [ax, ay] = [run(m.get("x")), run(m.get("y"))];
  assert.ok(ax && ay, "both take a long run");
  assert.ok(Math.abs(ax.y - ay.y) >= 6, `apart: ${ax.y} ${ay.y}`);
  h.forEach((r) => { assert.ok(!crosses(m.get("x").pts, r) || r.id === "f0"); });
});

test("planning again with nothing changed hands back the same answer without searching", () => {
  const h = row(3), plan = planner(), asks = [ask("c", h[0], h[2])];
  const first = plan.plan(asks, scene(h)).get("c");
  assert.equal(plan.searches(), 1);
  assert.deepEqual(plain(plan.plan(asks, scene(h)).get("c").pts), plain(first.pts));
  assert.equal(plan.searches(), 1);
});

test("while things move the search has a budget: past it a line stays drawn, marked provisional, and the settled pass fixes it", () => {
  const h = row(3), plan = planner(), asks = [ask("c", h[0], h[2])];
  const live = plan.plan(asks, scene(h), { live: true, budget: 0 }).get("c");
  assert.equal(live.provisional, true);
  const settled = plan.plan(asks, scene(h)).get("c");
  assert.equal(settled.provisional, false);
  assert.ok(!crosses(settled.pts, h[1]));
});

test("while frames move, a route still clear of them is kept instead of searched again", () => {
  const h = row(3), plan = planner(), asks = [ask("c", h[0], h[2])];
  plan.plan(asks, scene(h));
  const before = plan.searches();
  const shifted = [...h.slice(0, 2).map((r) => r), { ...h[2] }, box("far", 0, 9000)];
  plan.plan(asks, scene(shifted), { live: true });
  assert.equal(plan.searches(), before);
});

test("sixty frames in a row plan fast", () => {
  const h = row(60), asks = h.slice(1).map((b, i) => ask("c" + i, h[i], b));
  const t = performance.now();
  planner().plan(asks, scene(h));
  assert.ok(performance.now() - t < 250);
  const skips = h.slice(2).map((b, i) => ask("s" + i, h[i], b));
  const t2 = performance.now();
  planner().plan(skips, scene(h));
  const ms = performance.now() - t2;
  assert.ok(ms < 1500, `58 full searches took ${ms}ms`);
});

/* ---------- labels ---------- */
const chip = (id, pts, w = 60, h = 26) => ({ id, pts, w, h });
const overlap = (a, b) => a.x - a.w / 2 < b.x + b.w / 2 && b.x - b.w / 2 < a.x + a.w / 2 && a.y - a.h / 2 < b.y + b.h / 2 && b.y - b.h / 2 < a.y + a.h / 2;
const LINE = [{ x: 0, y: 0 }, { x: 400, y: 0 }];

test("a label sits on its line, in the middle of the longest clear run", () => {
  const p = plain(placeLabels([chip("a", LINE)], { hard: [], soft: [] }).get("a"));
  assert.deepEqual([p.x, p.y, p.fits], [200, 0, true]);
});

test("labels on the same run do not stack", () => {
  const m = placeLabels([chip("a", LINE), chip("b", LINE), chip("c", LINE)], { hard: [], soft: [] });
  const all = ["a", "b", "c"].map((k) => ({ ...plain(m.get(k)), h: 26 }));
  assert.ok(all.every((p) => p.fits));
  assert.ok(!overlap(all[0], all[1]) && !overlap(all[1], all[2]) && !overlap(all[0], all[2]));
});

test("a label never sits over a frame", () => {
  const frame = { x: 150, y: -300, w: 100, h: 600 };
  const p = placeLabels([chip("a", LINE)], { hard: [frame], soft: [] }).get("a");
  assert.ok(p.fits);
  assert.ok(!overlap({ ...p, h: 26 }, { x: 200, y: 0, w: 100, h: 600 }));
});

test("a long label is cut to the run it has", () => {
  const short = [{ x: 0, y: 0 }, { x: 104, y: 0 }];
  const p = placeLabels([chip("a", short, 180)], { hard: [], soft: [] }).get("a");
  assert.equal(p.fits, true);
  assert.ok(p.w <= 104 - 8);
});

test("a label with nowhere to go is tucked, off the frames, and says so", () => {
  const frame = { x: -100, y: -100, w: 700, h: 200 };
  const p = placeLabels([chip("a", LINE)], { hard: [frame], soft: [] }).get("a");
  assert.equal(p.fits, false);
});

test("two lines in one short gutter: the second label stands just above or below, not on the first", () => {
  const short = [{ x: 0, y: 0 }, { x: 104, y: 0 }];
  const m = placeLabels([chip("a", short, 80), chip("b", short, 80)], { hard: [], soft: [] });
  assert.ok(m.get("a").fits && m.get("b").fits);
  assert.ok(!overlap({ ...plain(m.get("a")), h: 26 }, { ...plain(m.get("b")), h: 26 }));
});

test("live planning has a budget by itself, so a slide never runs an uncapped search", () => {
  const h = row(60), plan = planner();
  /* long lines across the whole row: far more searching than one frame may do */
  const asks = h.map((a, i) => ask("s" + i, a, h[(i + 30) % 60]));
  const m = plan.plan(asks, scene(h), { live: true });
  assert.ok([...m.values()].some((r) => r.provisional));
  assert.ok(![...plan.plan(asks, scene(h)).values()].some((r) => r.provisional), "the settled pass finishes them");
});
