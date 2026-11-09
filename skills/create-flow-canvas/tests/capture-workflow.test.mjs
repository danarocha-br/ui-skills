/* What capture says when a screen is probably wrong, and how a long capture survives: client redirects, personas that
   change nothing, acknowledged signals, a clock that runs, resuming, and a browser that dies mid-run.
   Run:  node --test skills/create-flow-canvas/tests/capture-workflow.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { freezeClockAndRandom } from "../scripts/lib/determinism.mjs";
import { suspectSignals, acknowledged, identicalStates, redirectOf } from "../scripts/lib/signals.mjs";
import { readScenarios } from "../scripts/lib/scenarios.mjs";
import { mergeResume, isBrowserGone } from "../scripts/lib/resume.mjs";
import { loadPlaywright } from "../scripts/lib/playwright.mjs";

const facts = { candidates: [], textLength: 500, elementCount: 100, mediaCount: 0, bodyText: "" };

test("a page that ended somewhere else than it was asked for is flagged, with where it ended", () => {
  const signals = suspectSignals({ ...facts, redirect: { requested: "/checkout/success?session_id=cs_1", final: "/" } });
  assert.deepEqual(signals.find((s) => s.kind === "redirected"), { kind: "redirected", count: 1, samples: ["/checkout/success?session_id=cs_1 -> /"] });
});

test("redirectOf compares path and query, and ignores a trailing slash and the hash", () => {
  assert.equal(redirectOf("/a/b", "http://localhost:3210/a/b/#x"), null);
  assert.equal(redirectOf("/a?x=1", "http://localhost:3210/a?x=1"), null);
  assert.deepEqual(redirectOf("/a?x=1", "http://localhost:3210/b"), { requested: "/a?x=1", final: "/b" });
  assert.deepEqual(redirectOf("/a", "http://localhost:3210/a?next=%2F"), { requested: "/a", final: "/a?next=%2F" });
  assert.equal(redirectOf("/a?x=1&y=2", "http://localhost:3210/a?y=2&x=1"), null, "query order is not a redirect");
});

test("a signal a state lists as acknowledged no longer shows, and others still do", () => {
  const signals = [{ kind: "near-empty", count: 1 }, { kind: "skeleton", count: 2 }];
  assert.deepEqual(acknowledged(signals, ["near-empty"]), [{ kind: "skeleton", count: 2 }]);
  assert.deepEqual(acknowledged(signals, undefined), signals);
});

test("states with different personas that render identically are reported, per device", () => {
  const cap = (html) => ({ html, rootCls: "dark" });
  const states = [{ name: "Member", persona: "member" }, { name: "Admin", persona: "admin" }, { name: "Empty", persona: "member", scenario: "empty" }];
  const captures = {
    Member: { desktop: cap("<p>same</p>"), mobile: cap("<p>m1</p>") },
    Admin: { desktop: cap("<p>same</p>"), mobile: cap("<p>m2</p>") },
    Empty: { desktop: cap("<p>none</p>"), mobile: cap("<p>none</p>") },
  };
  assert.deepEqual(identicalStates(states, captures), [{ kind: "states-identical", states: ["Member", "Admin"], devices: ["desktop"] }]);
});

test("states that differ only in steps or by chance are not reported, nor two states with the same persona and scenario", () => {
  const states = [{ name: "A", persona: "p" }, { name: "B", persona: "p" }];
  const same = { desktop: { html: "x" } };
  assert.deepEqual(identicalStates(states, { A: same, B: same }), []);
});

test("freeze.clock 'run' starts the clock at the frozen time and lets it advance", () => {
  const code = `(${freezeClockAndRandom})({ now: "2026-01-15T12:00:00.000Z", seed: 1, clock: "run" }); const a = Date.now(); wait(); [a, Date.now()]`;
  const wait = () => { const end = performance.now() + 40; while (performance.now() < end); };
  const [a, b] = vm.runInNewContext(code, { wait });
  assert.ok(a >= Date.UTC(2026, 0, 15, 12) && a < Date.UTC(2026, 0, 15, 12) + 1000);
  assert.ok(b >= a + 30, "time passed");
});

test("scenarios accept freeze: false and a clock mode, and reject nonsense", () => {
  const base = { screens: [{ id: "a", route: "/", url: "/", states: [{ name: "x", acknowledge: ["near-empty"] }] }] };
  assert.equal(readScenarios({ ...base, freeze: false }).freeze, false);
  assert.equal(readScenarios({ ...base, freeze: { clock: "run" } }).freeze.clock, "run");
  assert.throws(() => readScenarios({ ...base, freeze: "yes" }), /freeze/);
  assert.throws(() => readScenarios({ ...base, freeze: { clock: "fast" } }), /clock/);
  assert.throws(() => readScenarios({ screens: [{ ...base.screens[0], states: [{ name: "x", acknowledge: "near-empty" }] }] }), /acknowledge/);
  assert.throws(() => readScenarios({ ...base, loadTimeoutMs: "slow" }), /loadTimeoutMs/);
  assert.equal(readScenarios({ screens: [{ ...base.screens[0], states: [{ name: "x", settleMs: 300 }] }] }).screens[0].states[0].settleMs, 300);
  assert.throws(() => readScenarios({ screens: [{ ...base.screens[0], states: [{ name: "x", settleMs: -1 }] }] }), /settleMs/);
});

const shot = (id, states) => ({ id, route: "/" + id, url: "/" + id, states: states.map((name) => ({ name })), captures: Object.fromEntries(states.map((n) => [n, { desktop: { html: id + n } }])) });

test("resuming keeps what was not asked for, replaces what was, and drops what the scenarios no longer list", () => {
  const previous = { screens: [shot("a", ["one"]), shot("b", ["one", "two"]), shot("gone", ["one"])], errors: [{ screen: "b", state: "two", device: "desktop", message: "x" }, { screen: "a", state: "one", device: "desktop", message: "y" }], blocked: { h: 1 }, assets: {}, escaped: {} };
  const fresh = { screens: [shot("b", ["one"])], errors: [], blocked: { h: 2 }, assets: {}, escaped: {} };
  const configured = ["a", "b"];
  const merged = mergeResume(previous, fresh, ["b"], configured);
  assert.deepEqual(merged.screens.map((s) => s.id), ["a", "b"], "scenario order, the removed screen gone");
  assert.deepEqual(Object.keys(merged.screens[1].captures), ["one"], "b was recaptured: its dropped state is gone");
  assert.deepEqual(merged.errors, [{ screen: "a", state: "one", device: "desktop", message: "y" }], "errors of recaptured screens are replaced");
  assert.deepEqual(merged.blocked, { h: 3 }, "tallies add up");
});

test("resuming with nothing to resume from is just the fresh run", () => {
  const fresh = { screens: [shot("b", ["one"])], errors: [], blocked: {}, assets: {}, escaped: {} };
  assert.deepEqual(mergeResume(null, fresh, ["b"], ["b"]).screens.map((s) => s.id), ["b"]);
});

test("a closed browser is told from an ordinary failed capture", () => {
  assert.ok(isBrowserGone(new Error("page.goto: Target page, context or browser has been closed")));
  assert.ok(isBrowserGone(new Error("browserContext.newPage: Browser closed.")));
  assert.ok(isBrowserGone(new Error("Protocol error (Target.createTarget): Target closed")));
  assert.ok(isBrowserGone(new Error("page.screenshot: Page crashed")));
  assert.ok(!isBrowserGone(new Error("page.click: Timeout 10000ms exceeded waiting for selector")));
});

test("Playwright is found through .flow-canvas/playwright-path, so it survives between commands", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "fc-pw-"));
  fs.mkdirSync(path.join(dir, ".flow-canvas"));
  fs.mkdirSync(path.join(dir, "elsewhere"));
  fs.writeFileSync(path.join(dir, "elsewhere", "index.js"), "module.exports = { fromFile: true };");
  fs.writeFileSync(path.join(dir, ".flow-canvas", "playwright-path"), path.join(dir, "elsewhere") + "\n");
  assert.deepEqual(loadPlaywright({ env: {}, roots: [], cwd: dir }), { fromFile: true });
  assert.throws(() => loadPlaywright({ env: {}, roots: [], cwd: os.tmpdir() }), /not found/i);
});

/* ---------- text colours: what pixel diff cannot see ---------- */
import { colorDrift, textColors } from "../scripts/lib/colors.mjs";

