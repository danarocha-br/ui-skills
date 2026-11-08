#!/usr/bin/env node
/* Snapshots a running copy of a product, per screen, state and device, driven by the project's scenarios file.

     node capture.mjs http://localhost:3210 [--scenarios .flow-canvas/scenarios.json] [--out .flow-canvas/capture] [--src src]

   Writes capture.json (what the assembler reads), report.json (the same run without the page bodies) and one reference
   screenshot per capture, ref-<screen>-<state>-<device>.png. Exits 1 if any capture failed. Run it against the throwaway
   copy only; start that copy's server with block-network.cjs (see that file). */
import fs from "node:fs";
import path from "node:path";
import { parseArgs } from "node:util";
import { loadPlaywright, launchBrowser } from "./lib/playwright.mjs";
import { readScenarios, stateCookies, slug, isLocalBase } from "./lib/scenarios.mjs";
import { networkDecision } from "./lib/network.mjs";
import { declaredComponents } from "./lib/components.mjs";
import { freezeClockAndRandom } from "./lib/determinism.mjs";
import { suspectSignals } from "./lib/signals.mjs";
import { pageExpression, clearOverlaysExpression } from "./lib/page.mjs";

const DEVICES = { mobile: [390, 844], tablet: [768, 1024], desktop: [1200, 772] };
const DEFAULTS = {
  freeze: { now: "2026-01-15T12:00:00.000Z", seed: 42 },
  budgets: { item: 150_000, total: 1_500_000 },
  settleMs: 4000,
};
const STEP_TIMEOUT = 10_000;
const AFTER_STEPS_MS = 500;
const SKIP_DIRS = new Set(["node_modules", "dist", "build", "out", "coverage"]);

function sourceComponentNames(dir) {
  const names = new Set();
  (function walk(folder) {
    for (const entry of fs.readdirSync(folder, { withFileTypes: true })) {
      if (entry.name.startsWith(".") || SKIP_DIRS.has(entry.name)) continue;
      const full = path.join(folder, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (/\.[jt]sx$|\.js$/.test(entry.name)) declaredComponents(fs.readFileSync(full, "utf8")).forEach((name) => names.add(name));
    }
  })(dir);
  return [...names];
}

async function runStep(page, step) {
  const options = { timeout: STEP_TIMEOUT };
  if (step.click) await page.click(step.click, options);
  else if (step.hover) await page.hover(step.hover, options);
  else if (step.fill) await page.fill(step.fill, step.value, options);
  else if (step.press) await page.keyboard.press(step.press);
  else if (step.waitFor) await page.waitForSelector(step.waitFor, options);
  else await page.waitForTimeout(step.wait);
}

async function guardNetwork(context, base, tally) {
  const appHost = new URL(base).host;
  const count = (table, host) => { table[host] = (table[host] || 0) + 1; };
  await context.route((url) => url.host !== appHost, (route) => {
    const request = route.request();
    const host = new URL(request.url()).host;
    const decision = networkDecision({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, new URL(base).origin);
    if (decision === "block") {
      count(tally.blocked, host);
      return route.abort();
    }
    count(tally.assets, host);
    return route.continue();
  });
  /* context.route does not see WebSockets. Older Playwright has no routeWebSocket; report that rather than hide it. */
  if (!context.routeWebSocket) return false;
  await context.routeWebSocket((url) => url.host !== appHost, (socket) => {
    count(tally.blocked, new URL(socket.url()).host);
    socket.close();
  });
  return true;
}

async function captureOne(browser, { base, config, screen, state, device, names, outDir, tally }) {
  const [width, height] = DEVICES[device];
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "light", serviceWorkers: "block" });
  try {
    await context.addCookies(stateCookies(state, config.cookies).map((cookie) => ({ ...cookie, url: base })));
    tally.socketsGuarded = await guardNetwork(context, base, tally);
    await context.addInitScript(freezeClockAndRandom, { ...DEFAULTS.freeze, ...config.freeze });
    const page = await context.newPage();
    const pageErrors = [];
    page.on("pageerror", (error) => pageErrors.push(String(error.message).slice(0, 200)));
    await page.goto(base + screen.url, { waitUntil: "load", timeout: 90_000 });
    await page.waitForTimeout(config.settleMs ?? DEFAULTS.settleMs);
    for (const step of state.steps ?? []) await runStep(page, step);
    if (state.steps?.length) await page.waitForTimeout(AFTER_STEPS_MS);
    await page.evaluate("document.fonts.ready.then(() => true)");
    const devOverlayError = await page.evaluate(clearOverlaysExpression);
    await page.screenshot({ path: path.join(outDir, `ref-${screen.id}-${slug(state.name)}-${device}.png`) });
    const { facts, ...capture } = await page.evaluate(pageExpression({ names, budgets: { ...DEFAULTS.budgets, ...config.budgets } }));
    return { ...capture, pageErrors: pageErrors.slice(0, 5), signals: suspectSignals({ ...facts, devOverlayError }) };
  } finally {
    await context.close();
  }
}

