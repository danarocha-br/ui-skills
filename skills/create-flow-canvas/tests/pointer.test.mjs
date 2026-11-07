/* Pointer arbiter tests. FlowPointer decides what a press, a move and a release mean: pan, drag a frame or a group,
   draw a marquee, draw a connector, drag a note, or nothing. It is driven here with plain events and a recording
   stand-in for the page (the host). No DOM.
   Run:  node --test skills/create-flow-canvas/tests/pointer.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowPointer } from "./modules.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));

/* a page that records what it was asked, and answers the three questions the arbiter asks of it */
function setup({ refuseDrag = false } = {}) {
  const log = [];
  const live = { gesture: false, annotation: false };
  let cam = { x: 100, y: 200 };
  const rec = (name, fn = () => {}) => (...a) => (log.push([name, ...plain(a)]), fn(...a));
  const host = {
    stopPlay: rec("stopPlay"),
    hand: rec("hand"),
    camera: () => cam,
    moveCamera: rec("moveCamera", (x, y) => (cam = { x, y })),
    panStarted: rec("panStarted"),
    panEnded: rec("panEnded"),
    gestureActive: () => live.gesture,
    beginDrag: rec("beginDrag", () => ((live.gesture = !refuseDrag), !refuseDrag)),
    moveDrag: rec("moveDrag"),
    endDrag: rec("endDrag", () => (live.gesture = false)),
    cancelDrag: rec("cancelDrag", () => (live.gesture = false)),
    annotationDragging: () => live.annotation,
    moveAnnotation: rec("moveAnnotation"),
    endAnnotation: rec("endAnnotation", () => (live.annotation = false)),
    cancelAnnotation: rec("cancelAnnotation", () => (live.annotation = false)),
    startMarquee: rec("startMarquee"),
    moveMarquee: rec("moveMarquee"),
    endMarquee: rec("endMarquee"),
    cancelMarquee: rec("cancelMarquee"),
    startConnect: rec("startConnect"),
    moveConnect: rec("moveConnect"),
    endConnect: rec("endConnect"),
  };
  const pointer = FlowPointer.create(host);
  const names = () => log.map((l) => l[0]);
  const take = () => log.splice(0).map((l) => l[0]);
  return { pointer, log, live, names, take, cam: () => cam };
}
const down = (pointer, hit, over = {}) => pointer.down({ button: 0, x: 10, y: 10, shift: false, hit, ...over });
const FRAME = { kind: "frame", id: "s2" };
const CANVAS = { kind: "canvas" };

/* ---------- which presses count ---------- */

test("only the primary and the middle button do anything; others are left alone", () => {
  const t = setup();
  assert.deepEqual(plain(down(t.pointer, FRAME, { button: 2 })), { prevent: false });
  assert.deepEqual(t.names(), []);
});

test("a press on something that is not the canvas (a header, a button, a text field) starts nothing", () => {
  const t = setup();
  assert.deepEqual(plain(down(t.pointer, { kind: "chrome" })), { prevent: false });
  t.pointer.move({ x: 300, y: 300 });
  t.pointer.up();
  assert.deepEqual(t.names(), []);
});

test("a press on an annotation is its own: the arbiter starts nothing, and says whether to prevent the default", () => {
  const t = setup();
  assert.deepEqual(plain(down(t.pointer, { kind: "annotation", prevent: true })), { prevent: true });
  assert.deepEqual(plain(down(t.pointer, { kind: "annotation", prevent: false })), { prevent: false });
  assert.deepEqual(t.names(), []);
});

test("every press that starts something stops the flow that is playing", () => {
  for (const hit of [FRAME, CANVAS, { kind: "deck", group: "g1" }, { kind: "grip", group: "g1" }, { kind: "port", id: "s1", side: "R" }]) {
    const t = setup();
    down(t.pointer, hit);
    assert.equal(t.names()[0], "stopPlay", hit.kind);
  }
});

/* ---------- a frame or a group is dragged ---------- */

