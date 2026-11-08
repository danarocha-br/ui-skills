/* FrameDom: the one owner of a screen's own DOM (the product's markup inside a frame). The module is plain
   logic over a host adapter (mount, count, rects, hit, ripple, ...); here a fake host stands in for the page's
   live one, so nothing needs a browser. A source guard at the bottom fails when the page reaches into a
   screen without going through the module.
   Run:  node --test skills/create-flow-canvas/tests/framedom.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, FlowFrameDom } from "./modules.mjs";

/* two screens: "list" has one state of its own; "form" has a second state with a render and a third with none
   (a state the scan found but has no render for) */
const SCREENS = {
  list: { html: { mobile: "<m-list>", desktop: "<d-list>" }, states: [{ name: "Default" }] },
  form: {
    html: { mobile: "<m-form>", desktop: "<d-form>" },
    states: [
      { name: "Default" },
      { name: "Error", html: { mobile: "<m-form-error>", desktop: "<d-form-error>" } },
      { name: "Only in code" },
    ],
  },
};
const COMPONENTS = { Button: ".btn", Card: ".card" };

/* a host that records what it was asked and answers from a table */
function fakeHost(answers = {}) {
  const calls = [];
  const rec = (name, ...args) => calls.push([name, ...args]);
  const host = {
    calls,
    hostHTML: (id, o) => (rec("hostHTML", id, o), `<screen id="${id}" cls="${o.device.cls}" state="${o.state}">`),
    mount: (id, markup, state) => rec("mount", id, markup, state),
    root: (id) => (rec("root", id), { root: id }),
    count: (id, selector) => (rec("count", id, selector), (answers.count || {})[selector] ?? 0),
    rects: (id, selector) => (rec("rects", id, selector), (answers.rects || {})[selector] ?? null),
    drawSpot: (id, spot) => rec("drawSpot", id, spot),
    clearSpot: () => rec("clearSpot"),
    hit: (event) => (rec("hit", event), answers.hit ?? null),
    ripple: (id, x, y) => rec("ripple", id, x, y),
    goOf: (target) => (rec("goOf", target), answers.go ?? null),
    matches: (target, selector) => (rec("matches", target, selector), !!(answers.matches || {})[selector]),
    copyInto: (id, container) => rec("copyInto", id, container),
  };
  return host;
}
const DEVICES = { mobile: { id: "mobile", cls: "dm" }, desktop: { id: "desktop", cls: "dw" } };
function make({ answers, behaviour = null, device = "mobile" } = {}) {
  const host = fakeHost(answers);
  const current = { device };
  const reported = [];
  const frames = FlowFrameDom.create({
    screens: SCREENS,
    components: COMPONENTS,
    device: () => DEVICES[current.device],
    host,
    behaviour,
    report: (err) => reported.push(err),
  });
  return { frames, host, current, reported };
}
const plain = (x) => JSON.parse(JSON.stringify(x)); /* the module runs in another realm: compare by value */
const names = (host) => host.calls.map((c) => c[0]);

/* ---------- states ---------- */

test("a screen shows its first state until told otherwise, and only states with a render can be shown", () => {
  const { frames } = make();
  assert.equal(frames.stateIndex("form"), 0);
  assert.deepEqual(frames.shownStates("form"), [0, 1]);
  assert.deepEqual(frames.shownStates("list"), [0]);
  assert.equal(frames.switchable("form"), true);
  assert.equal(frames.switchable("list"), false);
});

test("render mounts the screen's own markup for the device", () => {
  const { frames, host } = make();
  frames.render("list");
  assert.deepEqual(host.calls, [["mount", "list", "<m-list>", 0]]);
});

test("ready waits for the latest mount when a state replaces a still-loading render", async () => {
  const host = fakeHost();
  const loads = [];
  host.mount = () => new Promise((resolve) => loads.push(resolve));
  const frames = FlowFrameDom.create({ screens: SCREENS, device: () => DEVICES.mobile, host });
  frames.render("form");
  let done = false;
  const ready = frames.ready("form").then(() => { done = true; });
  frames.setState("form", 1);
  loads[0]();
  await Promise.resolve();
  await Promise.resolve();
  assert.equal(done, false, "the superseded load cannot say the new screen is ready");
  loads[1]();
  await ready;
  assert.equal(done, true);
  await frames.ready("unknown");
});

