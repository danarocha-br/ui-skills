/* What assemble prints about dropped fonts. Subsets are routine, so they get one line that says what to check. */
const SUBSET = "a unicode-range subset, not the base family";

export function droppedFontLines(fonts) {
  const subsets = fonts.filter((font) => font.reason === SUBSET);
  const lines = fonts.filter((font) => font.reason !== SUBSET).map((font) => `  dropped font ${font.family}: ${font.reason}`);
  if (subsets.length) {
    const families = [...new Set(subsets.map((font) => font.family))].join(", ");
    lines.push(`  skipped ${subsets.length} extra character-range files of ${families}: normal, the base range is kept. Characters only in a skipped range (non-Latin scripts, rare symbols) fall back to another font, so check a screen that uses them.`);
  }
  return lines;
}