test("a press on a frame does not drag until the pointer is more than 5px away", () => {
  const t = setup();
  down(t.pointer, FRAME);
  t.take();
  t.pointer.move({ x: 13, y: 14 }); /* exactly 5 away */
  assert.deepEqual(t.names(), []);
  t.pointer.move({ x: 16, y: 14 }); /* 6.7 */
  assert.deepEqual(t.names(), ["beginDrag", "moveDrag"], "the move that crosses the line also moves the drag");
  assert.deepEqual(t.log[0], ["beginDrag", { kind: "frame", id: "s2" }, { x: 10, y: 10 }], "it begins where the press was");
  assert.deepEqual(t.log[1], ["moveDrag", { x: 16, y: 14 }]);
});

test("once dragging, every move goes to the drag, and the release drops it", () => {
  const t = setup();
  down(t.pointer, FRAME);
  t.pointer.move({ x: 40, y: 10 });
  t.take();
  t.pointer.move({ x: 50, y: 10 });
  t.pointer.move({ x: 60, y: 10 });
  assert.deepEqual(t.take(), ["moveDrag", "moveDrag"]);
  t.pointer.up();
  assert.deepEqual(t.take(), ["endDrag"]);
  t.pointer.move({ x: 90, y: 10 });
  assert.deepEqual(t.names(), [], "nothing follows a release");
});

test("a press released without enough movement drags nothing, and leaves the click alone", () => {
  const t = setup();
  down(t.pointer, FRAME);
  t.pointer.move({ x: 12, y: 12 });
  t.pointer.up();
  assert.ok(!t.names().includes("beginDrag"));
  assert.equal(t.pointer.consumeMoved(), false);
});

test("a deck, or a group's grip, drags the group", () => {
  for (const hit of [{ kind: "deck", group: "g1" }, { kind: "grip", group: "g1" }]) {
    const t = setup();
    down(t.pointer, hit);
    t.pointer.move({ x: 60, y: 10 });
    assert.deepEqual(t.log.find((l) => l[0] === "beginDrag").slice(1, 2), [{ kind: "group", group: "g1" }], hit.kind);
  }
});

test("a grip asks for the default to be prevented (no text selection); a plain frame press does not", () => {
  assert.deepEqual(plain(down(setup().pointer, { kind: "grip", group: "g1" })), { prevent: true });
  assert.deepEqual(plain(down(setup().pointer, FRAME)), { prevent: false });
});

test("a drag the page refuses ends the press: nothing more is asked of it", () => {
  const t = setup({ refuseDrag: true });
  down(t.pointer, { kind: "deck", group: "gone" });
  t.pointer.move({ x: 60, y: 10 });
  t.take();
  t.pointer.move({ x: 80, y: 10 });
  assert.deepEqual(t.names(), []);
  assert.equal(t.pointer.consumeMoved(), true, "the pointer did travel, so the click that follows is not a click");
});

/* ---------- marquee and pan ---------- */

test("a press on the canvas draws a marquee; shift adds to what is selected", () => {
  const t = setup();
  down(t.pointer, CANVAS, { shift: true, x: 5, y: 6 });
  assert.deepEqual(t.log.find((l) => l[0] === "startMarquee"), ["startMarquee", { x: 5, y: 6 }, true]);
  const u = setup();
  down(u.pointer, CANVAS);
  assert.deepEqual(u.log.find((l) => l[0] === "startMarquee"), ["startMarquee", { x: 10, y: 10 }, false]);
});

test("the marquee follows every move, from the first (it has no dead zone), and a release ends it", () => {
  const t = setup();
  down(t.pointer, CANVAS);
  t.take();
  t.pointer.move({ x: 11, y: 10 });
  t.pointer.move({ x: 30, y: 40 });
  assert.deepEqual(t.take(), ["moveMarquee", "moveMarquee"]);
  assert.equal(t.pointer.consumeMoved(), true);
  t.pointer.up();
  assert.deepEqual(t.take(), ["endMarquee"]);
});

