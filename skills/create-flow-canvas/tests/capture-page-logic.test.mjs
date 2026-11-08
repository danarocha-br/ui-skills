/* Repeatable captures, component names, inlining budgets, pixel comparison and finding Playwright.
   Run:  node --test skills/create-flow-canvas/tests/capture-page-logic.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import vm from "node:vm";
import { freezeClockAndRandom } from "../scripts/lib/determinism.mjs";
import { componentName, declaredComponents } from "../scripts/lib/components.mjs";
import { fitsBudget } from "../scripts/lib/budget.mjs";
import { diffPixels } from "../scripts/lib/pixels.mjs";
import { loadPlaywright } from "../scripts/lib/playwright.mjs";
import { DEVICES, screenDocument } from "../scripts/lib/devices.mjs";

const inFrozenWorld = (code, options = { now: "2026-01-15T12:00:00.000Z", seed: 42 }) =>
  vm.runInNewContext(`(${freezeClockAndRandom})(${JSON.stringify(options)}); ${code}`);

test("two page loads see the same random numbers", () => {
  const draw = "[Math.random(), Math.random(), Math.random()]";
  const first = inFrozenWorld(draw);
  assert.deepEqual([...first], [...inFrozenWorld(draw)]);
  assert.notEqual(first[0], first[1]);
  assert.ok(first.every((n) => n >= 0 && n < 1));
});

test("a different seed gives different numbers", () => {
  const draw = "Math.random()";
  assert.notEqual(inFrozenWorld(draw, { now: 0, seed: 1 }), inFrozenWorld(draw, { now: 0, seed: 2 }));
});

test("the clock stands still in every way of asking it", () => {
  assert.equal(inFrozenWorld("Date.now()"), Date.UTC(2026, 0, 15, 12));
  assert.equal(inFrozenWorld("new Date().toISOString()"), "2026-01-15T12:00:00.000Z");
  assert.match(inFrozenWorld("Date()"), /2026/);
});

test("generated UUIDs repeat too", () => {
  const draw = `globalThis.crypto = { randomUUID: () => "real" }; (${freezeClockAndRandom})({ now: 0, seed: 7 }); [crypto.randomUUID(), crypto.randomUUID()]`;
  const [first, second] = vm.runInNewContext(draw);
  assert.match(first, /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/);
  assert.notEqual(first, second);
  assert.deepEqual([...vm.runInNewContext(draw)], [first, second]);
});

test("explicit dates and subclasses still work", () => {
  assert.equal(inFrozenWorld("new Date(0).getTime()"), 0);
  assert.equal(inFrozenWorld("new Date(2000, 0, 1) instanceof Date"), true);
  assert.equal(inFrozenWorld("class D extends Date { hi() { return 1; } }; new D().hi()"), 1);
  assert.equal(inFrozenWorld("Date.UTC(1970, 0, 1)"), 0);
});

test("a component's name is read from each shape React gives it", () => {
  function Plain() {}
  assert.equal(componentName(Plain), "Plain");
  assert.equal(componentName({ displayName: "Shown", name: "x" }), "Shown");
  assert.equal(componentName({ render: function Forwarded() {} }), "Forwarded");
  assert.equal(componentName({ type: function Memoed() {} }), "Memoed");
  assert.equal(componentName("div"), null);
  assert.equal(componentName(null), null);
});

test("declared components are found in source, and lower-case helpers are not", () => {
  const source = `
    export default function Editor() {}
    const CodeBlock = () => null;
    class Legacy extends Component {}
    function helper() {}
    const value = 1;`;
  assert.deepEqual([...declaredComponents(source)].sort(), ["CodeBlock", "Editor", "Legacy"]);
});

test("an item fits only within its own and the running limit", () => {
  const limits = { item: 100, total: 250 };
  assert.equal(fitsBudget(100, 0, limits), true);
  assert.equal(fitsBudget(101, 0, limits), false);
  assert.equal(fitsBudget(100, 200, limits), false);
});

test("device sizes and the screen document match the engine they stand in for", () => {
  const engine = fs.readFileSync(new URL("../assets/flow-canvas.html", import.meta.url), "utf8");
  for (const { width, height, cls } of Object.values(DEVICES)) {
    assert.match(engine, new RegExp(`viewport: \\[${width}, ${height}\\][^\\n]*cls: "${cls}"`));
  }
  const shell = screenDocument("", "", "", "x").replace(/\s+/g, "");
  for (const rule of [...engine.matchAll(/html\{width:100%[\s\S]*?overscroll-behavior:contain\}/g)]) {
    assert.ok(shell.includes(rule[0].replace(/\s+/g, "")));
  }
});

const rgba = (...pixels) => Uint8ClampedArray.from(pixels.flatMap((p) => [p, p, p, 255]));

test("identical images differ nowhere", () => {
  assert.deepEqual(diffPixels(rgba(1, 2, 3, 4), rgba(1, 2, 3, 4), 2, 2), { pct: 0, minY: null, maxY: null });
});

test("a difference is counted, and its rows reported", () => {
  assert.deepEqual(diffPixels(rgba(0, 0, 0, 0), rgba(0, 0, 200, 0), 2, 2), { pct: 25, minY: 1, maxY: 1 });
});

test("a small colour shift under the threshold is ignored", () => {
  /* 15 per channel across 3 channels is 45, under the default 48 */
  assert.equal(diffPixels(rgba(0), rgba(15), 1, 1).pct, 0);
  assert.equal(diffPixels(rgba(0), rgba(17), 1, 1).pct, 100);
});

const tempRoot = () => fs.mkdtempSync(path.join(os.tmpdir(), "flow-pw-"));
function fakePackage(root, name) {
  const dir = path.join(root, "node_modules", name);
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, "index.js"), `exports.chromium = { from: ${JSON.stringify(name)} };`);
}

test("Playwright is found in the first root that has it", () => {
  const empty = tempRoot();
  const having = tempRoot();
  fakePackage(having, "playwright-core");
  assert.deepEqual(loadPlaywright({ env: {}, roots: [empty, having] }).chromium, { from: "playwright-core" });
});

test("an explicit path wins", () => {
  const root = tempRoot();
  fakePackage(root, "playwright");
  const explicit = tempRoot();
  fakePackage(explicit, "playwright-core");
  const env = { FLOW_PLAYWRIGHT: path.join(explicit, "node_modules", "playwright-core") };
  assert.deepEqual(loadPlaywright({ env, roots: [root] }).chromium, { from: "playwright-core" });
});

test("when absent, the error says how to fix it and where not to install", () => {
  assert.throws(() => loadPlaywright({ env: {}, roots: [tempRoot()] }), (error) =>
    /Playwright/.test(error.message) && /FLOW_PLAYWRIGHT/.test(error.message) && /throwaway/.test(error.message));
});
