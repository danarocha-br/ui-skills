/* The four annotation kinds the scan provides, as the tests' setups need them: their data halves (FlowScan.dataKinds)
   over a plain object shaped like the old layout defaults ({ conns, notes, scans, caps }), plus a no-op refresh so a
   FlowCommit can be made from the same list. A test that cares about a redraw wraps the kinds with its own refresh. */
import { FlowScan } from "./modules.mjs";

export const builtinKinds = (source = {}, { refresh = () => {} } = {}) => {
  const get = typeof source === "function" ? source : () => source;
  const scan = () => {
    const s = get();
    return {
      links: s.conns || [],
      findings: Array.isArray(s.scans) ? s.scans : [],
      notes: s.notes || [],
      screens: (s.caps || []).map(({ id, ...caption }) => ({ id, caption })),
    };
  };
  return FlowScan.dataKinds(scan).map((k) => ({ ...k, refresh: () => refresh(k.name) }));
};
