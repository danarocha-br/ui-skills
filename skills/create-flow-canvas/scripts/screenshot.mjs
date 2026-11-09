#!/usr/bin/env node
/* Takes a picture of a finished canvas, so it can be looked at where a file:// page cannot be opened (the in-app
   browser refuses file://, and an eval viewer that treats .html as text shows source). Writes one PNG of the canvas as
   it opens, and with --device one of each device when the canvas has the device switch.

     node screenshot.mjs [--canvas .flow-canvas/flow-canvas.html] [--out .flow-canvas/canvas.png] [--width 1600] [--height 1000] [--wait 4000]

   It opens the file in headless Chrome, waits for the canvas to settle, reports console errors, and exits 1 on any. */
import fs from "node:fs";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { parseArgs } from "node:util";
import { loadPlaywright, launchBrowser } from "./lib/playwright.mjs";

async function main() {
  const { values } = parseArgs({ options: { canvas: { type: "string" }, out: { type: "string" }, width: { type: "string" }, height: { type: "string" }, wait: { type: "string" } } });
  const canvas = path.resolve(values.canvas ?? ".flow-canvas/flow-canvas.html");
  if (!fs.existsSync(canvas)) throw new Error(`no canvas at ${canvas}`);
  const out = path.resolve(values.out ?? path.join(path.dirname(canvas), "canvas.png"));
  const width = Number(values.width ?? 1600), height = Number(values.height ?? 1000), wait = Number(values.wait ?? 4000);
  if (![width, height, wait].every(Number.isFinite)) throw new Error("--width, --height and --wait must be numbers");
  const browser = await launchBrowser(loadPlaywright());
  const problems = [];
  try {
    const context = await browser.newContext({ viewport: { width, height }, deviceScaleFactor: 1 });
    await context.route(/^https?:/, (route) => route.abort()); /* a canvas stands on its own; only Google Fonts for its own chrome is lost */
    const page = await context.newPage();
    page.on("pageerror", (error) => problems.push(String(error.message).slice(0, 200)));
    page.on("console", (message) => { if (message.type() === "error" && !/Failed to load resource|ERR_FAILED|net::/.test(message.text())) problems.push(message.text().slice(0, 200)); });
    await page.goto(pathToFileURL(canvas).href, { waitUntil: "load" });
    await page.waitForTimeout(wait);
    fs.mkdirSync(path.dirname(out), { recursive: true });
    await page.screenshot({ path: out });
  } finally {
    await browser.close();
  }
  console.log(`Wrote ${out}${problems.length ? `\nconsole errors:\n  ${problems.join("\n  ")}` : ""}`);
  if (problems.length) process.exitCode = 1;
}

main().catch((error) => { console.error(error.message); process.exit(1); });
