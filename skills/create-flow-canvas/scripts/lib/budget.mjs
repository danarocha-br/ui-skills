/* Runs in the page too, serialised with toString(). */
export function fitsBudget(size, usedSoFar, { item, total }) {
  return size <= item && usedSoFar + size <= total;
}