test("setState mounts that state's render; a state with none, or none at all, is ignored", () => {
  const { frames, host } = make();
  assert.equal(frames.setState("form", 1), true);
  assert.equal(frames.stateIndex("form"), 1);
  assert.deepEqual(host.calls, [["mount", "form", "<m-form-error>", 1]]);
  host.calls.length = 0;
  assert.equal(frames.setState("form", 2), false, "the third state has no render");
  assert.equal(frames.setState("form", 7), false);
  assert.equal(frames.stateIndex("form"), 1);
  assert.deepEqual(host.calls, [], "nothing was mounted");
});

test("a device switch shows the same state in the other device's markup, mounted whole", () => {
  const { frames, host, current } = make();
  frames.setState("form", 1);
  host.calls.length = 0;
  current.device = "desktop";
  frames.render("form");
  assert.equal(frames.stateIndex("form"), 1, "the shown state survives the device");
  assert.deepEqual(host.calls, [["mount", "form", "<d-form-error>", 1]]);
});

test("every render hands the host the whole markup, so what was tapped inside a screen starts clean", () => {
  /* the host replaces a screen's content on mount; taps live in that content and nowhere else, so a new
     render (a state switch or a device switch) has no memory of them. The module keeps no copy of a screen. */
  const { frames, host } = make();
  frames.render("form");
  frames.setState("form", 1);
  frames.setState("form", 0);
  assert.deepEqual(
    host.calls.filter((c) => c[0] === "mount").map((c) => c[2]),
    ["<m-form>", "<m-form-error>", "<m-form>"],
  );
  assert.deepEqual(names(host).filter((n) => n !== "mount"), []);
});

test("asking about a screen the scan does not have changes nothing and throws nothing", () => {
  const { frames, host } = make();
  assert.doesNotThrow(() => frames.render("nope"));
  assert.equal(frames.setState("nope", 0), false);
  assert.equal(frames.stateIndex("nope"), 0);
  assert.equal(frames.switchable("nope"), false);
  assert.equal(frames.count("nope", "Button"), 0);
  assert.deepEqual(host.calls, []);
});

test("hostHTML is the host's, given the device and the state to show", () => {
  const { frames, host } = make();
  frames.setState("form", 1);
  host.calls.length = 0;
  assert.equal(frames.hostHTML("form"), '<screen id="form" cls="dm" state="1">');
  assert.deepEqual(plain(host.calls), [["hostHTML", "form", { device: DEVICES.mobile, state: 1 }]]);
});

/* ---------- counting ---------- */

test("count is a number: the instances of a component the host sees, by the scan's selector", () => {
  const { frames, host } = make({ answers: { count: { ".btn": 3 } } });
  assert.equal(frames.count("list", "Button"), 3);
  assert.equal(frames.count("list", "Card"), 0);
  assert.deepEqual(host.calls, [["count", "list", ".btn"], ["count", "list", ".card"]]);
});

test("a component the scan has no selector for is zero, and the host is not asked", () => {
  const { frames, host } = make();
  assert.equal(frames.count("list", "Ghost"), 0);
  assert.deepEqual(host.calls, []);
});

/* ---------- spotlight ---------- */

test("spotlight draws a hole around each instance, padded by 3 and kept inside the screen", () => {
  const rects = [
    { x: 0, y: 0, w: 100, h: 40 },
    { x: 20, y: 200, w: 60, h: 30 },
  ];
  const { frames, host } = make({ answers: { rects: { ".btn": { w: 390, h: 844, rects } } } });
  frames.spotlight("list", "Button");
  assert.deepEqual(names(host), ["clearSpot", "rects", "drawSpot"]);
  const [, id, spot] = host.calls[2];
  assert.equal(id, "list");
  /* x and y never go below 0; w and h never past the edge of the screen */
  assert.match(spot.svg, /<svg class="spot" width="390" height="844" viewBox="0 0 390 844">/);
  assert.match(spot.svg, /<rect x="0" y="0" width="106" height="46" rx="14" fill="#000"\/>/);
  assert.match(spot.svg, /<rect x="17" y="197" width="66" height="36" rx="14" fill="#000"\/>/);
  assert.equal(spot.label.text, "Button ×2");
});

