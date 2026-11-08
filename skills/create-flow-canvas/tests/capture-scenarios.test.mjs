/* The project-owned scenarios file, and what the capture allows on the wire.
   Run:  node --test skills/create-flow-canvas/tests/capture-scenarios.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { readScenarios, stateCookies, slug, isLocalBase } from "../scripts/lib/scenarios.mjs";
import { networkDecision } from "../scripts/lib/network.mjs";

const screen = (over) => ({ id: "home", route: "/", url: "/", states: [{ name: "default", persona: "pro" }], ...over });

test("a valid file is returned, with cookie names defaulted", () => {
  const read = readScenarios({ screens: [screen()] });
  assert.deepEqual(read.cookies, { persona: "flow-persona", scenario: "flow-scenario" });
  assert.equal(read.screens[0].id, "home");
});

test("every problem is named at once", () => {
  assert.throws(
    () => readScenarios({ screens: [screen({ id: "../evil" }), screen({ id: "b", url: "https://x.test/" }), screen({ id: "c", states: [] })] }),
    (error) => /\.\.\/evil/.test(error.message) && /b.*url/.test(error.message) && /c.*state/.test(error.message),
  );
});

test("a file with no screens is refused", () => {
  assert.throws(() => readScenarios({}), /screens/);
});

test("two screens may not share an id, nor two states a file name", () => {
  assert.throws(() => readScenarios({ screens: [screen(), screen()] }), /home.*more than once/);
  assert.throws(
    () => readScenarios({ screens: [screen({ states: [{ name: "a b" }, { name: "a_b" }] })] }),
    /a_b/,
  );
});

test("a step must be a known action", () => {
  const steps = [{ click: "button" }, { hover: "a" }, { fill: "input", value: "x" }, { press: "Escape" }, { wait: 100 }, { waitFor: ".dialog" }];
  assert.doesNotThrow(() => readScenarios({ screens: [screen({ states: [{ name: "open", steps }] })] }));
  assert.throws(() => readScenarios({ screens: [screen({ states: [{ name: "open", steps: [{ tap: "b" }] }] })] }), /step 1/);
});

test("a step needs something to act on", () => {
  const withStep = (step) => ({ screens: [screen({ states: [{ name: "open", steps: [step] }] })] });
  assert.throws(() => readScenarios(withStep({ click: "" })), /step 1/);
  assert.throws(() => readScenarios(withStep("click")), /step 1/);
  assert.throws(() => readScenarios(withStep({ wait: "soon" })), /step 1/);
});

test("a state may be limited to the devices where its control exists", () => {
  const states = [{ name: "menu", devices: ["desktop"] }];
  assert.doesNotThrow(() => readScenarios({ screens: [screen({ states })] }));
  assert.throws(() => readScenarios({ screens: [screen({ states: [{ name: "menu", devices: ["watch"] }] })] }), /watch/);
});

test("a state's persona and scenario become cookies under the project's names", () => {
  assert.deepEqual(
    stateCookies({ persona: "pro", scenario: "empty" }, { persona: "who", scenario: "what" }),
    [{ name: "who", value: "pro" }, { name: "what", value: "empty" }],
  );
  assert.deepEqual(stateCookies({ name: "plain" }, { persona: "who", scenario: "what" }), []);
});

test("state names become file-safe", () => {
  assert.equal(slug("signed in"), "signed_in");
});

test("only a server on this machine may be captured", () => {
  assert.equal(isLocalBase("http://localhost:3210"), true);
  assert.equal(isLocalBase("http://127.0.0.1:3000"), true);
  assert.equal(isLocalBase("http://[::1]:3000"), true);
  assert.equal(isLocalBase("https://app.example.com"), false);
  assert.equal(isLocalBase("http://localhost.example.com"), false);
});

const APP = "http://localhost:3210";
const req = (url, method = "GET", resourceType = "fetch") => ({ url, method, resourceType });

test("the app under capture may do anything", () => {
  assert.equal(networkDecision(req(`${APP}/api/x`, "POST"), APP), "app");
});

test("inline data urls are not network", () => {
  assert.equal(networkDecision(req("data:image/png;base64,AA"), APP), "app");
  assert.equal(networkDecision(req("blob:http://localhost:3210/1"), APP), "app");
});

test("outside hosts may serve GET stylesheets and fonts, and nothing else", () => {
  assert.equal(networkDecision(req("https://fonts.test/a.css", "GET", "stylesheet"), APP), "asset");
  assert.equal(networkDecision(req("https://fonts.test/a.woff2", "GET", "font"), APP), "asset");
  assert.equal(networkDecision(req("https://fonts.test/a.css", "POST", "stylesheet"), APP), "block");
  assert.equal(networkDecision(req("https://api.test/me", "GET", "fetch"), APP), "block");
  assert.equal(networkDecision(req("https://cdn.test/a.png", "GET", "image"), APP), "block");
});

test("another port on localhost is an outside host", () => {
  assert.equal(networkDecision(req("http://localhost:9999/x"), APP), "block");
});
