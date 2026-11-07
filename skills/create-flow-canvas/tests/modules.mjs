/* Loads the canvas's DOM-free modules out of assets/flow-canvas.html, each from its own
   <script id="..."> block, and evaluates them in one bare context (no window, no document).
   Also hands out the sample scan (the JSON in <script id="flow-scan">) as the text the page reads. */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
export const html = fs.readFileSync(path.join(here, "../assets/flow-canvas.html"), "utf8");
export const ENGINE_BLOCKS = [
  "scan-module",
  "layout-module",
  "commit-module",
  "annotations-module",
  "routing-module",
  "geometry-module",
  "gesture-module",
];
/* the text of one <script id="..."> block (attributes after the id are allowed) */
export const block = (id) => {
  const m = html.match(new RegExp(`^\\s*<script\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</script>`, "m"));
  if (!m) throw new Error(`modules.mjs: no <script id="${id}"> block in assets/flow-canvas.html`);
  return m[1];
};
const sandbox = {};
for (const id of ENGINE_BLOCKS) vm.runInNewContext(block(id), sandbox);
export const { FlowScan, FlowLayout, FlowCommit, FlowAnnotations, FlowRouting, FlowGeometry, FlowGesture } = sandbox;
/* "" when the canvas has no sample yet, so the module tests still load and the sample's own test says why */
export const sampleScan = html.match(/^\s*<script\b[^>]*\bid="flow-scan"/m) ? block("flow-scan") : "";
