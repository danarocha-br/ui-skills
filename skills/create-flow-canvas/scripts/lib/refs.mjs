/* The capture names reference screenshots by the screen id in scenarios.json; the scan derives its ids from routes
   ("(404)" becomes "404"), so the two can differ. Routes are the same on both sides. */
export function refScreenId(screen, capturedScreens) {
  const match = (capturedScreens || []).find((c) => c && c.route === screen.route);
  return match ? match.id : screen.id;
}
