#!/usr/bin/env node
/* Snapshots a running copy of a product, per screen, state and device, driven by the project's scenarios file.

     node capture.mjs http://localhost:3210 [--scenarios .flow-canvas/scenarios.json] [--out .flow-canvas/capture] [--src src]
                      [--only id,id] [--timeout ms] [--no-warm]

   --only captures just those screens and keeps the rest from the last capture.json (a screen is replaced whole, so
   a state you removed from the scenarios goes with it). --timeout is the page-load limit, 90000 by default, or
   loadTimeoutMs in the scenarios. Before capturing, each URL is requested once so a dev server compiles a cold route
   outside the timeout; --no-warm skips that. A browser that dies mid-run is relaunched and the capture retried once.

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
import { suspectSignals, acknowledged, identicalStates, redirectOf } from "./lib/signals.mjs";
import { mergeResume, isBrowserGone } from "./lib/resume.mjs";
import { pageExpression, clearOverlaysExpression } from "./lib/page.mjs";
import { DEVICES } from "./lib/devices.mjs";

const DEFAULTS = {
  freeze: { now: "2026-01-15T12:00:00.000Z", seed: 42 },
  budgets: { item: 150_000, total: 1_500_000 },
  settleMs: 4000,
};
const STEP_TIMEOUT = 10_000;
const LOAD_TIMEOUT = 90_000;
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
  /* Playwright routes only the first URL of a redirect, so an app redirect to elsewhere can only be reported */
  context.on("request", (request) => {
    if (!request.redirectedFrom()) return;
    const decision = networkDecision({ url: request.url(), method: request.method(), resourceType: request.resourceType() }, new URL(base).origin);
    if (decision === "block") count(tally.escaped, new URL(request.url()).host);
  });
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

async function captureOne(browser, { base, config, screen, state, device, names, outDir, tally, loadTimeout }) {
  const { width, height } = DEVICES[device];
  const pageErrors = new Set();
  const context = await browser.newContext({ viewport: { width, height }, reducedMotion: "reduce", deviceScaleFactor: 1, colorScheme: "light", serviceWorkers: "block" });
  try {
    await context.addCookies(stateCookies(state, config.cookies).map((cookie) => ({ ...cookie, url: base })));
    tally.socketsGuarded = await guardNetwork(context, base, tally);
    if (config.freeze !== false) await context.addInitScript(freezeClockAndRandom, { ...DEFAULTS.freeze, ...config.freeze });
    const page = await context.newPage();
    page.on("pageerror", (error) => pageErrors.add(String(error.message).slice(0, 200)));
    await page.goto(base + screen.url, { waitUntil: "load", timeout: loadTimeout });
    await page.waitForTimeout(state.settleMs ?? config.settleMs ?? DEFAULTS.settleMs);
    /* a client-side redirect (a router.push after load) leaves a page that is not the one asked for, with no error */
    const redirect = redirectOf(screen.url, page.url());
    for (const step of state.steps ?? []) await runStep(page, step);
    if (state.steps?.length) await page.waitForTimeout(AFTER_STEPS_MS);
    await page.evaluate("document.fonts.ready.then(() => true)");
    const devOverlayError = await page.evaluate(clearOverlaysExpression);
    await page.screenshot({ path: path.join(outDir, `ref-${screen.id}-${slug(state.name)}-${device}.png`) });
    const { facts, ...capture } = await page.evaluate(pageExpression({ names, budgets: { ...DEFAULTS.budgets, ...config.budgets } }));
    return { ...capture, finalUrl: redirect ? redirect.final : screen.url, pageErrors: [...pageErrors], signals: acknowledged(suspectSignals({ ...facts, devOverlayError, redirect }), state.acknowledge) };
  } catch (error) {
    error.pageErrors = [...pageErrors];
    throw error;
  } finally {
    await context.close();
  }
}

function logCapture(id, stateName, device, capture) {
  const notes = [
    capture.pageErrors.length && `page errors: ${capture.pageErrors.length}`,
    capture.signals.length && `suspect: ${capture.signals.map((signal) => `${signal.kind}×${signal.count}`).join(", ")}`,
    !capture.components.tagged && "no component names",
    capture.inlined.dropped.length && `dropped media: ${capture.inlined.dropped.length}`,
  ].filter(Boolean);
  console.log(`${id} / ${stateName} / ${device}: ${(capture.html.length / 1024) | 0} KB, ${capture.components.tagged} tagged${notes.length ? ` [${notes.join("; ")}]` : ""}`);
}