test("the label sits above the first instance, or below it when there is no room above, and stays on the screen", () => {
  const at = (rect) => {
    const { frames, host } = make({ answers: { rects: { ".btn": { w: 390, h: 844, rects: [rect] } } } });
    frames.spotlight("list", "Button");
    return plain(host.calls.at(-1)[2].label);
  };
  assert.deepEqual(at({ x: 50, y: 100, w: 100, h: 40 }), { text: "Button", left: 47, top: 71 });
  assert.deepEqual(at({ x: 50, y: 10, w: 100, h: 40 }), { text: "Button", left: 47, top: 59 });
  assert.equal(at({ x: 380, y: 100, w: 10, h: 10 }).left, 260, "kept 130px from the right edge");
  assert.equal(at({ x: 0, y: 100, w: 10, h: 10 }).left, 6, "and 6px from the left");
});

test("spotlight on a component that is not on screen draws nothing, and the previous one is cleared", () => {
  const { frames, host } = make({ answers: { rects: { ".btn": { w: 390, h: 844, rects: [] } } } });
  frames.spotlight("list", "Button");
  frames.spotlight("list", "Ghost");
  assert.equal(names(host).includes("drawSpot"), false);
  assert.equal(names(host).filter((n) => n === "clearSpot").length, 2);
});

test("clearSpot is the host's", () => {
  const { frames, host } = make();
  frames.clearSpot();
  assert.deepEqual(host.calls, [["clearSpot"]]);
});

/* ---------- events from inside a screen ---------- */

test("hit asks the host what an event is: a screen, a point on it and an opaque target, or nothing", () => {
  const hit = { id: "list", x: 4, y: 9, target: { t: 1 } };
  const { frames, host } = make({ answers: { hit } });
  const event = { e: 1 };
  assert.equal(frames.hit(event), hit);
  assert.deepEqual(host.calls, [["hit", event]]);
  assert.equal(make().frames.hit(event), null);
});

test("a tap ripples where it landed, reads where it leads, then runs the product's reaction on the screen's root", () => {
  const seen = [];
  const behaviour = { onTap: (...args) => seen.push(args) };
  const { frames, host } = make({ behaviour, answers: { go: "form" } });
  const target = { t: 1 };
  assert.deepEqual(plain(frames.tap({ id: "list", x: 12, y: 30, target })), { go: "form" });
  assert.deepEqual(names(host), ["ripple", "goOf", "root"]);
  assert.deepEqual(host.calls[0], ["ripple", "list", 12, 30]);
  assert.deepEqual(seen, [["list", target, { root: "list" }]]);
});

test("where a tap leads is read before the product's reaction, which may replace the very node that links", () => {
  let linked = true; /* the fake host's link goes away once the reaction has run */
  const host = fakeHost();
  host.goOf = () => (linked ? "form" : null);
  const frames = FlowFrameDom.create({
    screens: SCREENS,
    components: COMPONENTS,
    device: () => DEVICES.mobile,
    host,
    behaviour: { onTap: () => (linked = false) },
  });
  assert.deepEqual(plain(frames.tap({ id: "list", x: 0, y: 0, target: {} })), { go: "form" });
});

test("a tap on nothing that leads anywhere says go: null", () => {
  const { frames } = make({ behaviour: { onTap() {} } });
  assert.deepEqual(plain(frames.tap({ id: "list", x: 0, y: 0, target: {} })), { go: null });
});

test("a screen with no behaviour still ripples and still says where a tap leads", () => {
  const { frames, host } = make({ answers: { go: "form" } });
  assert.deepEqual(plain(frames.tap({ id: "list", x: 1, y: 2, target: {} })), { go: "form" });
  assert.deepEqual(names(host), ["ripple", "goOf"]);
});

test("a reaction that throws is reported and does not stop the tap", () => {
  const boom = new Error("boom");
  const { frames, reported } = make({
    behaviour: { onTap() { throw boom; } },
    answers: { go: "form" },
  });
  assert.deepEqual(plain(frames.tap({ id: "list", x: 0, y: 0, target: {} })), { go: "form" });
  assert.deepEqual(reported, [boom]);
});

