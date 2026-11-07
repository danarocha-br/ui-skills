/* Loads the canvas's DOM-free modules out of assets/flow-canvas.html, each from its own
   <script id="..."> block, and evaluates them in one bare context (no window, no document). */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
const html = fs.readFileSync(path.join(here, "../assets/flow-canvas.html"), "utf8");
const sandbox = {};
for (const id of ["layout-module", "commit-module", "annotations-module"]) {
  const block = html.match(new RegExp(`<script id="${id}">([\\s\\S]*?)</script>`));
  if (!block) throw new Error(`modules.mjs: no <script id="${id}"> block in assets/flow-canvas.html`);
  vm.runInNewContext(block[1], sandbox);
}
export const { FlowLayout, FlowCommit, FlowAnnotations } = sandbox;
