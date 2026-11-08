#!/usr/bin/env node
/* assemble.mjs: the capture (what a browser saw) plus .flow-canvas/flows.json (what the agent knows about the
   product) become one self-contained canvas. Only the template's three replaceable blocks change: the scan
   (<script id="flow-scan">), the product styles (<style id="flow-scan-styles" media="not all">) and the
   product behaviour (<script id="flow-scan-behaviour">). Nothing here knows any one product.

   Usage:  node assemble.mjs [--capture .flow-canvas/capture/capture.json] [--flows .flow-canvas/flows.json]
                             [--out .flow-canvas/flow-canvas.html] [--behaviour .flow-canvas/behaviour.js] [--template <file>]
   It writes the canvas and, beside it, assemble-report.json (what was inlined, what was dropped and why).
   Fonts and CSS images are fetched from the URLs the capture saw, so the product's dev server (or the network)
   must still be reachable; whatever cannot be fetched or is over budget is dropped and listed in the report.

   flows.json
   { "product": { "id": "stable-id", "name": "Name", "scanned"?: "when, in words" },
     "start"?: "<screen id>",
     "screens": [{ "id": "<id in capture.json>", "name", "file", "note"?, "approximate"?: true,
                   "caption"?: { "title", "body", "on" },
                   "unreachable"?: [{ "name": "state", "source"?, "evidence"? }],     states only reachable in code
                   "route"?, "unrendered"?: "reason" }],      a screen with no capture: needs route and reason, shows a placeholder
     "groups": [{ "id"?, "title", "sub"?, "meta"?, "open"?, "screens": ["<screen id>"] }],
     "findings"?: [{ "kind", "screen", "target"?, "source"?, "text"?, "evidence", ...facts }],
     "budgets"?: { fontBytes, fontTotalBytes, imageBytes, imageTotalBytes, fileBytes } }
   A screen is referred to by its id in capture.json everywhere in flows.json; the scan's own screen id is made from
   the route (see slugRoute). */
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";

export const DEFAULT_BUDGETS = {
  fontBytes: 1.6e6, /* one font file */
  fontTotalBytes: 3e6, /* all inlined fonts */
  imageBytes: 150e3, /* one CSS image */
  imageTotalBytes: 1.5e6, /* all inlined CSS images */
  fileBytes: 12e6, /* the finished canvas (validate.mjs enforces it) */
};

export class AssembleError extends Error {
  constructor(problems) {
    super("The canvas was not assembled:\n- " + problems.join("\n- "));
    this.name = "AssembleError";
    this.problems = problems;
  }
}

const isObj = (o) => !!o && typeof o === "object" && !Array.isArray(o);
const text = (v) => (typeof v === "string" ? v : "");
const esc = (s) => String(s).replace(/&/g, "&amp;").replace(/"/g, "&quot;").replace(/</g, "&lt;").replace(/>/g, "&gt;");
const slug = (s) => String(s).toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-+|-+$/g, "");

/* a scan screen id from a route pattern: "/" is home, "/items/[id]" is items-id, "(404)" is 404 */
export function slugRoute(route) {
  const r = String(route).replace(/\[+\.{0,3}([^\]]+)\]+/g, "$1");
  return r.replace(/^\/+|\/+$/g, "") ? slug(r) || "screen" : r.trim() === "/" ? "home" : slug(r) || "screen";
}

/* ids that may collide: the first in sorted order keeps the bare id, the rest are id~2, id~3, ... */
function assignIds(items, baseOf, sortKey) {
  const groups = new Map();
  items.forEach((item) => {
    const base = baseOf(item);
    groups.set(base, [...(groups.get(base) || []), item]);
  });
  const ids = new Map();
  for (const [base, members] of groups) {
    [...members].sort((a, b) => (sortKey(a) < sortKey(b) ? -1 : sortKey(a) > sortKey(b) ? 1 : 0)).forEach((m, i) => ids.set(m, i ? `${base}~${i + 1}` : base));
  }
  return ids;
}

