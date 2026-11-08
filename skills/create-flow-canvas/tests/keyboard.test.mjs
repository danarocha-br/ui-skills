import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowKeyboard, FlowLayout, FlowGeometry, FlowDevice, FlowArrange, FlowCommit } from "./modules.mjs";

test("a frame name describes its route, shown state, membership and selection without a screen document", () => {
  assert.equal(FlowKeyboard.frameName({ name: "Account", route: "/account", state: "Offline",
    group: "Setup", index: 1, total: 3, open: false, selected: true }),
    "Account. Route /account. State Offline. Setup, frame 2 of 3, closed. Selected.");
  assert.equal(FlowKeyboard.frameName({ name: "Account", route: "/account" }),
    "Account. Route /account. State Default. Loose frame. Not selected.");
});

import { builtinKinds } from "./kinds.mjs";
const plain = (x) => JSON.parse(JSON.stringify(x));
function setup() {
  const frames = ["alpha", "beta", "gamma", "delta"];
  const defaults = () => ({ groups: [{ id: "flow", title: "Setup", screens: frames.slice(0, 3), open: false },
    { id: "other", title: "Account", screens: ["delta"], open: true }], pos: { mobile: {}, tablet: {}, desktop: {} } });
  const kinds = builtinKinds(defaults);
  const layout = FlowLayout.create({ key: "test", storage: { getItem: () => null, setItem() {} },
    defaults, kinds, hasScreen: (id) => frames.includes(id) });
  const geo = FlowGeometry.create({ reduceMotion: true });
  const metrics = () => FlowDevice.describe("mobile").metrics;
  geo.setMetrics(metrics());
  const input = () => ({ groups: layout.groups, screens: frames, pos: layout.pos.mobile });
  const redraw = () => geo.retarget(input(), 0, { snap: true });
  redraw();
  const arrange = FlowArrange.create({ layout, geo, frames, device: () => "mobile", metrics, input });
  const commit = FlowCommit.create({ layout, kinds, redraw: { world: redraw, layout: redraw } });
  const keyboard = FlowKeyboard.create({ layout, geo, arrange, frames, device: () => "mobile" });
  return { layout, geo, keyboard, commit, redraw };
}

test("keyboard reordering moves one slot in a closed group and never wraps at either end", () => {
  const { layout, keyboard } = setup();
  assert.equal(keyboard.reorder("beta", -1), true);
  assert.deepEqual(plain(layout.groups[0].screens), ["beta", "alpha", "gamma"]);
  assert.equal(keyboard.reorder("beta", -1), false);
  assert.equal(keyboard.reorder("gamma", 1), false);
  assert.equal(keyboard.reorder("missing", 1), false);
  assert.equal(layout.groups[0].open, false);
  assert.equal(keyboard.reorder("beta", 1), true);
  assert.deepEqual(plain(layout.groups[0].screens), ["alpha", "beta", "gamma"]);
});

test("a loose frame moves on the shown device only; grouped or unknown frames cannot be nudged", () => {
  const { layout, keyboard, redraw } = setup();
  assert.equal(keyboard.nudge("beta", 10, 0), false);
  layout.takeOut(["beta"]);
  layout.place("mobile", "beta", { x: 200, y: 300 });
  layout.place("desktop", "beta", { x: 800, y: 900 });
  redraw();
  assert.equal(keyboard.nudge("beta", -10, 10), true);
  assert.deepEqual(plain(layout.pos.mobile.beta), { x: 190, y: 310 });
  assert.deepEqual(plain(layout.pos.desktop.beta), { x: 800, y: 900 });
  assert.equal(keyboard.nudge("unknown", 10, 0), false);
});

test("reordering and taking out a frame each undo once, retaining the group's view state", () => {
  const { layout, keyboard, commit, geo } = setup();
  const before = layout.snapshot();
  commit(() => keyboard.reorder("alpha", 1));
  assert.equal(commit.undo(), true);
  assert.equal(layout.snapshot(), before);
  // Taking out uses the existing arranger, shared by pointer and keyboard paths.
  const arrange = FlowArrange.create({ layout, geo, frames: ["alpha", "beta", "gamma", "delta"], device: () => "mobile" });
  commit(() => arrange.takeOut(["alpha"]));
  assert.equal(layout.groupOf("alpha"), undefined);
  assert.ok(layout.pos.mobile.alpha.x > 0);
  assert.equal(commit.undo(), true);
  assert.equal(layout.snapshot(), before);
  assert.equal(layout.groups[0].open, false);
  assert.equal(commit.undo(), false);
});

test("frame commands reserve only their documented keys and do not steal browser or existing canvas shortcuts", () => {
  assert.deepEqual(plain(FlowKeyboard.command({ key: "ArrowLeft", altKey: true, shiftKey: true })), { action: "reorder", delta: -1 });
  assert.deepEqual(plain(FlowKeyboard.command({ key: "ArrowUp", shiftKey: true })), { action: "nudge", dx: 0, dy: -10 });
  assert.deepEqual(plain(FlowKeyboard.command({ key: "ArrowRight" })), { action: "focus", delta: 1 });
  assert.deepEqual(plain(FlowKeyboard.command({ key: "F10", shiftKey: true })), { action: "actions" });
  assert.deepEqual(plain(FlowKeyboard.command({ key: "Enter" })), { action: "enter" });
  for (const key of ["i", "n", "l", "a", "m", "t", "d", "c", "1", "2", " ", "g", "k"]) {
    assert.equal(FlowKeyboard.command({ key }), null, key);
  }
  for (const modifiers of [{ altKey: true }, { metaKey: true }, { ctrlKey: true }, { ctrlKey: true, shiftKey: true }]) {
    assert.equal(FlowKeyboard.command({ key: "ArrowLeft", ...modifiers }), null);
  }
});

test("moving to a group appends the frame, removes an emptied source, and ignores stale picker targets", () => {
  const {layout,keyboard}=setup();
  assert.equal(keyboard.join("delta","missing"),false);
  assert.equal(keyboard.join("missing","flow"),false);
  assert.equal(keyboard.join("alpha","flow"),false);
  assert.equal(keyboard.join("delta","flow"),true);
  assert.deepEqual(plain(layout.groups.map(g=>[g.id,g.screens])),[["flow",["alpha","beta","gamma","delta"]]]);
});
