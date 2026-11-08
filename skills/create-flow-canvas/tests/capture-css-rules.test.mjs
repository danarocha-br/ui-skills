/* Which captured CSS rules survive pruning. The probe rewrites a selector so it asks "could this ever match the DOM
   we captured", whatever the pointer and focus happen to be at capture time.
   Run:  node --test skills/create-flow-canvas/tests/capture-css-rules.test.mjs   (from the repo root) */
import { test } from "node:test";
import assert from "node:assert/strict";
import { selectorProbe, walkRules } from "../scripts/lib/css-rules.mjs";

test("an interactive state is neutralised, because it may be true for a viewer later", () => {
  assert.equal(selectorProbe(".a:hover"), ".a:is(*)");
  assert.equal(selectorProbe("a:focus-visible > b:focus-within"), "a:is(*) > b:is(*)");
  assert.equal(selectorProbe("input:DISABLED"), "input:is(*)");
});

test("structural pseudo-classes are left alone, so a rule that cannot match is still dropped", () => {
  assert.equal(selectorProbe(".stack > :not(:last-child)"), ".stack > :not(:last-child)");
  assert.equal(selectorProbe("li:nth-child(2n + 1):first-of-type"), "li:nth-child(2n + 1):first-of-type");
  assert.equal(selectorProbe(".a:empty"), ".a:empty");
});

test("a state inside :not() cannot be neutralised, so the rule is simply kept", () => {
  assert.equal(selectorProbe(".a:not(:hover)"), null);
  assert.equal(selectorProbe(".a:not(:nth-child(2), :focus)"), null);
  assert.equal(selectorProbe(".a:not(:is(.b, :active))"), null);
});

test("a state after a closed :not() is neutralised as usual", () => {
  assert.equal(selectorProbe(".a:not(.b):hover"), ".a:not(.b):is(*)");
  assert.equal(selectorProbe(":not(:nth-child(2)):hover"), ":not(:nth-child(2)):is(*)");
});

test("a state inside :is() or :where() is neutralised in place", () => {
  assert.equal(selectorProbe(":is(.a:hover, .b)"), ":is(.a:is(*), .b)");
});

test("escaped class names and quoted attributes are not read as pseudo-classes", () => {
  assert.equal(selectorProbe(".hover\\:focus\\:x:hover"), ".hover\\:focus\\:x:is(*)");
  assert.equal(selectorProbe('[data-x=":hover"]'), '[data-x=":hover"]');
  assert.equal(selectorProbe(".a[title='b)c:focus']:focus"), ".a[title='b)c:focus']:is(*)");
});

test("pseudo-elements stand in as matching anything, keeping the selector valid", () => {
  assert.equal(selectorProbe(".a::before"), ".a:is(*)");
  assert.equal(selectorProbe(".a:after"), ".a:is(*)");
  assert.equal(selectorProbe(".a > ::marker"), ".a > :is(*)");
  assert.equal(selectorProbe("::-webkit-scrollbar-thumb:hover"), ":is(*):is(*)");
  assert.equal(selectorProbe("::highlight(found)"), ":is(*)");
});

const style = (selectorText, extra = {}) => ({ selectorText, cssText: `${selectorText} { color: red; }`, ...extra });
const matchesOnly = (...selectors) => (probe) => selectors.includes(probe);

test("a style rule records whether its probe matched", () => {
  assert.deepEqual(walkRules([style(".a"), style(".b:hover")], matchesOnly(".b:is(*)")), [
    { s: ".a", t: ".a { color: red; }", u: false },
    { s: ".b:hover", t: ".b:hover { color: red; }", u: true },
  ]);
});

test("a rule is kept when its selector cannot be probed, or a state sits in :not()", () => {
  const throws = () => { throw new Error("invalid selector"); };
  assert.equal(walkRules([style(":-moz-only")], throws)[0].u, true);
  assert.equal(walkRules([style(".a:not(:hover)")], () => false)[0].u, true);
});

test("a style rule with nested rules is kept whole", () => {
  assert.equal(walkRules([style(".a", { cssRules: [style("& .b")] })], () => false)[0].u, true);
});

test("media, supports, layer and container rules are walked; their head is kept", () => {
  const media = { cssText: "@media (min-width: 40rem) { .a { color: red; } }", cssRules: [style(".a")] };
  assert.deepEqual(walkRules([media], () => true), [
    { g: "@media (min-width: 40rem)", c: [{ s: ".a", t: ".a { color: red; }", u: true }] },
  ]);
  const layer = { cssText: "@layer base { .a { } }", cssRules: [] };
  assert.equal(walkRules([layer], () => true)[0].g, "@layer base");
});

test("other at-rules are kept as text, even those with children", () => {
  const keyframes = { cssText: "@keyframes spin { to { rotate: 1turn; } }", cssRules: [{ cssText: "to { rotate: 1turn; }" }] };
  const face = { cssText: '@font-face { font-family: "X"; }' };
  assert.deepEqual(walkRules([keyframes, face], () => false), [
    { t: keyframes.cssText, u: true },
    { t: face.cssText, u: true },
  ]);
});
