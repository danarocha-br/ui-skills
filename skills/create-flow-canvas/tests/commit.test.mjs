/* Commit module tests. FlowCommit is the one place that decides what happens after an edit: the
   undo point, the save, and which parts of the page are redrawn, in a fixed order. These tests run
   it with the real layout module and recording stand-ins for the page's redraw functions.
   Run:  node --test skills/create-flow-canvas/tests/commit.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowLayout, FlowCommit } from "./modules.mjs";
import { builtinKinds } from "./kinds.mjs";

const KEY = "flow-canvas.layout.v1";
const DEFAULTS = {
  groups: [
    { id: "g1", screens: ["s1", "s2"], open: true, title: "One" },
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
    kinds: builtinKinds(DEFAULTS),
  });
  const redraw = { world: () => calls.push("redraw:world"), layout: () => calls.push("redraw:layout") };
  /* a connector's change asks for the connectors to be drawn; notes and findings are drawn by hand by the page */
  const kinds = builtinKinds(DEFAULTS, { refresh: (name) => calls.push("redraw:" + name) }).map((k) => ({ ...k, redraw: k.name === "conns" ? ["conns"] : [] }));
  /* timers the test runs by hand */
  const pending = [];
  const timer = {
    set: (f, ms) => (pending.push({ f, ms }), pending.length),
    clear: (t) => t && (pending[t - 1] = null),
  };
  const fire = () => pending.splice(0).forEach((t) => t && t.f());
  const commit = FlowCommit.create({ layout, kinds, redraw, timer });
  return { layout, commit, calls, fire, pending };
}
const eq = (actual, expected) => assert.deepEqual(JSON.parse(JSON.stringify(actual)), expected);
/* an edit that touches nothing: so a test of what is redrawn sees only what it asked for */
const text = (layout, t) => layout.setGroupText("g1", { title: t });
const title = (layout) => layout.groups[0].title;

test("commit runs the change, hands back its result, and makes it one undo step", () => {
  const { layout, commit } = setup();
  const result = commit(() => {
    text(layout, "Two");
    layout.setGroupText("g1", { sub: "more" });
    return "done";
  });
  assert.equal(result, "done");
  assert.equal(layout.undo(), true);
  assert.equal(title(layout), "One");
  assert.equal(layout.undo(), false);
});

test("a change that leaves the layout as it was does nothing: no undo step, no save, no redraw", () => {
  const { layout, commit, calls } = setup();
  const result = commit(() => {
    text(layout, "Two");
    text(layout, "One");
    return "nothing";
  }, { redraw: ["layout", "conns"] });
  assert.equal(result, "nothing");
  assert.deepEqual(calls, []);
  assert.equal(layout.undo(), false);
});

test("the change is saved first, then the asked-for parts are redrawn in a fixed order, whatever order they were asked in", () => {
  const { layout, commit, calls } = setup();
  commit(() => text(layout, "Two"), { redraw: ["conns", "notes", "layout", "scans"] });
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:scans", "redraw:notes", "redraw:conns"]);
});

test("redraw: 'all' redraws layout, captions, scanner cards, notes and connectors; nothing asked of a change that touches nothing means nothing redrawn", () => {
  const { layout, commit, calls } = setup();
  commit(() => text(layout, "Two"), { redraw: "all" });
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:caps", "redraw:scans", "redraw:notes", "redraw:conns"]);
  calls.length = 0;
  commit(() => text(layout, "Three"));
  assert.deepEqual(calls, ["save"]);
});

test("what a change touched is redrawn without being asked: places and groups redraw the layout, a connector its connectors, a note nothing", () => {
  const { layout, commit, calls } = setup();
  commit(() => layout.place("mobile", "s1", { x: 1, y: 1 }));
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  calls.length = 0;
  commit(() => layout.edit("conns", "c1", { label: "Go" }));
  assert.deepEqual(calls, ["save", "redraw:conns"]);
  calls.length = 0;
  commit(() => layout.add("notes", { id: "n1", frame: null, who: "You", text: "hi", x: 1, y: 1 }));
  assert.deepEqual(calls, ["save"], "the note kind draws its own card");
  calls.length = 0;
  commit(() => layout.takeOut(["s1"]), { redraw: ["conns"] });
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:conns"], "added to what the caller asked for");
});

