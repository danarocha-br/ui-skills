/* Commit module tests. FlowCommit is the one place that decides what happens after an edit: the
   undo point, the save, and which parts of the page are redrawn, in a fixed order. These tests run
   it with the real layout module and recording stand-ins for the page's redraw functions.
   Run:  node --test skills/create-flow-canvas/tests/commit.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit } from "./modules.mjs";

const KEY = "flow-canvas.layout.v1";
const DEFAULTS = {
  lanes: [
    { id: "g1", screens: ["s1", "s2"], open: true },
    { id: "g2", screens: ["s3"], open: false },
  ],
  pos: { mobile: {}, tablet: {}, desktop: {} },
  conns: [{ id: "c1", from: "s1", to: "s2", label: "Next" }],
  notes: [],
  scans: {},
};

/* what happened, in order: "save" when the layout is written, "redraw:<kind>" for each redraw */
function setup() {
  const calls = [];
  const data = {};
  const storage = {
    getItem: (k) => (k in data ? data[k] : null),
    setItem: (k, v) => {
      data[k] = String(v);
      calls.push("save");
    },
  };
  const layout = FlowLayout.create({
    key: KEY,
    storage,
    hasScreen: (id) => /^s\d$/.test(id),
    defaults: () => DEFAULTS,
  });
  const redraw = {};
  for (const kind of ["layout", "scans", "notes", "conns", "world"]) redraw[kind] = () => calls.push("redraw:" + kind);
  const commit = FlowCommit.create({ layout, redraw });
  return { layout, commit, calls };
}
const eq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);

test("commit runs the change, hands back its result, and makes it one undo step", () => {
  const { layout, commit } = setup();
  const result = commit(() => {
    layout.pos.mobile.s1 = { x: 1, y: 1 };
    layout.pos.mobile.s2 = { x: 2, y: 2 };
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {});
  assert.equal(layout.undo(), false);
});

test("a change that leaves the layout as it was does nothing: no undo step, no save, no redraw", () => {
  const { layout, commit, calls } = setup();
  const result = commit(() => {
    layout.pos.mobile.s1 = { x: 1, y: 1 };
    delete layout.pos.mobile.s1;
    return "nothing";
  }, { redraw: ["layout", "conns"] });
  assert.equal(result, "nothing");
  assert.deepEqual(calls, []);
  assert.equal(layout.undo(), false);
});

test("the change is saved first, then the asked-for parts are redrawn in a fixed order, whatever order they were asked in", () => {
  const { layout, commit, calls } = setup();
  commit(() => (layout.pos.mobile.s1 = { x: 1, y: 1 }), { redraw: ["conns", "notes", "layout", "scans"] });
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:scans", "redraw:notes", "redraw:conns"]);
});

test("redraw: 'all' redraws layout, scanner cards, notes and connectors; nothing asked means nothing redrawn", () => {
  const { layout, commit, calls } = setup();
  commit(() => (layout.pos.mobile.s1 = { x: 1, y: 1 }), { redraw: "all" });
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:scans", "redraw:notes", "redraw:conns"]);
  calls.length = 0;
  commit(() => (layout.pos.mobile.s1 = { x: 2, y: 2 }));
  assert.deepEqual(calls, ["save"]);
});

test("undo: false saves and redraws but makes no undo step", () => {
  const { layout, commit, calls } = setup();
  commit(() => (layout.pos.mobile.s1 = { x: 1, y: 1 }), { undo: false, redraw: ["layout"] });
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  assert.equal(layout.undo(), false);
  eq(layout.pos.mobile, { s1: { x: 1, y: 1 } });
});

test("since(before) commits a change that already happened live: one undo step back to `before`, then save and redraw", () => {
  const { layout, commit, calls } = setup();
  const before = layout.snapshot();
  layout.pos.mobile.s1 = { x: 5, y: 5 }; // a drag moved things while the pointer was down
  layout.pos.mobile.s1 = { x: 9, y: 9 };
  commit.since(before, { redraw: ["layout"] });
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {});
  assert.equal(layout.undo(), false);
});

test("since(before) still redraws when nothing changed, because the live gesture moved things on screen", () => {
  const { layout, commit, calls } = setup();
  const before = layout.snapshot();
  commit.since(before, { redraw: ["layout"] });
  assert.deepEqual(calls, ["redraw:layout"]);
  assert.equal(layout.undo(), false);
});

test("undo restores (which saves), runs the page's own clean-up, then redraws everything in the fixed order", () => {
  const { layout, commit, calls } = setup();
  commit(() => (layout.pos.mobile.s1 = { x: 1, y: 1 }));
  calls.length = 0;
  assert.equal(commit.undo(() => calls.push("clean-up")), true);
  assert.deepEqual(calls, ["save", "clean-up", "redraw:layout", "redraw:scans", "redraw:notes", "redraw:conns"]);
  eq(layout.pos.mobile, {});
});

test("undo with nothing to undo says so and touches nothing", () => {
  const { commit, calls } = setup();
  assert.equal(commit.undo(() => calls.push("clean-up")), false);
  assert.deepEqual(calls, []);
});

test("a commit inside a commit joins the outer one: one undo step, one save, the redraws combined", () => {
  const { layout, commit, calls } = setup();
  commit(
    () => {
      layout.pos.mobile.s1 = { x: 1, y: 1 };
      commit(() => layout.conns.push({ id: "c2", from: "s2", to: "s1", label: "Back" }), { redraw: ["conns"] });
    },
    { redraw: ["layout"] },
  );
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:conns"]);
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {});
  assert.equal(layout.conns.length, 1);
  assert.equal(layout.undo(), false);
});

test("an unknown redraw name fails loudly before the change runs", () => {
  const { layout, commit, calls } = setup();
  let ran = false;
  assert.throws(
    () => commit(() => ((ran = true), (layout.pos.mobile.s1 = { x: 1, y: 1 })), { redraw: ["layuot"] }),
    /unknown redraw kind "layuot"/,
  );
  assert.equal(ran, false);
  assert.deepEqual(calls, []);
});

test("creating a commit without a redraw function for every kind fails loudly", () => {
  const { layout } = setup();
  assert.throws(() => FlowCommit.create({ layout, redraw: { layout() {} } }), /missing redraw function for "world"/);
});

test("a change that throws leaves nothing saved or marked, and the next commit works", () => {
  const { layout, commit, calls } = setup();
  assert.throws(
    () =>
      commit(() => {
        layout.pos.mobile.s1 = { x: 1, y: 1 };
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.deepEqual(calls, []);
  assert.equal(layout.undo(), false);
  layout.pos.mobile = {};
  commit(() => (layout.pos.mobile.s2 = { x: 2, y: 2 }));
  assert.deepEqual(calls, ["save"]);
});

test("a nested commit's own undo and redraw choices do not override the outer one: only the outer decides the undo step", () => {
  const { layout, commit } = setup();
  commit(() => {
    layout.pos.mobile.s1 = { x: 1, y: 1 };
    commit(() => (layout.pos.mobile.s2 = { x: 2, y: 2 }), { undo: false });
  });
  assert.equal(layout.undo(), true);
  eq(layout.pos.mobile, {}); // both edits were one undo step, although the inner one asked for none
  assert.equal(layout.undo(), false);
});
