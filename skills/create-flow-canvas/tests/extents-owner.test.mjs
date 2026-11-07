/* Nothing but the geometry measures a frame, a row, a deck or a group (N4). The device module says what the numbers are
   (colW, phTop, phH, cap, deckW, peekX, peekY, collH, closedW); the geometry module turns them into extents (a frame, a
   row, a deck, a drop band, where frames land when they leave a group); every other module and the page ask it. This
   guard reads those other blocks and fails on a use of the numbers, or of the world's gap and head, so a second copy of
   a formula cannot come back. It reads source text, so it sees a use whether or not the line runs.
   If a line must name one of them for a reason that is not a measurement, add it to ALLOWED with the reason.
   Run:  node --test skills/create-flow-canvas/tests/extents-owner.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html, ENGINE_BLOCKS, block } from "./modules.mjs";

/* the blocks that may measure */
const OWNERS = ["geometry-module", "device-module"];
const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
/* every <script> of the file that is not data, with the page's own script (the one with no id) named "page" */
const blocks = () => {
  const out = {};
  for (const id of ENGINE_BLOCKS) if (!OWNERS.includes(id)) out[id] = strip(block(id));
  const page = html.match(/^\s*<script>\n([\s\S]*?)<\/script>/m);
  assert.ok(page, "the page's script block is not found");
  out.page = strip(page[1]);
  return out;
};

/* what only a measurement would name */
const METRIC = /\b(colW|phTop|phH|collH|deckW|peekX|peekY|closedW)\b|[\w\])]\.cap\b|\b(WORLD|GAP)\b|\b[mM]\.(gap|head)\b/;
const lines = (src) => src.split("\n").map((text, i) => ({ text: text.trim(), n: i + 1 }));

/* line (trimmed) -> why it is allowed. These are not measurements. */
const ALLOWED = {
  "const { head: HEAD } = FlowGeometry.WORLD;":
    "the page hands the stylesheet the head's height as a variable; it measures nothing with it",
};

test("no module but the geometry and the device measures a frame, a row, a deck or a group", () => {
  const found = [];
  for (const [name, src] of Object.entries(blocks())) {
    for (const { text, n } of lines(src)) {
      if (METRIC.test(text) && !(text in ALLOWED)) found.push(`${name}:${n}  ${text}`);
    }
  }
  assert.deepEqual(
    found,
    [],
    "ask FlowGeometry for the extent (frame, rowW, deckSpread, slotPlace, exitX, dropZone, dropBand, slotAt, closedTitle, groupCornerFor); " +
      "if the question is new, answer it there, with a test in extents.test.mjs. Allowed lines (not measurements): " +
      JSON.stringify(ALLOWED),
  );
});

test("the allowed lines are still there (an exception for a line that is gone is clutter)", () => {
  const all = Object.values(blocks()).join("\n");
  for (const text of Object.keys(ALLOWED)) assert.ok(all.includes(text), `no longer in the file: ${text}`);
});

test("the guard itself sees a copy of a formula (so a green run means something)", () => {
  const sample = [
    "const t = m.gap + m.head;",
    "const w = Math.max(1, n) * (m.colW + GAP) - GAP;",
    "height: m.phTop + m.phH + m.cap + 60 + 'px',",
    "x: box.x + M.deckW + M.peekX * 3 + 120,",
    "y: at.y - WORLD.head",
    "const { gap, head } = WORLD;",
  ];
  sample.forEach((text) => assert.ok(METRIC.test(text), text));
  /* and leaves what is not a measurement alone: a class, a word in a string, the geometry's own answers */
  ["col.querySelector('.cap')", "const t = geo.closedTitle(L.id);", "const F = geo.frame();", "r.setProperty('--head', x)"].forEach((text) =>
    assert.ok(!METRIC.test(text), text),
  );
});

test("the geometry module is where the extents are: it names every one of the offsets once", () => {
  const geo = strip(block("geometry-module"));
  /* the pixel offsets live in the EDGES table; the formulas below it use the table, not the literal */
  const body = geo.slice(geo.indexOf("const groupH"));
  assert.ok(!/\b(460|1\.4)\b/.test(body), "a bare 460 or 1.4 in a formula: use EDGES");
  assert.ok(!/[-+*/(]\s*(10|20|28|30|34|40|60|68|70|90|100|120|140)\b/.test(strip(geo.slice(geo.indexOf("const slotIn"), geo.indexOf("function arrange")))), "a bare pixel offset in an extent: use EDGES");
});
