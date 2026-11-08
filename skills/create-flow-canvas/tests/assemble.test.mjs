/* assemble.mjs turns a capture (what the browser saw) plus the agent's flows.json (what the product means) into
   the canvas. The seam is assemble({ capture, flows, template, fetchBytes, budgets }) -> { html, report }: these
   tests read the canvas it writes the way the page does, through FlowScan, and never look inside assemble.
   Run:  node --test skills/create-flow-canvas/tests/assemble.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";
import { FlowScan, FlowDevice } from "./modules.mjs";
import { assemble } from "../scripts/assemble.mjs";

const here = path.dirname(fileURLToPath(import.meta.url));
const template = fs.readFileSync(path.join(here, "../assets/flow-canvas.html"), "utf8");
const DEV = ["mobile", "tablet", "desktop"];

const cap = (over = {}) => Object.fromEntries(DEV.map((d) => [d, {
  html: `<main data-flow-c="Page">hello ${d}</main>`, rootCls: "dark", bodyCls: "font-x", bg: "rgb(10, 10, 10)",
  color: "rgb(250, 250, 250)", font: 'Sen, "Sen Fallback"', fs: "16px", families: [], links: [], title: "t", sheets: [], ...over,
}]));
const screen = (id, route, url, captures, states) => ({ id, route, url, states: states || Object.keys(captures).map((name) => ({ name })), captures });
const baseCapture = () => ({
  screens: [
    screen("home", "/", "/", { default: cap({ html: '<a data-flow-href="/items/1" data-flow-c="Link">Open</a><a data-flow-href="https://x.test/">Out</a><a data-flow-href="/">Self</a><a data-flow-href="/nope">Nope</a>', links: [{ href: "/items/1", text: "Open" }, { href: "https://x.test/", text: "Out" }, { href: "/", text: "Self" }, { href: "/nope", text: "Nope" }, { href: "/items/1", text: "" }] }) }),
    screen("detail", "/items/[id]", "/items/1", { default: cap(), "other state": cap({ html: "<p>other</p>" }) }),
  ],
  blocked: {}, assets: {}, errors: [],
});
const baseFlows = () => ({
  product: { id: "demo", name: "Demo" },
  screens: [
    { id: "home", name: "Home", file: "src/app/page.tsx", note: "The start." },
    { id: "detail", name: "Detail", file: "src/app/items/[id]/page.tsx" },
  ],
  groups: [{ id: "browse", title: "Browse: look around", sub: "Two screens.", screens: ["home", "detail"] }],
});
const run = async (capture = baseCapture(), flows = baseFlows(), extra = {}) => assemble({ capture, flows, template, fetchBytes: async () => null, ...extra });
const scanOf = (html) => {
  const raw = html.match(/<script type="application\/json" id="flow-scan">([\s\S]*?)<\/script>/)[1];
  const { scan, problems } = FlowScan.read(raw, { devices: FlowDevice.ids() });
  assert.deepEqual(JSON.parse(JSON.stringify(problems)), [], "the page would report no problems");
  return JSON.parse(JSON.stringify(scan));
};
const rejects = async (fn, re) => assert.rejects(fn, (e) => { assert.match(e.message + (e.problems || []).join("\n"), re); return true; });

test("only the three blocks change, and the styles stay inert", async () => {
  const { html } = await run();
  const strip = (h) => h
    .replace(/(<script type="application\/json" id="flow-scan">)[\s\S]*?(<\/script>)/, "$1$2")
    .replace(/(<style id="flow-scan-styles" media="not all">)[\s\S]*?(<\/style>)/, "$1$2")
    .replace(/(<script id="flow-scan-behaviour">)[\s\S]*?(<\/script>)/, "$1$2");
  assert.equal(strip(html), strip(template));
  assert.match(html, /<style id="flow-scan-styles" media="not all">/);
});

test("the canvas reads clean: product, start, screens from routes, groups", async () => {
  const scan = scanOf((await run()).html);
  assert.deepEqual([scan.product.id, scan.product.name], ["demo", "Demo"]);
  assert.deepEqual(scan.screens.map((s) => s.id), ["home", "items-id"]);
  assert.equal(scan.start, "home");
  assert.equal(scan.screens[1].route, "/items/[id]");
  assert.equal(scan.screens[0].note, "The start.");
  assert.equal(scan.screens[0].file, "src/app/page.tsx");
  assert.deepEqual(scan.groups.map((g) => [g.id, g.screens, g.title]), [["browse", ["home", "items-id"], "Browse: look around"]]);
});

test("screen ids come from the route and collide in sorted order, whatever order the capture came in", async () => {
  const mk = (order) => {
    const c = baseCapture();
    c.screens = [screen("a", "/x-y", "/x-y", { default: cap() }), screen("b", "/x/y", "/x/y", { default: cap() })];
    if (order) c.screens.reverse();
    return c;
  };
  const f = () => ({ ...baseFlows(), screens: [{ id: "a", name: "A", file: "a" }, { id: "b", name: "B", file: "b" }], groups: [] });
  const ids = async (order) => Object.fromEntries(scanOf((await run(mk(order), f())).html).screens.map((s) => [s.route, s.id]));
  assert.deepEqual(await ids(false), { "/x-y": "x-y", "/x/y": "x-y~2" });
  assert.deepEqual(await ids(true), { "/x-y": "x-y", "/x/y": "x-y~2" });
});

test("each render is wrapped with the captured classes, background, colour and font", async () => {
  const scan = scanOf((await run()).html);
  const h = scan.screens[0].html.desktop;
  assert.match(h, /^<div class="flow-root dark font-x" style="[^"]*background:rgb\(10, 10, 10\)/);
  assert.match(h, /color:rgb\(250, 250, 250\)/);
  assert.match(h, /font-family:Sen, &quot;Sen Fallback&quot;/);
  assert.match(h, /min-height:100%/);
});

test("a link becomes data-go only when it goes to another captured screen", async () => {
  const h = scanOf((await run()).html).screens[0].html.desktop;
  assert.match(h, /<a data-go="items-id" data-flow-c="Link">Open<\/a>/);
  assert.doesNotMatch(h, /data-flow-href/);
  assert.equal((h.match(/data-go=/g) || []).length, 1, "external, self and unknown links follow nothing");
});

test("connectors come only from captured links to known routes, with stable ids", async () => {
  const scan = scanOf((await run()).html);
  assert.deepEqual(scan.links.map((l) => [l.id, l.from, l.to, l.label]), [
    ["home>items-id:open", "home", "items-id", "Open"],
    ["home>items-id:link", "home", "items-id", ""],
  ]);
});

test("connector ids that collide take a numeric suffix in sorted order", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.links = [{ href: "/items/1?b", text: "Open" }, { href: "/items/1?a", text: "Open" }];
  c.screens[0].captures.default.mobile.links = [];
  c.screens[0].captures.default.tablet.links = [];
  c.screens[1].url = "/items/1";
  const ids = scanOf((await run(c)).html).links.map((l) => l.id);
  assert.deepEqual(ids, ["home>items-id:open", "home>items-id:open~2"]);
});

test("data-flow-c names become attribute selectors, and each screen lists its own", async () => {
  const scan = scanOf((await run()).html);
  assert.equal(scan.components.Page, '[data-flow-c~="Page"]');
  assert.equal(scan.components.Link, '[data-flow-c~="Link"]');
  assert.deepEqual(scan.screens[0].components, ["Link"]);
  assert.deepEqual(scan.screens[1].components, ["Page"]);
});

test("the first state is the screen, later states carry their own render", async () => {
  const s = scanOf((await run()).html).screens[1];
  assert.deepEqual(s.states.map((x) => [x.name, x.reachable, !!x.html]), [["default", true, false], ["other state", true, true]]);
  assert.match(s.states[1].html.mobile, /<p>other<\/p>/);
});

test("states only reachable in code, an approximate screen and a screen that could not render", async () => {
  const f = baseFlows();
  f.screens[0].approximate = true;
  f.screens[1].unreachable = [{ name: "paid", source: "src/Paid.tsx", evidence: "set only by a webhook" }];
  f.screens.push({ id: "pay", route: "/pay", name: "Pay", file: "src/app/pay/page.tsx", unrendered: "needs a payment session" });
  const scan = scanOf((await run(baseCapture(), f)).html);
  assert.equal(scan.screens[0].approximate, true);
  const paid = scan.screens[1].states.find((s) => s.name === "paid");
  assert.deepEqual([paid.reachable, paid.html], [false, undefined]);
  const f1 = scan.findings.find((x) => x.kind === "unreachable-states");
  assert.equal(f1.id, "unreachable-states:items-id");
  assert.equal(f1.source, "src/Paid.tsx");
  const pay = scan.screens[2];
  assert.equal(pay.unrendered, "needs a payment session");
  assert.match(pay.html.desktop, /needs a payment session/);
});

test("findings need evidence, take the stable id kind:screen:target, and unnamed links are found", async () => {
  const f = baseFlows();
  f.findings = [{ kind: "reused-component", screen: "home", target: "Button Bar", component: "Button", evidence: "used on 3 screens" }];
  const scan = scanOf((await run(baseCapture(), f)).html);
  assert.ok(scan.findings.some((x) => x.id === "reused-component:home:button-bar" && x.evidence === "used on 3 screens" && x.frame === "home"));
  assert.ok(scan.findings.some((x) => x.id === "unnamed-link:home:items-1" && x.frame === "home"));
  f.findings[0].evidence = "";
  await rejects(() => run(baseCapture(), f), /evidence/);
});

test("sheets are merged by key and rule index, with used OR-ed, and kept only when used", async () => {
  const sheet = (rules) => ({ key: "k", href: "http://h/a.css", rules });
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [sheet([{ s: ".a", t: ".a{color:red}", u: true }, { s: ".b", t: ".b{color:blue}", u: false }, { g: "@media (min-width: 1px)", c: [{ s: ".c", t: ".c{x:1}", u: false }] }])];
  c.screens[1].captures.default.mobile.sheets = [sheet([{ s: ".a", t: ".a{color:red}", u: false }, { s: ".b", t: ".b{color:blue}", u: true }, { g: "@media (min-width: 1px)", c: [{ s: ".c", t: ".c{x:1}", u: true }] }])];
  const { html } = await run(c);
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.a\{color:red\}/);
  assert.match(css, /\.b\{color:blue\}/);
  assert.match(css, /@media \(min-width: 1px\)\{\.c\{x:1\}\s*\}/);
  assert.equal(JSON.stringify(c).includes('"u":true'), true, "the capture itself is not changed");
  assert.equal(c.screens[0].captures.default.desktop.sheets[0].rules[1].u, false);
});

test("an unused rule is left out", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules: [{ s: ".z", t: ".z{color:red}", u: false }] }];
  assert.doesNotMatch((await run(c)).html, /\.z\{color:red\}/);
});

test(":root rules are re-declared on the wrapper, including classed and html forms", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules: [
    { s: ":root", t: ":root{--c:red}", u: true },
    { s: ":root, :host", t: ":root, :host{--d:1}", u: true },
    { s: ":root.dark", t: ":root.dark{--e:2}", u: true },
    { s: "html", t: "html{--f:3}", u: true },
    { s: ".dark", t: ".dark{--g:4}", u: true },
  ] }];
  const css = (await run(c)).html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /:root, \.flow-root\{--c:red\}/);
  assert.match(css, /:root, :host, \.flow-root\{--d:1\}/);
  assert.match(css, /:root\.dark, \.flow-root\.dark\{--e:2\}/);
  assert.match(css, /html, \.flow-root\{--f:3\}/);
  assert.match(css, /\.dark\{--g:4\}/);
});

const face = (family, src, extra = "") => ({ t: `@font-face { font-family: "${family}"; ${extra} src: ${src}; }`, u: true });
const fontCapture = (rules, families = ["Fam"]) => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules }];
  c.screens[0].captures.default.desktop.families = families;
  return c;
};
const bytes = (n, type = "font/woff2") => ({ bytes: Buffer.alloc(n, 1), type });

test("fonts: woff2 is preferred, only used families are inlined, and only the base of a unicode-range set", async () => {
  const fetched = [];
  const fetchBytes = async (u) => { fetched.push(u); return bytes(10); };
  const c = fontCapture([
    face("Fam", 'url(a.ttf) format("truetype"), url(a.woff2) format("woff2")'),
    face("Fam", 'url(latin.woff2) format("woff2")', "unicode-range: U+0000-00FF, U+0131;"),
    face("Fam", 'url(ext.woff2) format("woff2")', "unicode-range: U+0100-02AF;"),
    face("Other", 'url(o.woff2) format("woff2")'),
  ]);
  const { html, report } = await run(c, baseFlows(), { fetchBytes });
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.equal((css.match(/@font-face/g) || []).length, 2);
  assert.match(css, /data:font\/woff2;base64,/);
  assert.deepEqual(fetched.map((u) => u.split("/").pop()).sort(), ["a.woff2", "latin.woff2"]);
  assert.ok(report.fonts.inlined >= 2);
});

test("fonts over budget are dropped, and the report says which", async () => {
  const c = fontCapture([face("Fam", 'url(big.woff2) format("woff2")')]);
  const { html, report } = await run(c, baseFlows(), { fetchBytes: async () => bytes(5000), budgets: { fontBytes: 1000 } });
  assert.doesNotMatch(html, /data:font/);
  assert.deepEqual(report.dropped.fonts.map((d) => d.family), ["Fam"]);
  assert.match(report.dropped.fonts[0].reason, /budget|large|1000/);
});

test("a font that cannot be fetched is dropped and recorded, not silently lost", async () => {
  const c = fontCapture([face("Fam", 'url(gone.woff2) format("woff2")')]);
  const { report } = await run(c);
  assert.equal(report.dropped.fonts[0].family, "Fam");
  assert.match(report.dropped.fonts[0].reason, /fetch/);
});

test("css url() images are inlined within budget and replaced by none beyond it", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/dir/a.css", rules: [
    { s: ".small", t: ".small{background:url(s.png) no-repeat}", u: true },
    { s: ".big", t: ".big{background-image:url(\"b.png\")}", u: true },
    { s: ".data", t: ".data{background:url(data:image/png;base64,AAAA)}", u: true },
  ] }];
  const seen = [];
  const fetchBytes = async (u) => { seen.push(u); return u.endsWith("s.png") ? bytes(10, "image/png") : bytes(5000, "image/png"); };
  const { html, report } = await run(c, baseFlows(), { fetchBytes, budgets: { imageBytes: 1000 } });
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.small\{background:url\(data:image\/png;base64,[A-Za-z0-9+/=]+\) no-repeat\}/);
  assert.match(css, /\.big\{background-image:none\}/);
  assert.match(css, /url\(data:image\/png;base64,AAAA\)/);
  assert.deepEqual(seen.sort(), ["http://h/dir/b.png", "http://h/dir/s.png"]);
  assert.equal(report.dropped.images.length, 1);
});

test("a dropped image becomes a value that is valid for the property it was in", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules: [
    { s: ".bg", t: ".bg{background:url(x.png) no-repeat}", u: true },
    { s: ".mk", t: ".mk{-webkit-mask:url(x.png) center/contain no-repeat;mask-image:url(x.png)}", u: true },
    { s: ".ct", t: '.ct::before{content:url(x.png) "a"}', u: true },
  ] }];
  const { html } = await run(c, baseFlows(), { fetchBytes: async () => null });
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /\.bg\{background:none no-repeat\}/);
  assert.doesNotMatch(css, /(mask[\w-]*|content):[^;}]*\bnone\b/);
  assert.match(css, /-webkit-mask:url\(data:image\/gif;base64,[A-Za-z0-9+/=]+\) center\/contain no-repeat/);
  assert.match(css, /mask-image:url\(data:image\/gif;base64,/);
  assert.match(css, /content:url\(data:image\/gif;base64,[A-Za-z0-9+/=]+\) "a"/);
});

test("a dropped image later in a value is judged by its property, even after colons earlier in it", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules: [
    { s: ".a", t: ".a{mask:url(data:image/svg+xml;utf8,<svg/>) no-repeat,url(b.png)}", u: true },
    { s: ".b", t: '.b::before{content:"a:b" url(b.png)}', u: true },
  ] }];
  const { html } = await run(c, baseFlows(), { fetchBytes: async () => null });
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /no-repeat,url\(data:image\/gif;base64,/);
  assert.match(css, /content:"a:b" url\(data:image\/gif;base64,/);
});

test("the scan JSON is safe in a script tag and survives it", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.html = '<p>a </script><!-- b</p><p>  "q" \\ 😀</p>';
  const f = baseFlows();
  f.screens[0].note = "x </style> <!-- y";
  const { html } = await run(c, f);
  const raw = html.match(/<script type="application\/json" id="flow-scan">([\s\S]*?)<\/script>/)[1];
  assert.ok(!raw.includes("</"), "no </ in the block");
  assert.ok(!raw.includes("<!--"), "no <!-- in the block");
  const scan = JSON.parse(raw);
  assert.match(scan.screens[0].html.desktop, /<p>a <\/script><!-- b<\/p>/);
  assert.equal(scan.screens[0].note, "x </style> <!-- y");
  assert.match(scan.screens[0].html.desktop, /\\ 😀/);
});

test("css text cannot close the style block", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.sheets = [{ key: "k", href: "http://h/a.css", rules: [{ s: ".a", t: '.a::before{content:"</style><script>"}', u: true }] }];
  const { html } = await run(c);
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.doesNotMatch(css, /<\/style/i);
});

test("the same inputs give the same file", async () => {
  assert.equal((await run()).html, (await run()).html);
});

test("flows.json mistakes are named, all at once", async () => {
  const f = baseFlows();
  f.product = { name: "" };
  f.screens.push({ id: "ghost", name: "Ghost", file: "g" });
  f.groups[0].screens.push("nowhere");
  const c = baseCapture();
  c.screens.push(screen("extra", "/extra", "/extra", { default: cap() }));
  await rejects(() => run(c, f), /product\.name[\s\S]*product\.id[\s\S]*ghost[\s\S]*nowhere[\s\S]*extra/);
});

test("a group id that is also a screen id is refused", async () => {
  const f = baseFlows();
  f.groups[0].id = "home";
  await rejects(() => run(baseCapture(), f), /home/);
});

test("screens outside every group are listed in the report, not hidden", async () => {
  const f = baseFlows();
  f.groups[0].screens = ["home"];
  const { report } = await run(baseCapture(), f);
  assert.deepEqual(report.looseScreens, ["items-id"]);
});

test("non-inlined html images are counted in the report", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.html = '<img src="/_next/image?u=1"><img src="data:image/png;base64,AA">';
  const { report } = await run(c);
  assert.equal(report.htmlImagesNotInlined, 1);
});

test("a behaviour script is written into its block and cannot close it", async () => {
  const { html } = await run(baseCapture(), baseFlows(), { behaviour: "var FlowScanBehaviour={onTap(){ return '</script>'; }};" });
  const b = html.match(/<script id="flow-scan-behaviour">([\s\S]*?)<\/script>/)[1];
  assert.match(b, /FlowScanBehaviour/);
  assert.ok(!b.includes("</script"));
  assert.equal((await run()).html.match(/<script id="flow-scan-behaviour">([\s\S]*?)<\/script>/)[1].trim(), "");
});

/* ---------- review findings ---------- */

