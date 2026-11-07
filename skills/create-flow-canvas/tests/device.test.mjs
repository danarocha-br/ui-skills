/* Device: one description per device, and everything the canvas derives from it. No page: the module
   is plain data and arithmetic.
   Run:  node --test skills/create-flow-canvas/tests/device.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { FlowDevice } from "./modules.mjs";

const plain = (x) => JSON.parse(JSON.stringify(x));
/* arrays made inside the module's own context are not this context's arrays; compare them as data */
const slot = (...a) => plain(FlowDevice.slot(...a));
const carry = (...a) => plain(FlowDevice.carry(...a));
const placeOn = (...a) => plain(FlowDevice.placeOn(...a));
const TOP = 28; /* where a frame's screen starts inside its column (the canvas's phTop) */

/* ---------- the description ---------- */

test("the devices are mobile, tablet and desktop, in that order", () => {
  assert.deepEqual(plain(FlowDevice.ids()), ["mobile", "tablet", "desktop"]);
});

test("a description gives the numbers the arrangement needs, exactly as the canvas had them", () => {
  assert.deepEqual(plain(FlowDevice.describe("mobile").metrics), {
    colW: 270, phH: 585, cap: 170, body: 744, collH: 290, deckS: 0.4, deckW: 108, peekX: 10, peekY: 8, closedW: 440, edge: 509,
  });
  assert.deepEqual(plain(FlowDevice.describe("tablet").metrics), {
    colW: 400, phH: 560, cap: 150, body: 724, collH: 300, deckS: 0.4, deckW: 160, peekX: 12, peekY: 9, closedW: 580, edge: 480,
  });
  assert.deepEqual(plain(FlowDevice.describe("desktop").metrics), {
    colW: 600, phH: 420, cap: 140, body: 584, collH: 240, deckS: 0.38, deckW: 228, peekX: 12, peekY: 9, closedW: 700, edge: 205,
  });
});

test("a description gives the style variables the stylesheet reads, exactly as applyDevice set them", () => {
  assert.deepEqual(plain(FlowDevice.describe("mobile").cssVars), {
    "--cw": "270px", "--ch": "585px", "--cr": "38px", "--ds": "0.4", "--tw": "150px", "--ts": String(150 / 270),
    "--cap": "170px", "--capT": "19px", "--capB": "12.5px", "--capL": "4", "--edge": "509px",
  });
  assert.deepEqual(plain(FlowDevice.describe("tablet").cssVars), {
    "--cw": "400px", "--ch": "560px", "--cr": "26px", "--ds": "0.4", "--tw": "190px", "--ts": String(190 / 400),
    "--cap": "150px", "--capT": "22px", "--capB": "13.5px", "--capL": "3", "--edge": "480px",
  });
  assert.deepEqual(plain(FlowDevice.describe("desktop").cssVars), {
    "--cw": "600px", "--ch": "420px", "--cr": "14px", "--ds": "0.38", "--tw": "220px", "--ts": String(220 / 600),
    "--cap": "140px", "--capT": "26px", "--capB": "15px", "--capL": "2", "--edge": "205px",
  });
});

test("a description also says how the device is named, drawn and reached", () => {
  const { metrics, cssVars, ...rest } = plain(FlowDevice.describe("tablet"));
  assert.deepEqual(rest, {
    id: "tablet", label: "Tablet", vp: "768 × 1024", key: "t", icon: "i-tablet", title: "Tablet (T)", cls: "dw dt", findY: 640,
  });
  assert.deepEqual(plain(FlowDevice.describe("mobile")).cls, "dm");
  assert.deepEqual(plain(FlowDevice.describe("desktop")).cls, "dw dd");
});

test("a description is frozen: nobody can change a device for everyone else", () => {
  const d = FlowDevice.describe("mobile");
  assert.ok(Object.isFrozen(d) && Object.isFrozen(d.metrics) && Object.isFrozen(d.cssVars));
  assert.equal(FlowDevice.describe("mobile"), d, "asking twice gives the same description");
});