test("touches from one commit are not carried into the next", () => {
  const { layout, commit, calls } = setup();
  layout.place("mobile", "s1", { x: 1, y: 1 }); // outside any commit
  commit(() => text(layout, "Two"));
  assert.deepEqual(calls, ["save"]);
});

test("quiet: the page drew the change itself, so only what was asked for is redrawn", () => {
  const { layout, commit, calls } = setup();
  commit(() => layout.place("mobile", "s1", { x: 1, y: 1 }), { quiet: true });
  assert.deepEqual(calls, ["save"]);
  calls.length = 0;
  commit(() => layout.place("mobile", "s2", { x: 1, y: 1 }), { quiet: true, redraw: ["conns"] });
  assert.deepEqual(calls, ["save", "redraw:conns"]);
});

test("undo: false saves and redraws but makes no undo step", () => {
  const { layout, commit, calls } = setup();
  commit(() => layout.place("mobile", "s1", { x: 1, y: 1 }), { undo: false });
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  assert.equal(layout.undo(), false);
  eq(layout.pos.mobile, { s1: { x: 1, y: 1 } });
});

test("a change to only how the groups are shown is saved and redrawn, and is not an undo step", () => {
  const { layout, commit, calls } = setup();
  assert.equal(commit(() => layout.setOpen("g2", true)), true);
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  assert.equal(layout.undo(), false);
  assert.equal(layout.groups[1].open, true);
  calls.length = 0;
  commit(() => layout.setOpen("g2", true));
  assert.deepEqual(calls, [], "already open: nothing changed");
});

test("a change that opens a group and edits another thing is one undo step for the edit alone", () => {
  const { layout, commit } = setup();
  commit(() => {
    layout.setOpen("g2", true);
    text(layout, "Two");
  });
  assert.equal(layout.undo(), true);
  assert.equal(title(layout), "One");
  assert.equal(layout.groups[1].open, true, "undo leaves how the groups are shown");
});

test("undo restores (which saves), runs the page's own clean-up, then redraws everything in the fixed order", () => {
  const { layout, commit, calls } = setup();
  commit(() => text(layout, "Two"));
  calls.length = 0;
  assert.equal(commit.undo(() => calls.push("clean-up")), true);
  assert.deepEqual(calls, ["save", "clean-up", "redraw:layout", "redraw:caps", "redraw:scans", "redraw:notes", "redraw:conns"]);
  assert.equal(title(layout), "One");
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
      text(layout, "Two");
      commit(() => layout.add("conns", { id: "c2", from: "s2", to: "s1", label: "Back" }), { redraw: ["conns"] });
    },
    { redraw: ["layout"] },
  );
  assert.deepEqual(calls, ["save", "redraw:layout", "redraw:conns"]);
  assert.equal(layout.undo(), true);
  assert.equal(title(layout), "One");
  assert.equal(layout.conns.length, 1);
  assert.equal(layout.undo(), false);
});

test("an unknown redraw name fails loudly before the change runs", () => {
  const { layout, commit, calls } = setup();
  let ran = false;
  assert.throws(() => commit(() => ((ran = true), text(layout, "Two")), { redraw: ["layuot"] }), /unknown redraw kind "layuot"/);
  assert.equal(ran, false);
  assert.deepEqual(calls, []);
});

test("creating a commit without a redraw function for every kind fails loudly", () => {
  const { layout } = setup();
  assert.throws(() => FlowCommit.create({ layout, kinds: builtinKinds(), redraw: { layout() {} } }), /missing redraw function for "world"/);
});

test("a change that throws leaves nothing saved or marked, and the next commit works", () => {
  const { layout, commit, calls } = setup();
  assert.throws(
    () =>
      commit(() => {
        text(layout, "Two");
        throw new Error("boom");
      }),
    /boom/,
  );
  assert.deepEqual(calls, []);
  assert.equal(layout.undo(), false);
  text(layout, "One");
  commit(() => layout.setGroupText("g2", { title: "B" }));
  assert.deepEqual(calls, ["save"]);
});