test("a link that only a later state has still gets its connector, so its button is never dead", async () => {
  const c = baseCapture();
  c.screens[1].captures["other state"].desktop.html = '<a data-flow-href="/">Back</a>';
  c.screens[1].captures["other state"].desktop.links = [{ href: "/", text: "Back" }];
  const scan = scanOf((await run(c)).html);
  assert.ok(scan.links.some((l) => l.from === "items-id" && l.to === "home" && l.label === "Back"));
  assert.match(scan.screens[1].states[1].html.desktop, /data-go="home"/);
});

test("ids keep non-Latin labels apart instead of collapsing them to one slug", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.links = [{ href: "/items/1", text: "Entrar" }, { href: "/items/1", text: "Выйти" }, { href: "/items/1", text: "ログイン" }];
  const ids = scanOf((await run(c)).html).links.map((l) => l.id);
  assert.equal(new Set(ids).size, ids.length);
  assert.ok(ids.includes("home>items-id:выйти") && ids.includes("home>items-id:ログイン"));
});

test("a base unicode-range such as U+0020-007F is kept, and a skipped subset is recorded rather than silent", async () => {
  const c = fontCapture([
    face("Fam", 'url(base.woff2) format("woff2")', "unicode-range: U+0020-007F;"),
    face("Fam", 'url(ext.woff2) format("woff2")', "unicode-range: U+0100-02AF;"),
  ]);
  const { html, report } = await run(c, baseFlows(), { fetchBytes: async () => bytes(10) });
  assert.equal((html.match(/@font-face/g) || []).length, 1);
  assert.deepEqual(report.dropped.fonts.map((d) => [d.family, d.reason.includes("unicode-range")]), [["Fam", true]]);
});