test("the middle button pans, in any tool, and asks for the default to be prevented", () => {
  const t = setup();
  assert.deepEqual(plain(down(t.pointer, null, { button: 1, x: 50, y: 50 })), { prevent: true });
  assert.ok(t.names().includes("stopPlay"));
  t.take();
  t.pointer.move({ x: 52, y: 51 }); /* under 4px */
  assert.deepEqual(t.names(), []);
  t.pointer.move({ x: 70, y: 40 });
  assert.deepEqual(t.take(), ["panStarted", "moveCamera"]);
  assert.deepEqual(t.cam(), { x: 120, y: 190 }, "the camera moves by what the pointer moved from the press");
  t.pointer.move({ x: 80, y: 40 });
  assert.deepEqual(t.take(), ["moveCamera"]);
  assert.deepEqual(t.cam(), { x: 130, y: 190 });
  t.pointer.up();
  assert.deepEqual(t.take(), ["panEnded"]);
});

test("with the hand tool, a press on the canvas pans instead of drawing a marquee", () => {
  const t = setup();
  t.pointer.setHand(true);
  assert.deepEqual(t.take(), ["hand"]);
  down(t.pointer, CANVAS, { x: 0, y: 0 });
  assert.ok(!t.names().includes("startMarquee"));
  t.pointer.move({ x: 30, y: 0 });
  assert.deepEqual(t.cam(), { x: 130, y: 200 });
});

test("a press on a frame is still a frame drag with the hand tool: the hand pans only the canvas", () => {
  const t = setup();
  t.pointer.setHand(true);
  down(t.pointer, FRAME);
  t.pointer.move({ x: 60, y: 10 });
  assert.ok(t.names().includes("beginDrag"));
});

test("the Space key is the hand tool while it is held; the V and H keys' hand stays until put away", () => {
  const t = setup();
  t.pointer.space(true);
  assert.deepEqual(t.log.at(-1), ["hand", true]);
  down(t.pointer, CANVAS);
  assert.ok(!t.names().includes("startMarquee"), "space-drag pans");
  t.pointer.up();
  t.pointer.space(false);
  assert.deepEqual(t.log.at(-1), ["hand", false]);
  t.pointer.setHand(true);
  t.pointer.space(true);
  t.pointer.space(false);
  assert.deepEqual(t.log.at(-1), ["hand", true], "the tool is still the hand once Space is let go");
  t.pointer.setHand(false);
  assert.deepEqual(t.log.at(-1), ["hand", false]);
});

test("losing the window's focus lets go of Space", () => {
  const t = setup();
  t.pointer.space(true);
  t.pointer.blur();
  assert.deepEqual(t.log.at(-1), ["hand", false]);
  down(t.pointer, CANVAS);
  assert.ok(t.names().includes("startMarquee"));
});

test("Space held again, while already held, does not repeat itself", () => {
  const t = setup();
  t.pointer.space(true);
  const n = t.log.length;
  t.pointer.space(true);
  assert.equal(t.log.length, n);
});

/* ---------- a connector drawn from an edge dot ---------- */

test("a press on an edge dot starts a connector and prevents the default", () => {
  const t = setup();
  const port = { kind: "port", id: "s1", side: "R" };
  assert.deepEqual(plain(down(t.pointer, port)), { prevent: true });
  assert.deepEqual(t.log.find((l) => l[0] === "startConnect"), ["startConnect", port]);
});

test("while a connector is drawn, moves belong to it alone, and its release is not a drop of anything else", () => {
  const t = setup();
  down(t.pointer, { kind: "port", id: "s1", side: "R" });
  t.take();
  t.pointer.move({ x: 200, y: 200 });
  t.pointer.move({ x: 210, y: 200 });
  assert.deepEqual(t.take(), ["moveConnect", "moveConnect"]);
  assert.equal(t.pointer.consumeMoved(), true);
  t.pointer.up();
  assert.deepEqual(t.take(), ["endConnect"], "no annotation, drag or marquee is ended by it");
  assert.deepEqual(t.log, [], "");
});

test("a connector's release says it was not cancelled; Escape says it was", () => {
  const t = setup();
  down(t.pointer, { kind: "port", id: "s1", side: "R" });
  t.pointer.up();
  assert.deepEqual(t.log.at(-1), ["endConnect", false]);
  down(t.pointer, { kind: "port", id: "s1", side: "R" });
  assert.equal(t.pointer.cancelConnect(), true);
  assert.deepEqual(t.log.at(-1), ["endConnect", true]);
  assert.equal(t.pointer.cancelConnect(), false, "nothing left to cancel");
});

