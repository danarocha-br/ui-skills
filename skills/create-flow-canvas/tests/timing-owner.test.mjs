/* Every wait in the page has a name or a signal (N7). A number written into setTimeout(…, 450) or sleep(450) is a
   guess about how long something else takes (a CSS transition, a slide, a panel opening), and nothing fails when
   that something changes. So the page keeps its durations in one table, TIMING, which also feeds the stylesheet where
   it needs the same number, and waits on what it means: geometry's settled, a transition's end, the next frame. This
   guard reads the page's script and fails on a timer that spells its own number, and on reading the world's
   computed transform to find out where something is (ask the geometry).
   It reads source text, so it sees a use whether or not the line runs.
   Run:  node --test skills/create-flow-canvas/tests/timing-owner.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { html } from "./modules.mjs";

const strip = (src) => src.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
const page = strip([...html.matchAll(/<script>([\s\S]*?)<\/script>/g)].map((m) => m[1]).sort((a, b) => b.length - a.length)[0]);
const lineOf = (src, i) => src.slice(0, i).split("\n").length;

/* the text between the parentheses of the call that opens at `open` (the index of its "(") */
function argsAt(src, open) {
  let depth = 0;
  for (let i = open; i < src.length; i++) {
    if (src[i] === "(" || src[i] === "[" || src[i] === "{") depth++;
    else if (src[i] === ")" || src[i] === "]" || src[i] === "}") {
      depth--;
      if (!depth) return src.slice(open + 1, i);
    }
  }
  return "";
}
/* split at the commas that are not inside brackets */
function split(args) {
  const out = [];
  let depth = 0,
    from = 0;
  for (let i = 0; i < args.length; i++) {
    if ("([{".includes(args[i])) depth++;
    else if (")]}".includes(args[i])) depth--;
    else if (args[i] === "," && !depth) (out.push(args.slice(from, i)), (from = i + 1));
  }
  out.push(args.slice(from));
  return out.map((a) => a.trim());
}
/* a number other than 0 spelled out (0 is "after this turn", which waits for nothing) */
const SPELLED = /(^|[^\w.$])[1-9]\d*(\.\d+)?\b|(^|[^\w$])0\.\d+/;

test("the page's script is found, and it keeps its durations in one table", () => {
  assert.ok(page.includes("FlowScan.read("), "the page script");
  assert.match(page, /const TIMING = Object\.freeze\(\{/);
});

test("no timer in the page spells its own duration: it names one from TIMING, or waits on a signal", () => {
  const found = [];
  for (const m of page.matchAll(/\b(setTimeout|sleep)\s*\(/g)) {
    const open = m.index + m[0].length - 1;
    const args = split(argsAt(page, open));
    const wait = m[1] === "sleep" ? args[0] : args[1];
    if (wait !== undefined && SPELLED.test(wait)) found.push(`line ${lineOf(page, m.index)}  ${m[1]}(… ${wait})`);
  }
  assert.deepEqual(
    found,
    [],
    "name the duration in TIMING (and feed the stylesheet from it if CSS runs the same length), or wait on geometry's " +
      "settled, a transitionend, or the next frame",
  );
});

test("nothing asks the page where the world is: the camera and the geometry know", () => {
  const found = [...page.matchAll(/getComputedStyle\(\s*world\s*\)/g)].map((m) => `line ${lineOf(page, m.index)}`);
  assert.deepEqual(found, [], "use cam for the camera and geo.rect / geo.worldOf for a frame");
});