async function main() {
  const { values, positionals } = parseArgs({ allowPositionals: true, options: { scenarios: { type: "string" }, out: { type: "string" }, src: { type: "string" }, only: { type: "string" }, timeout: { type: "string" }, "no-warm": { type: "boolean" } } });
  const base = positionals[0]?.replace(/\/$/, "");
  if (!base) throw new Error("usage: capture.mjs <base-url> [--scenarios file] [--out dir] [--src dir]");
  if (!isLocalBase(base)) throw new Error(`refusing to capture ${base}: capture only a throwaway copy running on this machine`);
  const scenariosPath = path.resolve(values.scenarios ?? ".flow-canvas/scenarios.json");
  if (!fs.existsSync(scenariosPath)) throw new Error(`no scenarios file at ${scenariosPath}`);
  const scenariosDir = path.dirname(scenariosPath);
  const projectRoot = path.basename(scenariosDir) === ".flow-canvas" ? path.dirname(scenariosDir) : scenariosDir;
  const config = readScenarios(JSON.parse(fs.readFileSync(scenariosPath, "utf8")));
  const outDir = path.resolve(values.out ?? path.join(projectRoot, ".flow-canvas/capture"));
  const srcDir = values.src ? path.resolve(values.src) : fs.existsSync(path.join(projectRoot, "src")) ? path.join(projectRoot, "src") : projectRoot;
  const names = sourceComponentNames(srcDir);
  fs.mkdirSync(outDir, { recursive: true });

  const only = values.only ? values.only.split(",").map((id) => id.trim()).filter(Boolean) : null;
  const unknown = (only ?? []).filter((id) => !config.screens.some((screen) => screen.id === id));
  if (unknown.length) throw new Error(`--only names ${unknown.join(", ")}, which the scenarios do not list`);
  const loadTimeout = values.timeout ? Number(values.timeout) : config.loadTimeoutMs ?? LOAD_TIMEOUT;
  if (!(loadTimeout > 0)) throw new Error(`--timeout must be a number of milliseconds, got "${values.timeout}"`);
  const todo = only ? config.screens.filter((screen) => only.includes(screen.id)) : config.screens;

  const playwright = loadPlaywright();
  let browser = await launchBrowser(playwright);
  const tally = { blocked: {}, assets: {}, escaped: {}, socketsGuarded: false };
  const result = { screens: [], blocked: tally.blocked, assets: tally.assets, escaped: tally.escaped, errors: [] };
  if (!values["no-warm"]) {
    /* a cold dev-server route can take minutes to compile; ask once, patiently, so the capture's own limit is for the page */
    for (const screen of todo) {
      const began = Date.now();
      await fetch(base + screen.url, { redirect: "manual", signal: AbortSignal.timeout(300_000) }).then((r) => r.arrayBuffer()).catch(() => null);
      const took = Date.now() - began;
      if (took > 5000) console.log(`warmed ${screen.url} (${Math.round(took / 1000)}s)`);
    }
  }
  const captureWithRetry = async (args) => {
    try {
      return await captureOne(browser, args);
    } catch (error) {
      if (!isBrowserGone(error)) throw error;
      console.error("the browser closed during a capture: relaunching it and trying once more");
      await browser.close().catch(() => null);
      browser = await launchBrowser(playwright);
      return await captureOne(browser, args);
    }
  };
  try {
    for (const screen of todo) {
      const entry = { ...screen, captures: {} };
      for (const state of screen.states) {
        entry.captures[state.name] = {};
        for (const device of state.devices ?? Object.keys(DEVICES)) {
          try {
            const capture = await captureWithRetry({ base, config, screen, state, device, names, outDir, tally, loadTimeout });
            entry.captures[state.name][device] = capture;
            logCapture(screen.id, state.name, device, capture);
          } catch (error) {
            result.errors.push({ screen: screen.id, state: state.name, device, message: String(error.message).slice(0, 300), pageErrors: error.pageErrors ?? [] });
            console.error(`FAILED ${screen.id} / ${state.name} / ${device}: ${String(error.message).split("\n")[0]}`);
          }
        }
      }
      entry.warnings = identicalStates(screen.states, entry.captures);
      for (const w of entry.warnings) console.log(`WARNING ${screen.id}: "${w.states.join('" and "')}" ask for different personas or scenarios but render the same on ${w.devices.join(", ")}. Is the mock reading its cookie?`);
      result.screens.push(entry);
    }
  } finally {
    await browser.close().catch(() => null);
  }
  result.socketsGuarded = tally.socketsGuarded;
  if (only) {
    const capturePath = path.join(outDir, "capture.json");
    let previous = null;
    try { previous = JSON.parse(fs.readFileSync(capturePath, "utf8")); } catch { /* nothing to resume from */ }
    Object.assign(result, mergeResume(previous, result, only, config.screens.map((screen) => screen.id)));
  }
  fs.writeFileSync(path.join(outDir, "capture.json"), JSON.stringify(result));
  const report = {
    blocked: result.blocked, assets: result.assets, escaped: result.escaped, errors: result.errors, socketsGuarded: result.socketsGuarded,
    warnings: result.screens.flatMap((screen) => (screen.warnings ?? []).map((w) => ({ screen: screen.id, ...w }))),
    captures: result.screens.flatMap((screen) => Object.entries(screen.captures).flatMap(([stateName, devices]) => Object.entries(devices).map(([device, capture]) => ({
      screen: screen.id, state: stateName, device, finalUrl: capture.finalUrl, pageErrors: capture.pageErrors, signals: capture.signals, components: capture.components, inlined: capture.inlined,
    })))),
  };
  fs.writeFileSync(path.join(outDir, "report.json"), JSON.stringify(report, null, 1));
  const suspect = report.captures.filter((capture) => capture.signals.length || capture.pageErrors.length).length;
  console.log(`\n${report.captures.length} captured, ${result.errors.length} failed, ${suspect} to look at. Blocked: ${JSON.stringify(result.blocked)}. Report: ${path.join(outDir, "report.json")}`);
  if (Object.keys(result.escaped).length) console.log(`WARNING: redirects reached outside hosts: ${JSON.stringify(result.escaped)}. Mock the route that redirects.`);
  if (!result.socketsGuarded) console.log("WARNING: this Playwright cannot intercept WebSockets, so outside ones were not blocked.");
  if (result.errors.length) process.exitCode = 1;
}

main().catch((error) => {
  console.error(error.message);
  process.exit(1);
});