test("a tap that is not on a screen does nothing", () => {
  const { frames, host } = make({ behaviour: { onTap() { throw new Error("no"); } } });
  assert.deepEqual(plain(frames.tap(null)), { go: null });
  assert.deepEqual(host.calls, []);
});

test("interactive: a link inside a screen, or what the product says reacts to a tap, is not for the canvas to take", () => {
  const target = { t: 1 };
  const hit = { id: "list", x: 0, y: 0, target };
  const withBehaviour = make({ behaviour: { interactive: ".plant,.tog" }, answers: { matches: { "button,input,select,textarea,label,summary,a[href],[contenteditable],[data-go],.plant,.tog": true } } });
  assert.equal(withBehaviour.frames.interactive(hit), true);
  assert.deepEqual(withBehaviour.host.calls, [["matches", target, "button,input,select,textarea,label,summary,a[href],[contenteditable],[data-go],.plant,.tog"]]);
  const without = make({ answers: { matches: { "button,input,select,textarea,label,summary,a[href],[contenteditable],[data-go]": true } } });
  assert.equal(without.frames.interactive(hit), true);
  assert.equal(make().frames.interactive(hit), false);
  assert.equal(make().frames.interactive(null), false, "an event outside any screen is not interactive");
});

/* ---------- copies ---------- */

test("copyInto asks the host to draw a copy of the screen into a container", () => {
  const { frames, host } = make();
  const container = { c: 1 };
  frames.copyInto("list", container);
  assert.deepEqual(host.calls, [["copyInto", "list", container]]);
});

/* ---------- the page reaches a screen only through here ---------- */

const pageScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
const BEGIN = "/* ---------- live screen host: begin ---------- */";
const END = "/* ---------- live screen host: end ---------- */";
const strip = (js) => js.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

test("the page has one live screen host, and the module is created in it", () => {
  assert.equal(pageScript.split(BEGIN).length, 2, "one begin marker");
  assert.equal(pageScript.split(END).length, 2, "one end marker");
  const inside = pageScript.slice(pageScript.indexOf(BEGIN), pageScript.indexOf(END));
  assert.match(inside, /const FrameDom = /);
  assert.match(inside, /FlowFrameDom\.create\(/);
});

test("outside the live screen host the page names nothing that is inside a screen", () => {
  const outside = strip(pageScript.slice(0, pageScript.indexOf(BEGIN)) + pageScript.slice(pageScript.indexOf(END)));
  const forbidden = [
    [/\.phone\b|["'`]phone["'`]/, "a screen's host element (.phone)"],
    [/["'`]p-["'`]\s*\+|`p-\$\{/, "a screen's element id (p-<id>)"],
    [/FlowScanBehaviour/, "the product's own behaviour"],
    [/\bCOMP_SEL\b/, "the scan's component selectors"],
    [/\.ripple\b|\.spotlbl\b|\.spot\b/, "what the canvas lays over a screen (ripple, spotlight)"],
    [/\bscreenHTML\b|\bstateOf\b/, "a screen's render and its shown state"],
    [/data-go|data-state/, "a screen's own attributes (links, shown state)"],
    [/\bSCREENS\[[^\]]*\]\.html\b/, "a screen's render"],
  ];
  const found = forbidden.filter(([re]) => re.test(outside)).map(([, what]) => what);
  assert.deepEqual(found, []);
});

test("the page uses FrameDom only through its interface, which hands out no node", () => {
  const allowed = new Set(["hostHTML", "render", "ready", "setState", "stateIndex", "shownStates", "switchable", "count", "spotlight", "clearSpot", "hit", "tap", "interactive", "copyInto"]);
  const used = new Set([...strip(pageScript).matchAll(/\bFrameDom\.(\w+)/g)].map((m) => m[1]));
  assert.ok(used.has("render") && used.has("tap"), "the check sees the page's own calls");
  assert.deepEqual([...used].filter((m) => !allowed.has(m)), []);
  assert.deepEqual(Object.keys(FlowFrameDom).sort(), ["create"]);
  const { frames } = make();
  assert.deepEqual(Object.keys(frames).sort(), [...allowed].sort());
});