test("colour drift is the share of characters that changed colour, with the colours that lost the most", () => {
  const expected = { "rgb(255, 0, 0)": 40, "rgb(0, 0, 0)": 60 };
  assert.deepEqual(colorDrift(expected, expected), { pct: 0, detail: [] });
  const d = colorDrift(expected, { "rgb(128, 0, 128)": 40, "rgb(0, 0, 0)": 60 });
  assert.equal(d.pct, 40);
  assert.deepEqual(d.detail[0], { color: "rgb(255, 0, 0)", expected: 40, actual: 0 });
  assert.deepEqual(colorDrift({}, { "rgb(1, 1, 1)": 5 }), { pct: 0, detail: [] }, "nothing expected, nothing to drift from");
});

test("textColors counts visible characters by their computed colour", async (t) => {
  let pw;
  try { pw = loadPlaywright(); } catch { return t.skip("no Playwright on this machine"); }
  const { launchBrowser } = await import("../scripts/lib/playwright.mjs");
  const browser = await launchBrowser(pw);
  try {
    const page = await browser.newPage();
    await page.setContent(`<body style="color:rgb(10,10,10)"><p>abc</p><span style="color:rgb(255,0,0)">de f</span><span style="display:none">hidden</span><script>1</script><style>p{}</style></body>`);
    const got = await page.evaluate(`(${textColors})()`);
    assert.deepEqual(got, { "rgb(255, 0, 0)": 3, "rgb(10, 10, 10)": 3 });
  } finally { await browser.close(); }
});
