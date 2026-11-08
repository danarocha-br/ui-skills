/* The capture names reference screenshots by the screen id in scenarios.json; the scan derives its ids from routes
   ("(404)" becomes "404"), so the two can differ. Routes are the same on both sides, but when two captures share a
   route the route cannot say which is meant, so the scan's own id is kept. */
export function refScreenId(screen, capturedScreens) {
  const same = (capturedScreens || []).filter((c) => c && c.route === screen.route);
  return same.length === 1 ? same[0].id : screen.id;
}