function logCapture(id, stateName, device, capture) {
  const notes = [
    capture.pageErrors.length && `page errors: ${capture.pageErrors.length}`,
    capture.signals.length && `suspect: ${capture.signals.map((signal) => `${signal.kind}×${signal.count}`).join(", ")}`,
    capture.components.source === "none" && "no component names",
    capture.inlined.dropped.length && `dropped media: ${capture.inlined.dropped.length}`,
  ].filter(Boolean);
  console.log(`${id} / ${stateName} / ${device}: ${(capture.html.length / 1024) | 0} KB, ${capture.components.tagged} tagged${notes.length ? ` [${notes.join("; ")}]` : ""}`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { scenarios: { type: "string" }, out: { type: "string" }, src: { type: "string" } } });
  const base = positionals[0]?.replace(/\/$/, "");
  if (!base) throw new Error("usage: capture.mjs <base-url> [--scenarios file] [--out dir] [--src dir]");
  if (!isLocalBase(base)) throw new Error(`refusing to capture ${base}: capture only a throwaway copy running on this machine`);
  const scenariosPath = path.resolve(values.scenarios ?? ".flow-canvas/scenarios.json");
  if (!fs.existsSync(scenariosPath)) throw new Error(`no scenarios file at ${scenariosPath}`);
  const projectRoot = path.dirname(path.dirname(scenariosPath));
  const config = readScenarios(JSON.parse(fs.readFileSync(scenariosPath, "utf8")));
  const outDir = path.resolve(values.out ?? path.join(projectRoot, ".flow-canvas/capture"));
  const srcDir = path.resolve(projectRoot, values.src ?? (fs.existsSync(path.join(projectRoot, "src")) ? "src" : "."));
  const names = sourceComponentNames(srcDir);
  fs.mkdirSync(outDir, { recursive: true });

  const browser = await launchBrowser(loadPlaywright());
  const tally = { blocked: {}, assets: {}, socketsGuarded: false };
  const result = { screens: [], blocked: tally.blocked, assets: tally.assets, errors: [] };
  try {
    for (const screen of config.screens) {
      const entry = { ...screen, captures: {} };
      for (const state of screen.states) {
        entry.captures[state.name] = {};
        for (const device of Object.keys(DEVICES)) {
          try {
            const capture = await captureOne(browser, { base, config, screen, state, device, names, outDir, tally });
            entry.captures[state.name][device] = capture;
            logCapture(screen.id, state.name, device, capture);
          } catch (error) {
            result.errors.push({ screen: screen.id, state: state.name, device, message: String(error.message).slice(0, 300) });
            console.error(`FAILED ${screen.id} / ${state.name} / ${device}: ${String(error.message).split("\n")[0]}`);
          }
        }
      }
      result.screens.push(entry);
    }
  } finally {
    await browser.close();
  }
  result.socketsGuarded = tally.socketsGuarded;
  fs.writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(result));
  const report = {
    blocked: result.blocked, assets: result.assets, errors: result.errors, socketsGuarded: result.socketsGuarded,
    captures: result.screens.flatMap((screen) => Object.entries(screen.captures).flatMap(([stateName, devices]) => Object.entries(devices).map(([device, capture]) => ({
      screen: screen.id, state: stateName, device, pageErrors: capture.pageErrors, signals: capture.signals, components: capture.components, inlined: capture.inlined,
    })))),
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const suspect = report.captures.filter((capture) => capture.signals.length || capture.pageErrors.length).length;
  console.log(`\n${report.captures.length} captured, ${result.errors.length} failed, ${suspect} to look at. Blocked: ${JSON.stringify(result.blocked)}. Report: ${path.join(outDir, "report.json")}`);
  if (!result.socketsGuarded) console.log("WARNING: this Playwright cannot intercept WebSockets, so outside ones were not blocked.");
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
