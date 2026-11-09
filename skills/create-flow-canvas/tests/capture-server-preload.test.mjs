/* The one preload a dev server starts with: network blocked, server clock frozen at the capture's instant, extra
   preloads added by name. Proved in real child processes.
   Run:  node --test skills/create-flow-canvas/tests/capture-server-preload.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import { fileURLToPath } from "node:url";

const scripts = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts");
const preload = path.join(scripts, "server-preload.cjs");
const tempDir = () => fs.mkdtempSync(path.join(os.tmpdir(), "flow-preload-"));

function project(scenarios) {
  const dir = tempDir();
  if (scenarios !== undefined) {
    fs.mkdirSync(path.join(dir, ".flow-canvas"));
    fs.writeFileSync(path.join(dir, ".flow-canvas/scenarios.json"), typeof scenarios === "string" ? scenarios : JSON.stringify(scenarios));
  }
  return dir;
}

function run(code, { cwd = project(), env = {}, nodeOptions = `--require "${preload}"` } = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["-e", code], { cwd, env: { ...process.env, NODE_OPTIONS: nodeOptions, ...env }, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve({ stdout: stdout.trim(), stderr });
    });
  });
}
const NOW = "2026-11-09T12:33:00.000Z";
const iso = `console.log(new Date().toISOString())`;

test("the server's clock stands at the scenarios' freeze.now", async () => {
  const { stdout } = await run(iso, { cwd: project({ freeze: { now: NOW } }) });
  assert.equal(stdout, NOW);
});

test("the scenarios file is found from a folder below it", async () => {
  const cwd = project({ freeze: { now: NOW } });
  fs.mkdirSync(path.join(cwd, "src/nested"), { recursive: true });
  assert.equal((await run(iso, { cwd: path.join(cwd, "src/nested") })).stdout, NOW);
});

test("before any scenarios exist the server uses capture's own default instant", async () => {
  const captured = /now: "([^"]+)"/.exec(fs.readFileSync(path.join(scripts, "capture.mjs"), "utf8"))[1];
  assert.equal((await run(iso)).stdout, captured);
});

test("freeze: false leaves the real clock alone", async () => {
  const { stdout } = await run(`console.log(new Date().getFullYear() === ${new Date().getFullYear()})`, { cwd: project({ freeze: false }) });
  assert.equal(stdout, "true");
});

test('"clock": "run" still freezes the server, which only needs to agree on the starting instant', async () => {
  const { stdout } = await run(iso, { cwd: project({ freeze: { now: NOW, clock: "run" } }) });
  assert.equal(stdout, NOW);
});

test("a frozen Date behaves like Date in every way of asking it", async () => {
  const code = `console.log(JSON.stringify([Date.now(), /2026/.test(Date()), new Date(0).getTime(), new Date() instanceof Date, typeof Date.UTC(2000, 0), new (class D extends Date {})().getTime()]))`;
  const at = Date.parse(NOW);
  assert.deepEqual(JSON.parse((await run(code, { cwd: project({ freeze: { now: NOW } }) })).stdout), [at, true, 0, true, "number", at]);
});

test("random numbers on the server stay random: ids and tokens must not repeat", async () => {
  const { stdout } = await run(`console.log(Math.random() !== Math.random())`, { cwd: project({ freeze: { now: NOW } }) });
  assert.equal(stdout, "true");
});

test("an unreadable scenarios file is reported and the default instant is used", async () => {
  const { stdout, stderr } = await run(iso, { cwd: project("{ nope") });
  assert.match(stdout, /^2026-01-15/);
  assert.match(stderr, /scenarios\.json/);
});

test("the network stays blocked through it", async () => {
  const { stdout } = await run(`fetch("https://example.com/").catch((e) => console.log(e.cause?.code))`);
  assert.equal(stdout, "EFLOWBLOCKED");
});

test("FLOW_PRELOAD adds preloads by path, comma separated, relative to where the server starts", async () => {
  const cwd = project();
  fs.writeFileSync(path.join(cwd, "one.cjs"), `globalThis.one = 1;`);
  const other = path.join(tempDir(), "two.cjs");
  fs.writeFileSync(other, `globalThis.two = 2;`);
  const { stdout } = await run(`console.log(one + two)`, { cwd, env: { FLOW_PRELOAD: `one.cjs, ${other}` } });
  assert.equal(stdout, "3");
});

test("a FLOW_PRELOAD that does not exist stops the server and names the file", async () => {
  await assert.rejects(run(iso, { env: { FLOW_PRELOAD: "missing.cjs" } }), /missing\.cjs/);
});

test("the documented quoted NODE_OPTIONS works when the skill's path has a space in it", async () => {
  const spaced = path.join(tempDir(), "a folder");
  fs.mkdirSync(spaced);
  for (const file of ["server-preload.cjs", "block-network.cjs"]) fs.copyFileSync(path.join(scripts, file), path.join(spaced, file));
  const { stdout } = await run(iso, { nodeOptions: `--require "${path.join(spaced, "server-preload.cjs")}"` });
  assert.match(stdout, /^2026-01-15/);
});
