/* The Node preload that keeps the dev server off the network, proved by loading it into a real child process.
   Run:  node --test skills/create-flow-canvas/tests/capture-block-network.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createServer } from "node:http";
import path from "node:path";
import { fileURLToPath } from "node:url";

const preload = path.join(path.dirname(fileURLToPath(import.meta.url)), "../scripts/block-network.cjs");

/* Runs `code` in a child with the preload; the code prints a single JSON line. */
function inChild(code, env = {}) {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, ["-r", preload, "-e", code], { env: { ...process.env, ...env }, timeout: 20000 }, (error, stdout, stderr) => {
      if (error) reject(new Error(`${error.message}\n${stderr}`));
      else resolve({ result: JSON.parse(stdout.trim().split("\n").pop()), stderr });
    });
  });
}

const httpGet = (url) => `
  const mod = require(${JSON.stringify(url)}.startsWith("https") ? "https" : "http");
  mod.get(${JSON.stringify(url)}, (r) => { r.resume(); console.log(JSON.stringify({ status: r.statusCode })); })
    .on("error", (e) => console.log(JSON.stringify({ code: e.code })));`;

const onLocalServer = async (run) => {
  const server = createServer((_, res) => res.end("ok"));
  await new Promise((r) => server.listen(0, "127.0.0.1", r));
  try {
    return await run(server.address().port);
  } finally {
    server.close();
  }
};

test("an outbound http request is refused with a recognisable error", async () => {
  const { result, stderr } = await inChild(httpGet("http://example.com/"));
  assert.equal(result.code, "EFLOWBLOCKED");
  assert.match(stderr, /example\.com/);
});

test("https is refused too", async () => {
  const { result } = await inChild(httpGet("https://example.com/"));
  assert.equal(result.code, "EFLOWBLOCKED");
});

test("fetch is refused too", async () => {
  const { result } = await inChild(`fetch("https://example.com/").catch((e) => console.log(JSON.stringify({ code: e.cause?.code })))`);
  assert.equal(result.code, "EFLOWBLOCKED");
});

test("a raw socket is refused too", async () => {
  const { result } = await inChild(`require("net").connect(443, "example.com").on("error", (e) => console.log(JSON.stringify({ code: e.code })))`);
  assert.equal(result.code, "EFLOWBLOCKED");
});

test("requests to this machine still work", async () => {
  await onLocalServer(async (port) => {
    const { result } = await inChild(httpGet(`http://127.0.0.1:${port}/`));
    assert.equal(result.status, 200);
  });
});

test("a host named in FLOW_ALLOW_HOSTS is let through the guard", async () => {
  /* `.invalid` never resolves, so getting past the guard shows up as a DNS failure, with no real traffic */
  const { result } = await inChild(httpGet("http://allowed.invalid/"), { FLOW_ALLOW_HOSTS: "allowed.invalid" });
  assert.notEqual(result.code, "EFLOWBLOCKED");
});