test("a finding's id is always the generated one, even if flows.json supplies another", async () => {
  const f = baseFlows();
  f.findings = [{ id: "mine", kind: "reused-component", screen: "home", component: "X", evidence: "e" }];
  const scan = scanOf((await run(baseCapture(), f)).html);
  assert.ok(scan.findings.some((x) => x.id === "reused-component:home"));
  assert.ok(!scan.findings.some((x) => x.id === "mine"));
});

test("a capture with no html for a device does not crash the assembly", async () => {
  const c = baseCapture();
  delete c.screens[1].captures.default.tablet.html;
  const scan = scanOf((await run(c)).html);
  assert.match(scan.screens[1].html.tablet, /flow-root/);
});

test("a screen in two groups is refused", async () => {
  const f = baseFlows();
  f.groups.push({ id: "again", title: "Again", screens: ["home"] });
  await rejects(() => run(baseCapture(), f), /home[\s\S]*two groups|two groups[\s\S]*home/);
});

test("when two captures share a path, the first screen in flows.json owns it", async () => {
  const c = baseCapture();
  c.screens.push(screen("dup", "/items/other", "/items/1", { default: cap() }));
  const f = baseFlows();
  f.screens.push({ id: "dup", name: "Dup", file: "d.tsx" });
  const scan = scanOf((await run(c, f)).html);
  assert.ok(scan.links.every((l) => l.to !== "items-other"));
});

test("a raw sheet keeps its other rules beside its fonts, rebases its urls, and says what it did", async () => {
  const c = baseCapture();
  c.screens[0].captures.default.desktop.html = '<p class="used">x</p>';
  c.screens[0].captures.default.desktop.families = ["Fam"];
  c.screens[0].captures.default.desktop.sheets = [{ key: "r", href: "http://h/d/r.css", raw: true, rules: [] }];
  const body = '@font-face{font-family:"Fam";src:url(f.woff2) format("woff2")}.used{background:url(i.png)}.unused-class{color:red}';
  const fetchBytes = async (u) => (u.endsWith("r.css") ? { bytes: Buffer.from(body), type: "text/css" } : u.endsWith("f.woff2") ? bytes(10) : bytes(10, "image/png"));
  const { html, report } = await run(c, baseFlows(), { fetchBytes });
  const css = html.match(/<style id="flow-scan-styles" media="not all">([\s\S]*?)<\/style>/)[1];
  assert.match(css, /data:font\/woff2/);
  assert.match(css, /\.used\{background:url\(data:image\/png/);
  assert.equal(report.rawSheets[0].kept, true);
});
