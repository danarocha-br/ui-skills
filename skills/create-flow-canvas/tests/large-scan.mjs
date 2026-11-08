/* A long flow with realistic render weight, repeated from the replaceable sample scan. */
export function largeScan(sample, count = 60) {
  const screens = Array.from({ length: count }, (_, i) => ({
    ...sample.screens[i % sample.screens.length], id: `screen-${i + 1}`,
    name: `Screen ${i + 1}`, route: `/screen/${i + 1}`,
  }));
  return { ...sample, product: { id: 'mount-benchmark', name: 'Mount benchmark' },
    start: screens[0].id, screens,
    groups: [{ id: 'long-flow', title: 'Long flow', screens: screens.map(s => s.id), open: true }],
    links: screens.slice(1).map((s, i) => ({ from: screens[i].id, to: s.id })), notes: [], findings: [] };
}
