/* Resuming a capture, and noticing that the browser itself is gone. */

const add = (a = {}, b = {}) => { const out = { ...a }; for (const [k, v] of Object.entries(b)) out[k] = (out[k] || 0) + v; return out; };

/* `only` are the screen ids that were captured this run; every other screen comes from the previous capture.json.
   A screen in `only` replaces the old one whole, so a state removed from the scenarios goes with it. A screen the
   scenarios no longer list is dropped, and the order is the scenarios' own. */
export function mergeResume(previous, fresh, only, configured) {
  if (!previous) return { ...fresh, screens: configured.map((id) => fresh.screens.find((s) => s.id === id)).filter(Boolean) };
  const pick = (id) => (only.includes(id) ? fresh.screens : previous.screens).find((s) => s.id === id);
  return {
    ...fresh,
    screens: configured.map(pick).filter(Boolean),
    errors: [...(previous.errors || []).filter((e) => configured.includes(e.screen) && !only.includes(e.screen)), ...fresh.errors],
    blocked: add(previous.blocked, fresh.blocked),
    assets: add(previous.assets, fresh.assets),
    escaped: add(previous.escaped, fresh.escaped),
  };
}

/* Chrome can die mid-run (memory, a machine under load); the capture that was running did not fail on its merits. */
export const isBrowserGone = (error) => /has been closed|browser closed|target closed|browser has disconnected|Connection closed/i.test(String(error?.message ?? error));