/* ---------- a note or a finding card dragged (the annotations' own drag) ---------- */

test("while an annotation is dragged, moves belong to it, ahead of a press or a marquee", () => {
  const t = setup();
  t.live.annotation = true;
  t.pointer.move({ x: 20, y: 30 });
  assert.deepEqual(t.log, [["moveAnnotation", { x: 20, y: 30 }]]);
  t.pointer.up();
  assert.ok(t.names().includes("endAnnotation"));
});

/* ---------- cancelling ---------- */

test("Escape during a drag (cancelDrag): the drag and an annotation drag are called off, and it says so", () => {
  const t = setup();
  down(t.pointer, FRAME);
  t.pointer.move({ x: 60, y: 10 });
  t.take();
  assert.equal(t.pointer.cancelDrag(), true);
  assert.deepEqual(t.take(), ["cancelAnnotation", "cancelDrag"]);
  t.pointer.move({ x: 90, y: 10 });
  assert.deepEqual(t.names(), [], "what was left of the press does nothing");
});

test("cancelDrag with nothing to cancel says so and asks for nothing", () => {
  const t = setup();
  assert.equal(t.pointer.cancelDrag(), false);
  assert.deepEqual(t.names(), []);
});

test("cancelDrag also calls off an annotation drag", () => {
  const t = setup();
  t.live.annotation = true;
  assert.equal(t.pointer.cancelDrag(), true);
  assert.ok(t.names().includes("cancelAnnotation"));
});

test("a pointercancel calls off whatever is live: a drag, an annotation drag, a connector, a marquee or a pan", () => {
  const d = setup();
  down(d.pointer, FRAME);
  d.pointer.move({ x: 60, y: 10 });
  d.live.annotation = true;
  d.take();
  d.pointer.cancel();
  assert.deepEqual(d.take(), ["cancelAnnotation", "cancelDrag"]);
  const t = setup();
  down(t.pointer, CANVAS);
  t.pointer.move({ x: 30, y: 30 });
  t.take();
  t.pointer.cancel();
  assert.deepEqual(t.take(), ["cancelMarquee"]);
  t.pointer.move({ x: 60, y: 60 });
  t.pointer.up();
  assert.deepEqual(t.take(), [], "the release finds nothing to end");
  const c = setup();
  down(c.pointer, { kind: "port", id: "s1", side: "R" });
  c.take();
  c.pointer.cancel();
  assert.deepEqual(c.take(), ["endConnect"]);
  assert.deepEqual(c.pointer.state().mode, "idle");
});

/* ---------- the click that follows a drag ---------- */

test("the click after a drag is not a click: consumeMoved says so once, then forgets", () => {
  const t = setup();
  down(t.pointer, FRAME);
  t.pointer.move({ x: 60, y: 10 });
  t.pointer.up();
  assert.equal(t.pointer.consumeMoved(), true);
  assert.equal(t.pointer.consumeMoved(), false);
});

test("a new press forgets that the last one travelled", () => {
  const t = setup();
  down(t.pointer, CANVAS);
  t.pointer.move({ x: 60, y: 10 });
  t.pointer.up();
  down(t.pointer, FRAME);
  assert.equal(t.pointer.consumeMoved(), false);
});

/* ---------- what it knows ---------- */

test("state says what the pointer is doing", () => {
  const t = setup();
  assert.equal(t.pointer.state().mode, "idle");
  down(t.pointer, FRAME);
  assert.equal(t.pointer.state().mode, "press");
  t.pointer.up();
  down(t.pointer, CANVAS);
  assert.equal(t.pointer.state().mode, "marquee");
  t.pointer.up();
  down(t.pointer, null, { button: 1 });
  assert.equal(t.pointer.state().mode, "pan");
  t.pointer.up();
  down(t.pointer, { kind: "port", id: "s1", side: "R" });
  assert.equal(t.pointer.state().mode, "connect");
  t.pointer.up();
  assert.equal(t.pointer.state().mode, "idle");
});

test("a host that cannot do what the arbiter needs is refused at the start", () => {
  assert.throws(() => FlowPointer.create({}), /FlowPointer: the host has no/);
  assert.throws(() => FlowPointer.create(), /FlowPointer: the host has no/);
});
