/* Compares two RGBA buffers of the same size. Runs in the page, where PNGs can be decoded, serialised with toString().
   A pixel differs when its summed channel difference passes the threshold, which ignores antialiasing noise. */
export function diffPixels(a, b, width, height, threshold = 48) {
  let differing = 0;
  let minY = null;
  let maxY = null;
  for (let p = 0; p < a.length; p += 4) {
    if (Math.abs(a[p] - b[p]) + Math.abs(a[p + 1] - b[p + 1]) + Math.abs(a[p + 2] - b[p + 2]) > threshold) {
      differing++;
      const y = Math.floor(p / 4 / width);
      if (minY === null) minY = y;
      maxY = y;
    }
  }
  return { pct: Number(((differing / (width * height)) * 100).toFixed(2)), minY, maxY };
}
