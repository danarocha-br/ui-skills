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
const productCss = html.match(/<style id="flow-scan-styles"[^>]*>([\s\S]*?)<\/style>/)[1];
const canvasCss = html.slice(html.indexOf("<style>"), html.indexOf('<style id="flow-scan-styles"'));
const classesIn = (css) => new Set([...css.replace(/\/\*[\s\S]*?\*\//g, "").matchAll(/\.([a-zA-Z][\w-]*)/g)].map((m) => m[1]));

test("the product's colour and display-font tokens belong to the replaceable styles", () => {
  const tokens = [...new Set([...productCss.matchAll(/var\((--[\w-]+)/g)].map((m) => m[1]))]
    .filter((name) => !["--sans", "--mono"].includes(name)); // both surfaces have their own body and code fonts
  assert.ok(tokens.length > 0, "the sample exercises product tokens");
  for (const name of tokens) {
    assert.ok(productCss.includes(name + ":"), `${name} is not supplied by the scan`);
    assert.ok(!canvasCss.includes(name), `${name} leaks into the shell`);
  }
});

test("every icon the sample renders is supplied by the scan, outside the shell's sprite", () => {
  const renders = scan.screens.flatMap((s) => [s.html, ...s.states.map((st) => st.html || {})]);
  const icons = [...new Set(renders.flatMap((render) => Object.values(render))
    .flatMap((markup) => [...markup.matchAll(/href="#([^"]+)"/g)].map((m) => m[1])))];
  const shell = html.replace(/<script\b[\s\S]*?<\/script>/g, "");
  assert.ok(icons.length > 0, "the sample exercises SVG icons");
  for (const id of icons) {
    assert.ok((scan.icons || "").includes(`id="${id}"`), `${id} is missing from the scan`);
    assert.ok(!shell.includes(`id="${id}"`), `${id} leaks into the shell's sprite`);
  }
});

test("the product supplies its own reset and font import without depending on the shell", () => {
  assert.ok(!/\n\s*\*\s*\{/.test(canvasCss), "the shell's reset reaches into every product element");
  assert.ok(/:where\(\.phone, \.phone \*\)/.test(productCss), "the replaceable product styles supply their reset");
  assert.ok(productCss.includes("Fraunces"), "the sample supplies its display font");
  assert.ok(!html.slice(0, html.indexOf('<style id="flow-scan-styles"')).includes("Fraunces"), "the shell imports the product's font");
});

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

/* Scanned text enters markup only through FlowMarkup. This reads the page script's templates: a scanned field
   (a route, a name, a file, ...) or an id put into an attribute must go through esc(), not be written as it is. */
const pageScript = [...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0];
const SCANNED_FIELD = /(^|\.)(route|meta|name|file|component|source|note|title|body|who|text|label|sub)$/;
const placeholders = [...pageScript.matchAll(/\$\{\s*([^{}]*?)\s*\}/g)].map((m) => {
  const line = pageScript.slice(pageScript.lastIndexOf("\n", m.index) + 1, pageScript.indexOf("\n", m.index));
  return { expr: m[1], line, inAttr: pageScript.slice(m.index - 2, m.index) === '="' && pageScript[m.index + m[0].length] === '"' };
});
/* text sinks that are not markup (toast and textContent), and the device's own label, which no scan writes */
const isText = ({ line, expr }) => /toast\(|textContent/.test(line) || expr === "DEV.label";

test("the page never puts a scanned field into markup as it is", () => {
  const raw = placeholders.filter((p) => /^[\w.]+$/.test(p.expr) && SCANNED_FIELD.test(p.expr) && !isText(p));
  assert.deepEqual(raw.map((p) => p.expr), []);
});

test("the page never puts an id into an attribute as it is", () => {
  const plain = /^(CE|W|H|i|n|at|DEV\.cls|d\.icon|r\.\w+)$/; /* numbers and the page's own names */
  const raw = placeholders.filter((p) => p.inAttr && /^[\w.]+$/.test(p.expr) && !plain.test(p.expr) && !p.line.includes("html`"));
  assert.deepEqual(raw.map((p) => p.expr), []);
});

test("the page names the component being hovered through esc()", () => {
  assert.ok(pageScript.includes("<b>${esc(c)}</b>"));
  assert.ok(!pageScript.includes("<b>${c}</b>"));
});
