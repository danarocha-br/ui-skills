#!/usr/bin/env node
/* validate.mjs: reads a finished canvas the way the page does, with the canvas's own FlowScan and FlowDevice
   modules (taken out of the file being checked), and fails with plain messages before anyone opens it.

   Usage:  node validate.mjs [canvas.html] [--max-bytes N]        default canvas: .flow-canvas/flow-canvas.html
   Exits 1 when there is an error. It checks that:
     - the three product blocks are there, the styles are still inert (media="not all") and the scan JSON has no raw
       "<!--" (and one that ends its tag early shows as invalid JSON);
     - the scan parses and FlowScan accepts it, and anything the page would report as a problem is an error;
     - every screen (route) has a frame: a render on at least one device, or an "unrendered" reason that gives it
       a placeholder;
     - every connector joins two screens, every group lists real screens, and every in-screen button
       (data-go="<id>") leads to a screen that has a connector from it;
     - the file is within its size budget. */
import fs from "node:fs";
import vm from "node:vm";
import path from "node:path";
import { pathToFileURL } from "node:url";
import { DEFAULT_BUDGETS } from "./assemble.mjs";

const blockOf = (html, id, tag) => {
  const m = html.match(new RegExp(`<${tag}\\b[^>]*\\bid="${id}"[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1] : null;
};

export function validate(html, { budgets = {} } = {}) {
  const B = { ...DEFAULT_BUDGETS, ...budgets };
  const errors = [], warnings = [];
  const stats = { screens: 0, links: 0, findings: 0, bytes: Buffer.byteLength(html) };
  const rawScan = blockOf(html, "flow-scan", "script");
  if (rawScan === null) return { errors: ["This is not a flow canvas: there is no <script id=\"flow-scan\"> block."], warnings, stats };

  if (blockOf(html, "flow-scan-styles", "style") === null) errors.push('The product styles block (<style id="flow-scan-styles">) is missing.');
  else if (!/<style id="flow-scan-styles" media="not all">/.test(html)) errors.push('The product styles lost media="not all", so they would restyle the canvas itself.');
  if (blockOf(html, "flow-scan-behaviour", "script") === null) errors.push('The product behaviour block (<script id="flow-scan-behaviour">) is missing.');
  /* a raw "</script" cannot be seen from here (it ends the block, so the JSON comes up short); "<!--" can */
  if (rawScan.includes("<!--")) errors.push('The scan contains a raw "<!--", which a script tag treats specially: write it as "<\\u0021--".');
  if (stats.bytes > B.fileBytes) errors.push(`The canvas is ${stats.bytes} bytes, over budget (${B.fileBytes} bytes).`);

  let json;
  try { json = JSON.parse(rawScan); } catch (e) { errors.push(`The flow-scan block is not valid JSON: ${e.message}`); return { errors, warnings, stats }; }

  const sandbox = {};
  try {
    for (const id of ["device-module", "scan-module"]) {
      const code = blockOf(html, id, "script");
      if (code === null) throw new Error(`there is no <script id="${id}"> block`);
      vm.runInNewContext(code, sandbox);
    }
  } catch (e) { errors.push(`The canvas's own modules could not be loaded: ${e.message}`); return { errors, warnings, stats }; }
  const devices = sandbox.FlowDevice.ids();
  const { scan, problems } = sandbox.FlowScan.read(rawScan, { devices });
  if (!scan) errors.push(`The scan was rejected by the page's own reader, so it would open empty: ${[...problems].join("; ")}`);
  else [...problems].forEach((p) => errors.push(`The page would report: ${p}`));

  const screens = Array.isArray(json.screens) ? json.screens : [];
  const ids = new Set(screens.map((s) => s && s.id));
  const htmls = (h) => (h && typeof h === "object" ? h : {});
  stats.screens = screens.length;
  stats.links = Array.isArray(json.links) ? json.links.length : 0;
  stats.findings = Array.isArray(json.findings) ? json.findings.length : 0;

  for (const s of screens) {
    if (!s || typeof s !== "object") continue;
    const name = `screen "${s.id}" (route ${s.route || "none"})`;
    const rendered = devices.filter((d) => typeof htmls(s.html)[d] === "string" && htmls(s.html)[d].trim());
    if (!rendered.length && !(typeof s.unrendered === "string" && s.unrendered.trim()))
      errors.push(`${name} has no frame: no render on any device and no "unrendered" reason to give it a placeholder.`);
    else if (rendered.length && rendered.length < devices.length)
      warnings.push(`${name} has no render for ${devices.filter((d) => !rendered.includes(d)).join(", ")}; those devices show a blank screen.`);
  }
  const connected = new Set((Array.isArray(json.links) ? json.links : []).filter((l) => l && ids.has(l.from) && ids.has(l.to)).map((l) => `${l.from}>${l.to}`));
  for (const l of Array.isArray(json.links) ? json.links : []) {
    if (!l || typeof l !== "object") continue;
    for (const end of ["from", "to"]) if (!ids.has(l[end])) errors.push(`The connector ${l.id || `${l.from}>${l.to}`} ${end === "from" ? "starts at" : "ends at"} screen "${l[end]}", which is not in the scan.`);
  }
  for (const g of Array.isArray(json.groups) ? json.groups : []) for (const sid of (g && g.screens) || [])
    if (!ids.has(sid)) errors.push(`Group "${g.title || g.id}" lists screen "${sid}", which is not in the scan.`);
  for (const s of screens) {
    if (!s || typeof s !== "object") continue;
    const seen = new Set();
    const renders = [...Object.entries(htmls(s.html)).map(([d, h]) => [d, h]), ...(Array.isArray(s.states) ? s.states : []).flatMap((st) => Object.entries(htmls(st && st.html)).map(([d, h]) => [`${d}, state "${st.name}"`, h]))];
    for (const [where, h] of renders) for (const m of String(h).matchAll(/data-go="([^"]*)"/g)) {
      const key = m[1] + "\u0000" + where;
      if (!m[1] || m[1] === s.id || seen.has(key)) continue; /* data-go="" marks a button that goes nowhere on purpose; a button to its own screen is inert */
      seen.add(key);
      if (!ids.has(m[1])) errors.push(`screen "${s.id}" (${where}) has a button with data-go="${m[1]}", but the scan has no such screen.`);
      else if (!connected.has(`${s.id}>${m[1]}`)) errors.push(`screen "${s.id}" (${where}) has a button with data-go="${m[1]}", but there is no connector from "${s.id}" to "${m[1]}", so it follows nothing.`);
    }
  }
  const grouped = new Set((Array.isArray(json.groups) ? json.groups : []).flatMap((g) => (g && g.screens) || []));
  const loose = screens.filter((s) => s && !grouped.has(s.id)).map((s) => s.id);
  if (loose.length && loose.length < screens.length) warnings.push(`Not in any group: ${loose.join(", ")}.`);
  return { errors, warnings, stats };
}

if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  const argv = process.argv.slice(2);
  const i = argv.indexOf("--max-bytes");
  const budgets = i >= 0 ? { fileBytes: Number(argv[i + 1]) } : {};
  const file = argv.find((a, k) => !a.startsWith("--") && argv[k - 1] !== "--max-bytes") || path.join(".flow-canvas", "flow-canvas.html");
  let html;
  try { html = fs.readFileSync(file, "utf8"); } catch (e) { console.error(`Cannot read ${file}: ${e.message}`); process.exit(1); }
  const { errors, warnings, stats } = validate(html, { budgets });
  warnings.forEach((w) => console.warn("warning: " + w));
  errors.forEach((e) => console.error("error: " + e));
  console.log(`${file}: ${stats.screens} screens, ${stats.links} connectors, ${stats.findings} findings, ${stats.bytes} bytes. ${errors.length ? `${errors.length} error(s).` : "OK."}`);
  process.exit(errors.length ? 1 : 0);
}
