#!/usr/bin/env node
/* Pixel-diffs an assembled canvas against the reference screenshots from capture.mjs. Each screen is rendered the way
   the canvas renders it: its markup and the scan's styles in an iframe-like document, no scripts, no network.

     node fidelity.mjs --canvas flows.html --refs .flow-canvas/capture [--out fidelity.json] [--max-pct 1]

   Exits 1 when a screen differs by more than --max-pct, or a reference is missing. A match says only that the snapshot
   equals the running copy: if the mock was wrong, both are wrong in the same way. Read report.json from the capture too. */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadPlaywright, launchBrowser } from "./lib/playwright.mjs";
import { slug } from "./lib/scenarios.mjs";
import { diffPixels } from "./lib/pixels.mjs";

/* width, height and the classes the engine's FlowDevice gives each frame */
const DEVICES = { mobile: [390, 844, "dm"], tablet: [768, 1024, "dw dt"], desktop: [1200, 772, "dw dd"] };

function readBlock(html, pattern, what) {
  const match = html.match(pattern);
  if (!match) throw new Error(`the canvas has no ${what} block`);
  return match[1];
}

/* mirrors screenDocument in assets/flow-canvas.html */
const screenDocument = (markup, css, icons, cls) => `<!doctype html><html><head><meta charset="utf-8">
<style>html{width:100%;height:100%;margin:0;overflow:hidden;overscroll-behavior:none}
body{width:100%;height:100%;margin:0;position:relative;display:flex;flex-direction:column;font-size:12px;overflow:auto;overscroll-behavior:contain}</style>
<style>${css}</style></head><body class="phone ${cls}"><svg width="0" height="0" style="position:absolute" aria-hidden="true">${icons}</svg>${markup}</body></html>`;

async function comparePngs(page, reference, snapshot) {
  return page.evaluate(async ([a, b]) => {
    const load = (data) => new Promise((done, fail) => {
      const image = new Image();
      image.onload = () => done(image);
      image.onerror = () => fail(new Error("not a readable PNG"));
      image.src = `data:image/png;base64,${data}`;
    });
    const [ref, snap] = await Promise.all([load(a), load(b)]);
    if (ref.width !== snap.width || ref.height !== snap.height) return { pct: 100, minY: 0, maxY: ref.height - 1, note: "sizes differ" };
    const pixels = (image) => {
      const canvas = document.createElement("canvas");
      canvas.width = image.width;
      canvas.height = image.height;
      const context = canvas.getContext("2d");
      context.drawImage(image, 0, 0);
      return context.getImageData(0, 0, image.width, image.height).data;
    };
    return window.diffPixels(pixels(ref), pixels(snap), ref.width, ref.height);
  }, [reference.toString("base64"), snapshot.toString("base64")]);
}

async function main() {
  const { values } = parseArgs({ options: { canvas: { type: "string" }, refs: { type: "string" }, out: { type: "string" }, "max-pct": { type: "string", default: "1" } } });
  if (!values.canvas || !values.refs) throw new Error("usage: fidelity.mjs --canvas file --refs dir [--out file] [--max-pct n]");
  const html = fs.readFileSync(values.canvas, "utf8");
  const scan = JSON.parse(readBlock(html, /<script type="application\/json" id="flow-scan">\s*([\s\S]*?)\s*<\/script>/, "flow-scan"));
  const css = readBlock(html, /<style id="flow-scan-styles"[^>]*>([\s\S]*?)<\/style>/, "flow-scan-styles");
  const maxPct = Number(values["max-pct"]);
  const outFile = values.out ?? path.join(values.refs, "fidelity.json");

  const browser = await launchBrowser(loadPlaywright());
  const rows = [];
  try {
    const comparer = await (await browser.newContext()).newPage();
    await comparer.evaluate(`window.diffPixels = ${diffPixels}`);
    for (const screen of scan.screens) {
      for (const [index, state] of screen.states.entries()) {
        const markupByDevice = index === 0 ? screen.html : state.html;
        if (!markupByDevice) continue; /* a state the scan knows of but could not reach */
        for (const [device, [width, height, cls]] of Object.entries(DEVICES)) {
          const name = `${screen.id}-${slug(state.name)}-${device}`;
          const refFile = path.join(values.refs, `ref-${name}.png`);
          if (!fs.existsSync(refFile) || !markupByDevice[device]) {
            rows.push({ name, missing: true });
            console.log(`${name}: MISSING`);
            continue;
          }
          const context = await browser.newContext({ viewport: { width, height }, javaScriptEnabled: false, deviceScaleFactor: 1, reducedMotion: "reduce", colorScheme: "light" });
          await context.route(/^https?:/, (route) => route.abort()); /* a canvas must stand on its own */
          const page = await context.newPage();
          await page.setContent(screenDocument(markupByDevice[device], css, scan.icons ?? "", cls), { waitUntil: "load" });
          await page.waitForTimeout(400);
          const snapshot = await page.screenshot();
          await context.close();
          fs.writeFileSync(path.join(path.dirname(outFile), `snap-${name}.png`), snapshot);
          const row = { name, ...(await comparePngs(comparer, fs.readFileSync(refFile), snapshot)) };
          rows.push(row);
          console.log(`${name}: ${row.pct}%${row.minY === null ? "" : ` (rows ${row.minY}-${row.maxY})`}`);
        }
      }
    }
  } finally {
    await browser.close();
  }
  fs.writeFileSync(outFile, JSON.stringify(rows, null, 1));
  const failing = rows.filter((row) => row.missing || row.pct > maxPct);
  console.log(`\n${rows.length - failing.length} of ${rows.length} within ${maxPct}%. ${outFile}`);
  if (failing.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