test("a nested commit's own undo and redraw choices do not override the outer one: only the outer decides the undo step", () => {
  const { layout, commit } = setup();
  commit(() => {
    text(layout, "Two");
    commit(() => layout.setGroupText("g2", { title: "B" }), { undo: false });
  });
  assert.equal(layout.undo(), true);
  assert.equal(title(layout), "One"); // both edits were one undo step, although the inner one asked for none
  assert.equal(layout.groups[1].title, "Untitled group");
  assert.equal(layout.undo(), false);
});

test("force redraws even when nothing changed, with no undo step and no save (a drag that was cancelled or let go in place)", () => {
  const { layout, commit, calls } = setup();
  commit(() => {}, { redraw: ["layout"], force: true });
  assert.deepEqual(calls, ["redraw:layout"]);
  assert.equal(layout.undo(), false);
});

test("force does not change what a real change does: undo point, save, redraw", () => {
  const { layout, commit, calls } = setup();
  commit(() => text(layout, "Two"), { redraw: ["layout"], force: true });
  assert.deepEqual(calls, ["save", "redraw:layout"]);
  assert.equal(layout.undo(), true);
});

/* ---------- text typed in place ---------- */

test("typing: every keystroke goes through a mutator, and the visit is one undo step when it ends", () => {
  const { layout, commit, calls } = setup();
  "Two".split("").forEach((_, i) => commit.typing.change(() => text(layout, "Two".slice(0, i + 1))));
  assert.equal(title(layout), "Two");
  assert.equal(commit.typing.end(), true);
  assert.deepEqual(calls, ["save"], "saved once as the visit ends, and nothing redrawn: the field shows it already");
  assert.equal(layout.undo(), true);
  assert.equal(title(layout), "One", "one step back to where the visit began");
  assert.equal(layout.undo(), false);
});

test("typing: the text is saved a moment after the last key, not on every key and not only at the end", () => {
  const { layout, commit, calls, fire, pending } = setup();
  commit.typing.change(() => text(layout, "T"));
  commit.typing.change(() => text(layout, "Tw"));
  assert.equal(pending.filter(Boolean).length, 1, "a key restarts the wait; it does not stack");
  assert.equal(pending.filter(Boolean)[0].ms, 400);
  assert.deepEqual(calls, []);
  fire();
  assert.deepEqual(calls, ["save"]);
  assert.equal(layout.undo(), false, "saved, but the step is recorded when the visit ends");
});

test("typing: a visit that ends where it began leaves no undo step and no save", () => {
  const { layout, commit, calls } = setup();
  commit.typing.change(() => text(layout, "Two"));
  commit.typing.change(() => text(layout, "One"));
  assert.equal(commit.typing.end(), false);
  assert.deepEqual(calls, []);
  assert.equal(layout.undo(), false);
  assert.equal(commit.typing.end(), false, "ending with no visit says so");
});

test("typing: the wait for a save is cancelled when the visit ends, so a save does not come twice", () => {
  const { layout, commit, calls, fire } = setup();
  commit.typing.change(() => text(layout, "Two"));
  commit.typing.end();
  fire();
  assert.deepEqual(calls, ["save"]);
});

test("typing: a commit or an undo ends the visit first, so the two are never one step", () => {
  const { layout, commit } = setup();
  commit.typing.change(() => text(layout, "Two"));
  commit(() => layout.setGroupText("g2", { title: "B" }));
  assert.equal(layout.undo(), true);
  assert.equal(layout.groups[1].title, "Untitled group");
  assert.equal(title(layout), "Two", "the typing was its own step");
  commit.typing.change(() => text(layout, "Three"));
  assert.equal(commit.undo(), true, "undo ends the visit, then undoes it");
  assert.equal(title(layout), "Two");
});

test("typing: a note's text and a caption's are typed through edit, and are undone like a title", () => {
  const { layout, commit } = setup();
  layout.add("notes", { id: "n1", frame: null, who: "You", text: "", x: 0, y: 0 });
  layout.mark();
  commit.typing.change(() => layout.edit("notes", "n1", { text: "hello" }));
  commit.typing.end();
  assert.equal(layout.notes.find((n) => n.id === "n1").text, "hello");
  assert.equal(layout.undo(), true);
  assert.equal(layout.notes.find((n) => n.id === "n1").text, "");
});
