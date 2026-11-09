/* Text colour, counted. A pixel comparison of two renders passes while a code block is purple where it should be red,
   because the words are a sliver of the screen. The characters of the page, counted by computed colour, say it plainly.
   textColors runs in the page (serialised with toString(), so it may use only globals); colorDrift runs anywhere. */

export function textColors() {
  const counts = {};
  const walker = document.createTreeWalker(document.body, NodeFilter.SHOW_TEXT);
  for (let node = walker.nextNode(); node; node = walker.nextNode()) {
    const element = node.parentElement;
    if (!element || /^(SCRIPT|STYLE|NOSCRIPT|TEMPLATE)$/.test(element.tagName)) continue;
    const length = node.textContent.replace(/\s+/g, "").length;
    if (!length) continue;
    const style = getComputedStyle(element);
    if (style.display === "none" || style.visibility === "hidden") continue;
    counts[style.color] = (counts[style.color] || 0) + length;
  }
  return Object.fromEntries(Object.entries(counts).sort((a, b) => b[1] - a[1]).slice(0, 24));
}

/* The share of the expected characters (in percent) that are no longer in their colour, and the three colours that lost the most. */
export function colorDrift(expected, actual) {
  const total = Object.values(expected).reduce((sum, n) => sum + n, 0);
  if (!total) return { pct: 0, detail: [] };
  const lost = Object.entries(expected).map(([color, n]) => ({ color, expected: n, actual: actual[color] || 0 })).filter((c) => c.actual < c.expected);
  const changed = lost.reduce((sum, c) => sum + (c.expected - c.actual), 0);
  return { pct: Number(((changed / total) * 100).toFixed(1)), detail: lost.sort((a, b) => b.expected - b.actual - (a.expected - a.actual)).slice(0, 3) };
}