test("an unknown device is an error that names the ones there are", () => {
  assert.throws(() => FlowDevice.describe("watch"), /no device "watch".*mobile, tablet, desktop/);
});

test("the keyboard reaches a device by its key and ignores any other", () => {
  assert.equal(FlowDevice.idForKey("m"), "mobile");
  assert.equal(FlowDevice.idForKey("t"), "tablet");
  assert.equal(FlowDevice.idForKey("d"), "desktop");
  assert.equal(FlowDevice.idForKey("x"), null);
});

/* ---------- where a note goes on a device that has no place for it ---------- */

test("the slot a note takes when it has no place anywhere is near the frame's right edge, below the top", () => {
  assert.deepEqual(slot("mobile", TOP), [200, TOP + 120]);
  assert.deepEqual(slot("desktop", TOP), [530, TOP + 120]);
  assert.deepEqual(slot("tablet", TOP, 60), [330, TOP + 60], "a note added from the toolbar sits higher");
});

test("carrying a spot to another device keeps it at the same place on the screen", () => {
  /* the middle of a mobile screen is the middle of a desktop screen */
  const mid = [135, TOP + 585 / 2];
  assert.deepEqual(carry(mid, "mobile", "desktop", { top: TOP }), [300, Math.round(TOP + 420 / 2)]);
  assert.deepEqual(carry([0, TOP], "mobile", "tablet", { top: TOP }), [0, TOP], "the screen's corner stays the corner");
  assert.deepEqual(carry([270, TOP + 585], "mobile", "tablet", { top: TOP }), [400, TOP + 560], "so does the far corner");
});

test("carrying a spot there and back lands within a pixel of where it began", () => {
  for (const from of FlowDevice.ids())
    for (const to of FlowDevice.ids()) {
      const a = FlowDevice.describe(from).metrics;
      const p = [Math.round(a.colW * 0.7), Math.round(TOP + a.phH * 0.2)];
      const there = carry(p, from, to, { top: TOP });
      const back = carry(there, to, from, { top: TOP });
      assert.ok(Math.abs(back[0] - p[0]) <= 2 && Math.abs(back[1] - p[1]) <= 2, `${from} → ${to} → ${from}: ${p} became ${back}`);
    }
});

test("a note's place on a device: the one saved for it, else carried from the first device that has one, else the slot", () => {
  const saved = { tablet: [111, 222], desktop: [300, 200] };
  assert.deepEqual(placeOn(saved, "tablet", { top: TOP }), [111, 222], "its own place wins");
  assert.deepEqual(
    placeOn(saved, "mobile", { top: TOP }),
    carry([111, 222], "tablet", "mobile", { top: TOP }),
    "the first one saved is the one carried",
  );
  assert.deepEqual(placeOn(undefined, "mobile", { top: TOP }), slot("mobile", TOP));
  assert.deepEqual(placeOn({}, "mobile", { top: TOP }), slot("mobile", TOP));
  assert.deepEqual(placeOn({ watch: [1, 2] }, "mobile", { top: TOP }), slot("mobile", TOP), "a place on a device that is not there is no place");
});

test("a note made on one device does not jump to one shared slot on the others", () => {
  /* the bug: only the creation device had a place, so two notes made at different spots stacked on the same slot elsewhere */
  const top = { mobile: [30, TOP + 40] }, bottom = { mobile: [30, TOP + 500] };
  for (const other of ["tablet", "desktop"]) {
    const a = placeOn(top, other, { top: TOP }), b = placeOn(bottom, other, { top: TOP });
    assert.notDeepEqual(a, b, `on ${other} the two notes keep their order`);
    assert.ok(a[1] < b[1], `on ${other} the upper note is still the upper one`);
    assert.notDeepEqual(a, slot(other, TOP), `on ${other} the note is not on the shared slot`);
  }
});
