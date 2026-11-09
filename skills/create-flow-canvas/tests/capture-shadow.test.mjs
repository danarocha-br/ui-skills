/* What capture keeps from a page, in a real browser: open shadow roots, the canvases inside them, and the facts the
   spinner signal depends on. Needs Playwright (FLOW_PLAYWRIGHT), and is skipped without it.
   Run:  FLOW_PLAYWRIGHT=/path/to/playwright node --test skills/create-flow-canvas/tests/capture-shadow.test.mjs */
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { loadPlaywright, launchBrowser } from "../scripts/lib/playwright.mjs";
import { pageExpression } from "../scripts/lib/page.mjs";

let playwright = null;
try { playwright = loadPlaywright(); } catch { /* the suite below is skipped */ }
const skip = playwright ? false : "Playwright not found: set FLOW_PLAYWRIGHT";
let browser;
before(async () => { if (playwright) browser = await launchBrowser(playwright); });
after(async () => { await browser?.close(); });

async function capture(html, setup = () => {}) {
  const page = await browser.newPage();
  try {
    await page.setContent(`<!doctype html><body>${html}</body>`);
    await page.evaluate(setup);
    const result = await page.evaluate(pageExpression({ names: [], budgets: { item: 150000, total: 1500000 } }));
    /* the markup, rendered with no script and no shadow root, is what the canvas gets */
    await page.setContent(`<!doctype html><body>${result.html}</body>`);
    return { result, page };
  } catch (error) { await page.close(); throw error; }
}

test("a canvas inside an open shadow root reaches the snapshot as a positioned image", { skip }, async () => {
  const { result, page } = await capture(`<div id="host" style="width:300px"></div>`, () => {
    const root = document.getElementById("host").attachShadow({ mode: "open" });
    root.innerHTML = `<style>.wrap { position: relative; height: 40px; background: rgb(1, 2, 3); }</style><div class="wrap"><canvas width="300" height="40" style="width:300px;height:40px"></canvas></div>`;
    const draw = root.querySelector("canvas").getContext("2d");
    draw.fillStyle = "red";
    draw.fillRect(0, 0, 300, 40);
  });
  try {
    assert.equal(result.inlined.canvases, 1);
    const seen = await page.evaluate(() => {
      const image = document.querySelector("#host img");
      const wrap = image?.parentElement;
      return { src: image?.src.slice(0, 15), width: image?.getBoundingClientRect().width, background: wrap && getComputedStyle(wrap).backgroundColor, height: wrap?.getBoundingClientRect().height, styles: document.querySelectorAll("#host style").length };
    });
    assert.deepEqual(seen, { src: "data:image/png;", width: 300, background: "rgb(1, 2, 3)", height: 40, styles: 0 });
  } finally { await page.close(); }
});

test("shadow text, nested shadow roots and slotted children all survive, in order", { skip }, async () => {
  const { page } = await capture(`<div id="host"><b>light</b></div>`, () => {
    const root = document.getElementById("host").attachShadow({ mode: "open" });
    root.innerHTML = `<span>before</span><slot></slot><div id="inner"></div>`;
    root.getElementById("inner").attachShadow({ mode: "open" }).innerHTML = `<i>nested</i>`;
  });
  try {
    assert.equal(await page.evaluate(() => document.getElementById("host").textContent), "beforelightnested");
  } finally { await page.close(); }
});

test("an image inside a shadow root is inlined like any other", { skip }, async () => {
  const pixel = "data:image/gif;base64,R0lGODlhAQABAAAAACw=";
  const { page } = await capture(`<div id="host"></div>`, new Function(`document.getElementById("host").attachShadow({ mode: "open" }).innerHTML = '<img src="${pixel}">';`));
  try {
    assert.equal(await page.evaluate(() => document.querySelector("#host img")?.getAttribute("src")), pixel);
  } finally { await page.close(); }
});

test("a light-DOM page is captured as before", { skip }, async () => {
  const { result, page } = await capture(`<div id="a" class="x"><canvas width="10" height="10"></canvas><p>text</p></div>`);
  try {
    assert.match(result.html, /<p>text<\/p>/);
    assert.equal(result.inlined.canvases, 1);
    assert.doesNotMatch(result.html, /<canvas/);
  } finally { await page.close(); }
});

const spinnerFacts = async (html) => {
  const { result, page } = await capture(html);
  await page.close();
  return result.facts.candidates;
};

test("a shadcn meter, whose root never gets a value, is recognised by its filled indicator", { skip }, async () => {
  const [bar] = await spinnerFacts(`<div role="progressbar" data-state="indeterminate" style="height:4px"><div style="height:4px;transform:translateX(-71%)"></div></div>`);
  assert.equal(bar.determinate, true);
  assert.equal(bar.tag, "div");
});

test("a bar with aria-valuenow is determinate, and an empty one is not", { skip }, async () => {
  assert.equal((await spinnerFacts(`<div role="progressbar" aria-valuenow="40" style="height:4px"></div>`))[0].determinate, true);
  assert.equal((await spinnerFacts(`<div role="progressbar" style="height:4px"><div style="height:4px"></div></div>`))[0].determinate, false);
});
