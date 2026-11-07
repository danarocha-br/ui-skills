/* The engine knows the scan's shape, not its product. These tests read the engine's script blocks (everything
   but the scan, its styles and its behaviour) and look for what only the sample, Loam, could have put there:
   its screen ids, its finding and note ids, its component names, its product name and the class names its
   own styles define. The forbidden words come from the sample scan itself, so a new sample is checked too.
   Run:  node --test skills/create-flow-canvas/tests/engine-purity.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, FlowScan, sampleScan, readScan } from "./modules.mjs";

const scan = readScan(sampleScan).scan;
/* every <script> block that is not part of the scan */
const engine = [...html.matchAll(/<script\b([^>]*)>([\s\S]*?)<\/script>/g)]
  .filter((m) => !/id="flow-scan(-behaviour)?"/.test(m[1]))
  .map((m) => m[2].replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "")) /* comments may name the sample */
  .join("\n");
const productCss = html.match(/<style id="flow-scan-styles">([\s\S]*?)<\/style>/)[1];
const canvasCss = html.slice(html.indexOf("<style>"), html.indexOf('<style id="flow-scan-styles">'));
const classesIn = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

test("the engine is there to be checked", () => {
  assert.ok(scan, "the sample scan reads");
  assert.ok(engine.includes("FlowScan.read("), "the page script is among the engine blocks");
});

test("the engine names none of the sample's screens, findings or notes", () => {
  const ids = [...scan.screens.map((s) => s.id), ...scan.findings.map((f) => f.id), ...scan.notes.map((n) => n.id)];
  const found = ids.filter((id) => new RegExp(`["'\`#-]${id.replace(/[^\w]/g, "\\$&")}["'\`]`).test(engine));
  assert.deepEqual(found, []);
});

test("the engine names none of the sample's components, nor the product", () => {
  const words = [scan.product.name, ...Object.keys(scan.components)];
  assert.deepEqual(words.filter((w) => new RegExp(`\\b${w}\\b`).test(engine)), []);
});

/* the class names the engine uses: a ".name" that is not property access (in selectors), class="…", and
   classList / className. Rough on purpose: it may see more than is there, never less. */
function classesUsed(js) {
  const used = new Set();
  for (const m of js.matchAll(/(?<![\w$\])\].])\.([a-zA-Z][\w-]*)/g)) used.add(m[1]);
  for (const m of js.matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach((c) => /^[\w-]+$/.test(c) && used.add(c));
  for (const m of js.matchAll(/classList\.\w+\(\s*["'`]([\w-]+)/g)) used.add(m[1]);
  for (const m of js.matchAll(/className\s*=\s*["'`]([\w\s-]+)/g)) m[1].split(/\s+/).forEach((c) => c && used.add(c));
  return used;
}

test("the engine reaches for none of the class names only the product's styles define", () => {
  const own = classesIn(canvasCss);
  /* the device classes are the engine's (it puts them on every frame); the product's styles may scope by them */
  const devices = new Set([...engine.matchAll(/cls:\s*"([^"]+)"/g)].flatMap((m) => m[1].split(" ")));
  const productOnly = [...classesIn(productCss)].filter((c) => !own.has(c) && !devices.has(c));
  const used = classesUsed(engine);
  assert.ok(used.has("phone") && used.has("scan"), "the check sees the engine's own classes");
  assert.deepEqual(productOnly.filter((c) => used.has(c)), []);
});

test("the page around the engine does not name the product either, nor report counts from the sample", () => {
  const page = html
    .replace(/<script\b[\s\S]*?<\/script>/g, "")
    .replace(/<style\b[\s\S]*?<\/style>/g, "")
    .replace(/<!--[\s\S]*?-->/g, "");
  assert.deepEqual(page.match(new RegExp(scan.product.name, "gi")) || [], []);
  assert.ok(!/Scanned \d+ routes/.test(engine), "the rescan toast reports a count that only the sample had");
});
