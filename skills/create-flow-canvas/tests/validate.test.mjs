/* validate.mjs reads a finished canvas the way the page does (with the canvas's own FlowScan) and says what is
   wrong with it before anyone opens it. The seam is validate(html, { budgets }) -> { errors, warnings }.
   Run:  node --test skills/create-flow-canvas/tests/validate.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import { fileURLToPath } from "node:url";
import { assemble } from "../scripts/assemble.mjs";
import { validate } from "../scripts/validate.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(here, "../assets/flow-canvas.html"), "utf8");
const cap = (html) => Object.fromEntries(["mobile", "tablet", "desktop"].map((d) => [d, { html, rootCls: "", bodyCls: "", bg: "#fff", color: "#000", font: "x", fs: "16px", families: [], links: [{ href: "/b", text: "Go" }], title: "", sheets: [] }]));
const capture = { screens: [
  { id: "a", route: "/", url: "/", states: [{ name: "default" }], captures: { default: cap('<a data-flow-href="/b">Go</a>') } },
  { id: "b", route: "/b", url: "/b", states: [{ name: "default" }], captures: { default: cap("<p>b</p>") } },
], blocked: {}, assets: {}, errors: [] };
const flows = { product: { id: "p", name: "P" }, screens: [{ id: "a", name: "A", file: "a.tsx" }, { id: "b", name: "B", file: "b.tsx" }], groups: [{ title: "Flow", screens: ["a", "b"] }] };
const good = async () => (await assemble({ capture, flows, template, fetchBytes: async () => null })).html;
const SCAN = /(<script type="application\/json" id="flow-scan">)([\s\S]*?)(<\/script>)/;
const edit = (html, fn) => html.replace(SCAN, (m, a, body, z) => { const scan = JSON.parse(body); fn(scan); return a + JSON.stringify(scan).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--") + z; });
const errorsOf = (html, opts) => validate(html, opts).errors.join("\n");

test("a canvas assembled from a consistent capture is valid", async () => {
  const r = validate(await good());
  assert.deepEqual([...r.errors], []);
  assert.equal(r.stats.screens, 2);
});

test("the real sample canvas is valid too", () => {
  assert.deepEqual([...validate(template).errors], []);
});

test("a scan that is not JSON is named", async () => {
  const html = (await good()).replace(SCAN, "$1{ nope$3");
  assert.match(errorsOf(html), /flow-scan.*JSON/i);
});

test("what the page would report as a problem is an error here", async () => {
  const html = edit(await good(), (s) => s.groups[0].screens.push("ghost"));
  assert.match(errorsOf(html), /ghost/);
});

test("duplicate ids reject the scan, and the error says so", async () => {
  const html = edit(await good(), (s) => { s.screens[1].id = s.screens[0].id; });
  assert.match(errorsOf(html), /scan was rejected|duplicate|more than once|twice/i);
});

test("a route with no render on any device and no placeholder reason is an error naming it", async () => {
  const html = edit(await good(), (s) => { s.screens[1].html = {}; });
  assert.match(errorsOf(html), /\/b[\s\S]*no frame|no frame[\s\S]*\/b/);
});

test("a screen that could not render passes when it says why", async () => {
  const html = edit(await good(), (s) => { s.screens[1].html = {}; s.screens[1].unrendered = "needs a session"; });
  assert.deepEqual([...validate(html).errors], []);
});

test("a render missing on one device is a warning, not an error", async () => {
  const html = edit(await good(), (s) => { s.screens[1].html.tablet = ""; });
  const r = validate(html);
  assert.deepEqual([...r.errors], []);
  assert.match(r.warnings.join("\n"), /tablet/);
});

test("a button that goes to a screen the scan does not have is an error", async () => {
  const html = edit(await good(), (s) => { s.screens[0].html.desktop = '<button data-go="nowhere">x</button>'; });
  assert.match(errorsOf(html), /data-go="nowhere"/);
});

test("a button that goes to a real screen with no connector to it is an error", async () => {
  const html = edit(await good(), (s) => { s.links = []; });
  assert.match(errorsOf(html), /data-go="b"[\s\S]*connector/);
});

test("a connector to or from a screen that is not there is an error", async () => {
  const html = edit(await good(), (s) => { s.links[0].to = "gone"; });
  assert.match(errorsOf(html), /gone/);
});

test("a canvas over its file budget fails with both sizes", async () => {
  const html = await good();
  const r = errorsOf(html, { budgets: { fileBytes: 1000 } });
  assert.match(r, /over budget|over its budget/i);
  assert.match(r, /1000/);
});

test("product styles that lost media=\"not all\" would restyle the canvas, so that is an error", async () => {
  const html = (await good()).replace('<style id="flow-scan-styles" media="not all">', '<style id="flow-scan-styles">');
  assert.match(errorsOf(html), /media/);
});

test("a raw <!-- in the scan is an error, and a raw </script that ends the block early shows as broken JSON", async () => {
  const html = await good();
  assert.match(errorsOf(html.replace(SCAN, (m, a, body, z) => a + body.replace('"name":"A"', '"name":"A<!--"') + z)), /<!--/);
  assert.match(errorsOf(html.replace(SCAN, (m, a, body, z) => a + body.replace('"name":"A"', '"name":"A</script>"') + z)), /JSON/);
});

test("a file that is not a flow canvas says so", () => {
  assert.match(errorsOf("<html></html>"), /not a flow canvas|flow-scan/);
});

test("a size limit that is not a number is refused, not silently ignored", async () => {
  const { stdout } = { stdout: "" };
  const { spawnSync } = await import("node:child_process");
  const file = path.join(os.tmpdir(), `flow-validate-${process.pid}.html`);
  fs.writeFileSync(file, await good());
  try {
    const r = spawnSync(process.execPath, [path.join(here, "../scripts/validate.mjs"), file, "--max-bytes"], { encoding: "utf8" });
    assert.equal(r.status, 1);
    assert.match(r.stderr, /max-bytes/);
  } finally { fs.rmSync(file, { force: true }); }
  void stdout;
});

test("an id attribute that merely ends in the block's id is not the block", async () => {
  const html = (await good()).replace("<body", '<body data-id="flow-scan"').replace('<script type="application/json" id="flow-scan">', '<script type="application/json" id="flow-scan" >');
  assert.deepEqual([...validate(html).errors], []);
  assert.match(errorsOf((await good()).replace('<script id="flow-scan-behaviour">', '<script data-id="flow-scan-behaviour" id="x">')), /behaviour/);
});

test("the inert styles check does not depend on attribute order", async () => {
  const html = (await good()).replace('<style id="flow-scan-styles" media="not all">', "<style media='not all' id=\"flow-scan-styles\">");
  assert.deepEqual([...validate(html).errors], []);
});

test("a canvas module that never finishes loading fails with a timeout message instead of hanging", async () => {
  const html = (await good()).replace(/(<script id="scan-module">)/, "$1while(true){}\n");
  const t0 = Date.now();
  const e = errorsOf(html, { scriptTimeoutMs: 200 });
  assert.match(e, /did not finish within 200 ?ms/);
  assert.ok(Date.now() - t0 < 5000);
});

test("a state that exists on some devices only is fine: the engine gives the others a placeholder", async () => {
  const html = edit(await good(), (scan) => {
    const a = scan.screens[0];
    a.states = [a.states[0], { name: "dialog", html: { desktop: "<p>d</p>" } }];
  });
  const r = validate(html);
  assert.deepEqual([...r.errors], []);
  assert.deepEqual([...r.warnings].filter((w) => /dialog/.test(w)), [], "no warning for a device-limited state");
});

test("a scan reader that never returns also fails with the timeout message", async () => {
  const html = (await good()).replace(/(function read\(raw[^\n]*\) \{\n)/, "$1while(true){}\n");
  assert.notEqual(html, await good(), "the reader was found to edit");
  assert.match(errorsOf(html, { scriptTimeoutMs: 200 }), /did not finish within 200 ?ms/);
});
