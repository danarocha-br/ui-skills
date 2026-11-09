/* The second check beside pixel diff: a wrong mock renders a screen that matches its own wrong reference, so the
   capture reports what looks like a loading, failed or empty screen.
   Run:  node --test skills/create-flow-canvas/tests/capture-signals.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { suspectSignals } from "../scripts/lib/signals.mjs";

const healthy = { candidates: [], textLength: 900, elementCount: 200, mediaCount: 2, bodyText: "Welcome back", devOverlayError: false };
const kinds = (facts) => suspectSignals({ ...healthy, ...facts }).map((s) => s.kind);
const el = (over) => ({ cls: "", role: "", busy: false, slot: "", type: "", toast: false, text: "", ...over });

test("a healthy screen raises nothing", () => {
  assert.deepEqual(suspectSignals(healthy), []);
});

test("skeleton elements are reported once, with a count", () => {
  const signals = suspectSignals({ ...healthy, candidates: [el({ cls: "skeleton h-4" }), el({ slot: "skeleton" }), el({ cls: "animate-pulse" })] });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, "skeleton");
  assert.equal(signals[0].count, 3);
});

test("spinners are found by class, role and aria-busy", () => {
  assert.deepEqual(kinds({ candidates: [el({ cls: "animate-spin" })] }), ["spinner"]);
  assert.deepEqual(kinds({ candidates: [el({ role: "progressbar" })] }), ["spinner"]);
  assert.deepEqual(kinds({ candidates: [el({ busy: true })] }), ["spinner"]);
  assert.deepEqual(kinds({ candidates: [el({ cls: "lucide lucide-loader-circle" })] }), ["spinner"]);
});

test("a progress bar showing a value is a meter, not something loading", () => {
  assert.deepEqual(kinds({ candidates: [el({ role: "progressbar", determinate: true })] }), []);
});

test("a signal with no text says which element raised it", () => {
  const [signal] = suspectSignals({ ...healthy, candidates: [el({ tag: "div", role: "progressbar", cls: "h-1 bg-muted" })] });
  assert.deepEqual(signal.samples, ['<div role=progressbar class="h-1 bg-muted">']);
});

test("a page served as an error is reported, whatever it looks like", () => {
  const [signal] = suspectSignals({ ...healthy, document: { status: 404, path: "/a/b" } });
  assert.deepEqual(signal, { kind: "http-error", count: 1, samples: ["404 /a/b"] });
  assert.deepEqual(kinds({ document: { status: 200, path: "/a" } }), []);
});

test("a 404 is expected on a screen that stands for the not-found page", () => {
  assert.deepEqual(kinds({ document: { status: 404, path: "/nope" }, route: "(404)" }), []);
  assert.deepEqual(kinds({ document: { status: 500, path: "/nope" }, route: "(404)" }), ["http-error"]);
});

test("client requests answered with a server error are counted, naming the endpoints once each", () => {
  const failedRequests = [{ status: 500, path: "/api/trpc/a" }, { status: 500, path: "/api/trpc/a" }, { status: 503, path: "/api/b" }];
  assert.deepEqual(suspectSignals({ ...healthy, failedRequests }), [{ kind: "failed-requests", count: 3, samples: ["500 /api/trpc/a", "503 /api/b"] }]);
});

test("a Tailwind variant only says what would happen in another state, so it is not a signal", () => {
  assert.deepEqual(kinds({ candidates: [el({ cls: "data-[loading=true]:animate-spin group-hover:animate-pulse" })] }), []);
});

test("error toasts and alerts are reported with their text", () => {
  const signals = suspectSignals({ ...healthy, candidates: [el({ toast: true, type: "error", text: "Missing API key" })] });
  assert.deepEqual(signals, [{ kind: "error-toast", count: 1, samples: ["Missing API key"] }]);
  assert.deepEqual(kinds({ candidates: [el({ role: "alert", text: "Could not load" })] }), ["error-toast"]);
  assert.deepEqual(kinds({ candidates: [el({ cls: "toast destructive", text: "Nope" })] }), ["error-toast"]);
});

test("a success toast and an empty live region are not errors", () => {
  assert.deepEqual(kinds({ candidates: [el({ toast: true, type: "success", text: "Saved" })] }), []);
  assert.deepEqual(kinds({ candidates: [el({ role: "alert", text: "  " })] }), []);
});

test("a nearly empty body is reported, unless the screen is mostly media", () => {
  assert.deepEqual(kinds({ textLength: 5, elementCount: 6, mediaCount: 0 }), ["near-empty"]);
  assert.deepEqual(kinds({ textLength: 5, elementCount: 6, mediaCount: 1 }), []);
});

test("framework crash text in the body is reported", () => {
  assert.deepEqual(kinds({ bodyText: "Application error: a client-side exception has occurred" }), ["error-text"]);
  assert.deepEqual(kinds({ bodyText: "Something went wrong!" }), ["error-text"]);
});

test("a dev error overlay is reported", () => {
  assert.deepEqual(kinds({ devOverlayError: true }), ["dev-overlay"]);
});

test("samples stay short and few", () => {
  const candidates = Array.from({ length: 5 }, (_, i) => el({ role: "alert", text: `${i}`.repeat(300) }));
  const [signal] = suspectSignals({ ...healthy, candidates });
  assert.equal(signal.count, 5);
  assert.equal(signal.samples.length, 3);
  assert.equal(signal.samples[0].length, 120);
});
