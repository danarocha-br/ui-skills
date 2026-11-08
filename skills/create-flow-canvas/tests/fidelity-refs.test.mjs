/* The scan's screen id comes from the route, the capture's from scenarios.json; fidelity must find a screen's
   reference screenshots under the capture's id. Run: node --test skills/create-flow-canvas/tests/fidelity-refs.test.mjs */
import { test } from "node:test";
import assert from "node:assert/strict";
import { refScreenId } from "../scripts/lib/refs.mjs";

const captured = [{ id: "not-found", route: "(404)" }, { id: "home", route: "/" }];

test("a screen is found under the capture's id by its route", () => {
  assert.equal(refScreenId({ id: "404", route: "(404)" }, captured), "not-found");
});
test("without a matching route or a capture, the scan's own id is used", () => {
  assert.equal(refScreenId({ id: "x", route: "/x" }, captured), "x");
  assert.equal(refScreenId({ id: "x", route: "/x" }, null), "x");
});