const topLevelCommas = (s) => {
  const parts = [];
  let depth = 0, quote = "", cur = "";
  for (const ch of s) {
    if (quote) { if (ch === quote) quote = ""; }
    else if (ch === '"' || ch === "'") quote = ch;
    else if (ch === "(" || ch === "[") depth++;
    else if (ch === ")" || ch === "]") depth--;
    else if (ch === "," && !depth) { parts.push(cur); cur = ""; continue; }
    cur += ch;
  }
  parts.push(cur);
  return parts;
};
/* tokens declared on :root (or html) resolve there; the screen's <html> cannot carry the product's classes, so
   the wrapper every render sits in (.flow-root) re-declares them */
function rootToo(t) {
  if (t[0] === "@") return t;
  const i = t.indexOf("{");
  if (i < 0) return t;
  const parts = topLevelCommas(t.slice(0, i)).map((p) => p.trim());
  const re = /(^|[\s>+~(])(:root|html)(?![\w-])/g;
  const extra = parts.map((p) => p.replace(re, "$1.flow-root")).filter((p, k) => p !== parts[k] && !parts.includes(p));
  return extra.length ? [...parts, ...new Set(extra)].join(", ") + t.slice(i) : t;
}

const orInto = (a, b) => a.forEach((rule, i) => {
  const other = b[i];
  if (!other) return;
  if (rule.c && other.c) orInto(rule.c, other.c);
  else if (other.u) rule.u = true;
});

const MIME = { png: "image/png", jpg: "image/jpeg", jpeg: "image/jpeg", gif: "image/gif", webp: "image/webp", avif: "image/avif", svg: "image/svg+xml", ico: "image/x-icon" };
const hrefPath = (h) => {
  try {
    const p = new URL(h, "http://flow.invalid").pathname.replace(/\/+$/, "");
    return p || "/";
  } catch { return null; }
};
const internalHref = (h) => typeof h === "string" && h.startsWith("/") && !h.startsWith("//");

export async function fetchBytes(url) {
  if (!/^https?:/i.test(url)) return null;
  try {
    const r = await fetch(url, { signal: AbortSignal.timeout(15000) });
    if (!r.ok) return null;
    return { bytes: Buffer.from(await r.arrayBuffer()), type: r.headers.get("content-type") || "" };
  } catch { return null; }
}

export async function assemble({ capture, flows, template, fetchBytes: getBytes = fetchBytes, budgets = {}, behaviour = "" }) {
  const problems = [];
  const B = { ...DEFAULT_BUDGETS, ...(isObj(flows?.budgets) ? flows.budgets : {}), ...budgets };

  /* ---------- the inputs agree ---------- */
  if (!isObj(capture) || !Array.isArray(capture.screens)) throw new AssembleError(["capture.json has no screens array"]);
  if (!isObj(flows)) throw new AssembleError(["flows.json is not an object"]);
  const product = isObj(flows.product) ? flows.product : {};
  if (!text(product.name).trim()) problems.push("flows.json product.name is required");
  if (!text(product.id).trim()) problems.push("flows.json product.id is required (it scopes the user's saved layout, so keep it stable)");
  const captured = new Map(capture.screens.map((s) => [s.id, s]));
  const flowScreens = Array.isArray(flows.screens) ? flows.screens.filter(isObj) : [];
  if (!flowScreens.length) problems.push("flows.json has no screens");
  const entries = []; /* one per screen on the canvas: { key, flow, cap, route } */
  const seenKeys = new Set();
  for (const f of flowScreens) {
    const key = text(f.id);
    if (!key) { problems.push("a screen in flows.json has no id"); continue; }
    if (seenKeys.has(key)) { problems.push(`screen "${key}" appears twice in flows.json`); continue; }
    seenKeys.add(key);
    if (!text(f.name).trim()) problems.push(`screen "${key}" has no name in flows.json`);
    if (!text(f.file).trim()) problems.push(`screen "${key}" has no file in flows.json`);
    const cap = captured.get(key);
    if (cap) entries.push({ key, flow: f, cap, route: cap.route });
    else if (text(f.unrendered).trim() && text(f.route).trim()) entries.push({ key, flow: f, cap: null, route: f.route });
    else problems.push(`screen "${key}" is in flows.json but has no capture; give it a "route" and an "unrendered" reason, or capture it`);
    for (const u of Array.isArray(f.unreachable) ? f.unreachable : []) if (!isObj(u) || !text(u.name).trim()) problems.push(`screen "${key}" has an unreachable state with no name`);
  }
  const keys = new Set(entries.map((e) => e.key));
  const groupsIn = Array.isArray(flows.groups) ? flows.groups.filter(isObj) : [];
  groupsIn.forEach((g, i) => {
    if (!text(g.title).trim()) problems.push(`group ${i} in flows.json has no title`);
    for (const ref of Array.isArray(g.screens) ? g.screens : []) if (!seenKeys.has(ref)) problems.push(`group "${g.title || i}" lists "${ref}", which is not a screen in flows.json`);
  });
  if (flows.start != null && !seenKeys.has(flows.start)) problems.push(`start "${flows.start}" is not a screen in flows.json`);
  const findingsIn = Array.isArray(flows.findings) ? flows.findings.filter(isObj) : [];
  findingsIn.forEach((f, i) => {
    if (!text(f.kind).trim()) problems.push(`finding ${i} in flows.json has no kind`);
    if (!seenKeys.has(f.screen)) problems.push(`finding ${i} (${f.kind || "?"}) is about "${f.screen}", which is not a screen in flows.json`);
    if (!text(f.evidence).trim()) problems.push(`finding ${i} (${f.kind || "?"}) has no evidence: say what in the code shows it`);
  });
  for (const id of captured.keys()) if (!seenKeys.has(id)) problems.push(`captured screen "${id}" has no entry in flows.json (it needs a name and a file)`);

  /* ids */
  const screenIds = assignIds(entries, (e) => slugRoute(e.route), (e) => e.route + "\u0000" + e.key);
  const idOf = (key) => screenIds.get(entries.find((e) => e.key === key));
  const groupIds = new Set();
  const groupList = groupsIn.map((g) => {
    const id = text(g.id).trim() || slug(text(g.title).split(":")[0]) || "group";
    if (groupIds.has(id)) problems.push(`two groups are called "${id}"`);
    groupIds.add(id);
    return { g, id };
  });
  for (const id of groupIds) if ([...screenIds.values()].includes(id)) problems.push(`group id "${id}" is also a screen id: give the group an "id" of its own`);
  if (problems.length) throw new AssembleError(problems);

  /* ---------- 1. sheets, merged by key and rule index ---------- */
  const sheets = new Map(), families = new Set();
  for (const e of entries) {
    if (!e.cap) continue;
    for (const state of Object.values(e.cap.captures || {})) for (const c of Object.values(state)) {
      (c.families || []).forEach((f) => families.add(String(f).toLowerCase()));
      for (const sh of c.sheets || []) {
        const have = sheets.get(sh.key);
        if (!have) sheets.set(sh.key, structuredClone(sh));
        else if (!sh.raw && have.rules && sh.rules) orInto(have.rules, sh.rules);
      }
    }
  }

  /* ---------- 2. css, with fonts and images inlined within budget ---------- */
  const dropped = { fonts: [], images: [] };
  const used = { fontBytes: 0, fonts: 0, imageBytes: 0, images: 0 };
  const cache = new Map();
  const get = async (u) => {
    if (!cache.has(u)) cache.set(u, (await getBytes(u).catch(() => null)) || null);
    return cache.get(u);
  };
  async function face(t, base) {
    const fam = (t.match(/font-family:\s*["']?([^;"']+)/) || [])[1]?.trim();
    if (!fam || !families.has(fam.toLowerCase())) return null;
    const range = (t.match(/unicode-range:\s*([^;}]+)/) || [])[1];
    if (range && !/U\+0(000)?-|U\+0\b/i.test(range)) return null; /* a subset that is not the base: the base carries the common glyphs */
    const urls = [...t.matchAll(/url\(["']?([^"')]+)["']?\)\s*(?:format\(["']?([\w-]+))?/g)];
    const pick = urls.find((m) => m[2] === "woff2") || urls[0];
    if (!pick) return t;
    if (pick[1].startsWith("data:")) return t;
    const drop = (reason) => { dropped.fonts.push({ family: fam, url: pick[1], reason }); return null; };
    let abs;
    try { abs = new URL(pick[1], base).href; } catch { return drop("the font URL could not be resolved"); }
    const f = await get(abs);
    if (!f) return drop("could not be fetched");
    if (f.bytes.length > B.fontBytes) return drop(`larger than the font budget (${f.bytes.length} > ${B.fontBytes} bytes)`);
    if (used.fontBytes + f.bytes.length > B.fontTotalBytes) return drop(`the fonts' total budget (${B.fontTotalBytes} bytes) is used up`);
    used.fontBytes += f.bytes.length;
    used.fonts++;
    const fmt = /\.woff2(\?|#|$)/i.test(abs) || pick[2] === "woff2" ? ["font/woff2", "woff2"] : /\.woff(\?|#|$)/i.test(abs) ? ["font/woff", "woff"] : /\.otf/i.test(abs) ? ["font/otf", "opentype"] : ["font/ttf", "truetype"];
    return t.replace(/src\s*:[^;}]+/, `src: url(data:${fmt[0]};base64,${f.bytes.toString("base64")}) format("${fmt[1]}")`);
  }
  async function images(t, base) {
    let out = t;
    for (const m of [...t.matchAll(/url\(\s*(["']?)(?!data:|#)([^"')]+)\1\s*\)/g)]) {
      let abs;
      try { abs = new URL(m[2], base).href; } catch { dropped.images.push({ url: m[2], reason: "the URL could not be resolved" }); out = out.replace(m[0], "none"); continue; }
      const f = await get(abs);
      const type = f && (f.type.split(";")[0].trim() || MIME[abs.split(/[?#]/)[0].split(".").pop().toLowerCase()] || "application/octet-stream");
      const why = !f ? "could not be fetched" : f.bytes.length > B.imageBytes ? `larger than the image budget (${f.bytes.length} > ${B.imageBytes} bytes)` : used.imageBytes + f.bytes.length > B.imageTotalBytes ? `the images' total budget (${B.imageTotalBytes} bytes) is used up` : "";
      if (why) { dropped.images.push({ url: abs, reason: why }); out = out.replace(m[0], "none"); continue; }
      used.imageBytes += f.bytes.length;
      used.images++;
      out = out.replace(m[0], () => `url(data:${type};base64,${f.bytes.toString("base64")})`);
    }
    return out;
  }
  async function emit(rules, base) {
    let o = "";
    for (const r of rules || []) {
      if (r.c) {
        const inner = await emit(r.c, base);
        if (inner) o += `${r.g}{${inner}}\n`;
        continue;
      }
      if (!r.u) continue;
      if (/^@font-face/.test(r.t)) { const f = await face(r.t, base); if (f) o += f + "\n"; continue; }
      o += rootToo(/url\(/.test(r.t) && r.t[0] !== "@" ? await images(r.t, base) : r.t) + "\n";
    }
    return o;
  }
  const classesUsed = new Set();
  for (const e of entries) if (e.cap) for (const state of Object.values(e.cap.captures || {})) for (const c of Object.values(state))
    for (const m of String(c.html).matchAll(/class="([^"]*)"/g)) m[1].split(/\s+/).forEach((k) => k && classesUsed.add(k));
  let css = "";
  const rawSheets = [];
  for (const sh of sheets.values()) {
    if (sh.raw) { /* the capture could not read this sheet's rules: take its text and keep what the markup uses */
      const f = await get(sh.href);
      if (!f) { rawSheets.push({ href: sh.href, kept: false, reason: "could not be fetched" }); continue; }
      const body = f.bytes.toString("utf8");
      if (/@font-face/.test(body)) {
        for (const m of body.matchAll(/@font-face\s*{[^}]*}/g)) { const x = await face(m[0], sh.href); if (x) css += x + "\n"; }
        rawSheets.push({ href: sh.href, kept: true, reason: "font faces only" });
        continue;
      }
      const hit = [...body.matchAll(/\.([a-zA-Z_][\w-]*)/g)].some((m) => classesUsed.has(m[1]));
      rawSheets.push({ href: sh.href, kept: hit, reason: hit ? "the markup uses its classes" : "the markup uses none of its classes" });
      if (hit) css += rootToo(body) + "\n";
      continue;
    }
    css += await emit(sh.rules, sh.href);
  }
  css = css.replace(/<\/style/gi, "<\\/style");

  /* ---------- 3. screens ---------- */
  const targets = new Map(); /* a path the capture can follow -> the scan screen it leads to */
  for (const e of entries) {
    const sid = idOf(e.key);
    if (e.cap && hrefPath(e.cap.url)) targets.set(hrefPath(e.cap.url), sid);
  }
  for (const e of entries) if (/^\/[^[(]*$/.test(e.route) && !targets.has(hrefPath(e.route))) targets.set(hrefPath(e.route), idOf(e.key));
  const targetOf = (href, selfId) => {
    const to = internalHref(href) ? targets.get(hrefPath(href)) : undefined;
    return to && to !== selfId ? to : null;
  };
  const compNames = new Set();
  const namesIn = (html) => [...html.matchAll(/data-flow-c="([^"]*)"/g)].flatMap((m) => m[1].split(/\s+/).filter(Boolean));
  const htmlImages = new Set();
  const render = (c, selfId) => {
    const inner = c.html.replace(/(\s?)data-flow-href="([^"]*)"/g, (m, sp, v) => {
      const to = targetOf(v.replace(/&amp;/g, "&"), selfId);
      return to ? `${sp}data-go="${esc(to)}"` : "";
    });
    namesIn(inner).forEach((n) => compNames.add(n));
    for (const m of inner.matchAll(/<img\b[^>]*\bsrc="([^"]*)"/gi)) if (!/^data:/i.test(m[1])) htmlImages.add(m[1]);
    const style = `flex:1 0 auto;min-height:100%;position:relative;background:${text(c.bg)};color:${text(c.color)};font-size:${text(c.fs)};font-family:${text(c.font)}`;
    return `<div class="${esc(["flow-root", c.rootCls, c.bodyCls].filter(Boolean).join(" "))}" style="${esc(style)}">${inner}</div>`;
  };
  const perDevice = (state, selfId) => Object.fromEntries(Object.entries(state).map(([d, c]) => [d, render(c, selfId)]));

  const screens = [], candidates = [];
  for (const e of entries) {
    const id = idOf(e.key), f = e.flow;
    const unreachable = (Array.isArray(f.unreachable) ? f.unreachable : []).filter((u) => isObj(u) && text(u.name).trim());
    const unreachNames = new Set(unreachable.map((u) => u.name));
    const names = e.cap ? Object.keys(e.cap.captures || {}) : [];
    const comps = new Set();
    const states = names.map((n, i) => {
      for (const c of Object.values(e.cap.captures[n])) namesIn(c.html).forEach((x) => comps.add(x));
      return { name: n, reachable: !unreachNames.has(n), ...(i ? { html: perDevice(e.cap.captures[n], id) } : {}) };
    });
    for (const u of unreachable) if (!names.includes(u.name)) states.push({ name: u.name, reachable: false });
    const first = names.length ? perDevice(e.cap.captures[names[0]], id) : {};
    screens.push({
      id, name: f.name, route: e.route, file: f.file, components: [...comps].sort(), states, note: text(f.note),
      ...(f.approximate === true ? { approximate: true } : {}),
      ...(text(f.unrendered).trim() ? { unrendered: f.unrendered.trim() } : {}),
      caption: isObj(f.caption) ? { title: text(f.caption.title), body: text(f.caption.body), on: f.caption.on !== false } : { title: f.name, body: e.route, on: true },
      html: first,
    });
    if (e.cap && names.length) for (const c of Object.values(e.cap.captures[names[0]])) for (const l of c.links || []) {
      const to = targetOf(l.href, id);
      if (to) candidates.push({ from: id, to, label: text(l.text), href: l.href, base: `${id}>${to}:${slug(text(l.text)) || "link"}`, key: `${l.href}\u0000${text(l.text)}` });
    }
  }

  /* ---------- 4. connectors, only from captured links to known routes ---------- */
  const uniqueLinks = [];
  const seenLink = new Set();
  for (const c of candidates) { const k = c.base + "\u0000" + c.key; if (!seenLink.has(k)) { seenLink.add(k); uniqueLinks.push(c); } }
  const linkIds = assignIds(uniqueLinks, (c) => c.base, (c) => c.key);
  const links = [], emitted = new Set();
  for (const c of uniqueLinks) {
    if (emitted.has(c.base)) continue;
    emitted.add(c.base);
    uniqueLinks.filter((x) => x.base === c.base).map((x) => ({ x, id: linkIds.get(x) })).sort((a, b) => (a.id < b.id ? -1 : 1))
      .forEach(({ x, id }) => links.push({ id, from: x.from, to: x.to, label: x.label }));
  }

  /* ---------- 5. findings ---------- */
  const raw = [];
  for (const e of entries) {
    const id = idOf(e.key), un = (Array.isArray(e.flow.unreachable) ? e.flow.unreachable : []).filter((u) => isObj(u) && text(u.name).trim());
    if (un.length) raw.push({ kind: "unreachable-states", frame: id, target: "", source: text(un[0].source) || e.flow.file,
      evidence: un.map((u) => text(u.evidence) || `${u.name}: nothing in the UI leads to it`).join("; ") });
    if (e.cap) {
      const seen = new Set();
      for (const c of Object.values(Object.values(e.cap.captures || {})[0] || {})) for (const l of c.links || []) {
        if (text(l.text).trim() || seen.has(l.href)) continue;
        seen.add(l.href);
        raw.push({ kind: "unnamed-link", frame: id, target: l.href, source: e.flow.file, text: `The link to ${l.href} has no accessible name.`, evidence: "the captured link has no text" });
      }
    }
  }
  for (const f of findingsIn) {
    const { screen, ...rest } = f;
    raw.push({ ...rest, frame: idOf(screen), target: text(f.target) });
  }
  const fids = assignIds(raw, (f) => `${f.kind}:${f.frame}${f.target ? ":" + (slug(f.target) || "target") : ""}`, (f) => JSON.stringify(f));
  const findings = raw.map((f) => {
    const { target, ...rest } = f;
    return { id: fids.get(f), ...rest, ...(target ? { target } : {}) };
  });

  /* ---------- 6. groups ---------- */
  const inGroup = new Set();
  const groups = groupList.map(({ g, id }) => {
    const ids = (g.screens || []).map(idOf);
    ids.forEach((x) => inGroup.add(x));
    const dirs = [...new Set((g.screens || []).map((k) => entries.find((e) => e.key === k).flow.file).map((p) => path.posix.dirname(p)))];
    return { id, screens: ids, open: g.open !== false, title: g.title, sub: text(g.sub), subOn: !!text(g.sub), meta: text(g.meta) || dirs.join(", ") };
  });
  const looseScreens = screens.map((s) => s.id).filter((id) => !inGroup.has(id));

  const sorted = [...compNames].sort();
  const scan = {
    icons: "",
    product: { id: product.id.trim(), name: product.name.trim(), ...(text(product.scanned) ? { scanned: product.scanned } : {}) },
    start: flows.start != null ? idOf(flows.start) : (groups[0]?.screens[0] || screens[0].id),
    components: Object.fromEntries(sorted.map((n) => [n, `[data-flow-c~="${n.replace(/\\/g, "\\\\").replace(/"/g, '\\"')}"]`])),
    screens, groups, links, findings, notes: [],
  };
  /* JSON for a script tag: "</" and "<!--" written with escapes JSON allows */
  const json = JSON.stringify(scan).replace(/<\//g, "<\\/").replace(/<!--/g, "<\\u0021--");

  /* ---------- 7. only the three blocks change ---------- */
  let html = template;
  const block = (re, label, body) => {
    if ((html.match(new RegExp(re.source, "g")) || []).length !== 1) throw new AssembleError([`the template does not have exactly one ${label}`]);
    html = html.replace(re, (m, a, z) => a + "\n" + body + "\n" + z);
  };
  block(/(<script type="application\/json" id="flow-scan">)[\s\S]*?(<\/script>)/, "<script id=\"flow-scan\"> block", json);
  block(/(<style id="flow-scan-styles" media="not all">)[\s\S]*?(<\/style>)/, "<style id=\"flow-scan-styles\" media=\"not all\"> block", css);
  block(/(<script id="flow-scan-behaviour">)[\s\S]*?(<\/script>)/, "<script id=\"flow-scan-behaviour\"> block", String(behaviour).replace(/<\/script/gi, "<\\/script"));

  const kb = (s) => Math.round(Buffer.byteLength(s) / 1024);
  const report = {
    screens: screens.length, links: links.length, findings: findings.length, components: sorted.length,
    sizesKB: { css: kb(css), scan: kb(json), file: kb(html) },
    fonts: { inlined: used.fonts, bytes: used.fontBytes }, images: { inlined: used.images, bytes: used.imageBytes },
    dropped, rawSheets, looseScreens, htmlImagesNotInlined: htmlImages.size,
    families: [...families].sort(), budgets: B,
  };
  return { html, report };
}

/* ---------- command line ---------- */
async function main(argv) {
  const arg = (name, dflt) => { const i = argv.indexOf("--" + name); return i >= 0 ? argv[i + 1] : dflt; };
  const dir = ".flow-canvas";
  const capturePath = arg("capture", path.join(dir, "capture", "capture.json"));
  const flowsPath = arg("flows", path.join(dir, "flows.json"));
  const out = arg("out", path.join(dir, "flow-canvas.html"));
  const here = path.dirname(fileURLToPath(import.meta.url));
  const templatePath = arg("template", path.join(here, "..", "assets", "flow-canvas.html"));
  const behaviourPath = arg("behaviour", fs.existsSync(path.join(dir, "behaviour.js")) ? path.join(dir, "behaviour.js") : "");
  const readJson = (p, what) => {
    try { return JSON.parse(fs.readFileSync(p, "utf8")); } catch (e) { throw new AssembleError([`${what} (${p}) could not be read: ${e.message}`]); }
  };
  const { html, report } = await assemble({
    capture: readJson(capturePath, "the capture"), flows: readJson(flowsPath, "flows.json"),
    template: fs.readFileSync(templatePath, "utf8"), behaviour: behaviourPath ? fs.readFileSync(behaviourPath, "utf8") : "",
  });
  fs.mkdirSync(path.dirname(out), { recursive: true });
  fs.writeFileSync(out, html);
  fs.writeFileSync(path.join(path.dirname(out), "assemble-report.json"), JSON.stringify(report, null, 2) + "\n");
  console.log(`Wrote ${out} (${report.sizesKB.file} KB): ${report.screens} screens, ${report.links} connectors, ${report.findings} findings.`);
  console.log(`Inlined ${report.fonts.inlined} fonts and ${report.images.inlined} images.`);
  for (const d of report.dropped.fonts) console.log(`  dropped font ${d.family}: ${d.reason}`);
  for (const d of report.dropped.images) console.log(`  dropped image ${d.url}: ${d.reason}`);
  if (report.looseScreens.length) console.log(`  not in any group: ${report.looseScreens.join(", ")}`);
  if (report.htmlImagesNotInlined) console.log(`  ${report.htmlImagesNotInlined} <img> sources in the markup are not inlined and will not load from the file.`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(path.resolve(process.argv[1])).href) {
  main(process.argv.slice(2)).catch((e) => { console.error(e instanceof AssembleError ? e.message : e); process.exit(1); });
}
