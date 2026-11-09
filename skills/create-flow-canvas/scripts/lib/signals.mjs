/* What a wrong mock looks like. Pixel diff cannot see one: the reference shows the same skeleton or error toast.
   The page gathers plain facts; this decides what they suggest. Every signal is a suspicion for a person or agent to
   check, not a verdict. */

/* Where a page ended up when it was not where it was sent: null when it stayed. Path and query count, the hash and a
   trailing slash do not. A client-side redirect (a router.push after load) shows up here, not as a failed capture. */
export function redirectOf(requested, finalUrl) {
  const norm = (u) => { const url = new URL(u, "http://flow.invalid"); url.searchParams.sort(); return (url.pathname.replace(/\/+$/, "") || "/") + url.search; };
  try {
    return norm(requested) === norm(finalUrl) ? null : { requested, final: norm(finalUrl) };
  } catch { return null; }
}

/* Signals a state lists in its `acknowledge` are dropped: the person who wrote the state looked and said it is expected. */
export function acknowledged(signals, kinds) {
  return Array.isArray(kinds) && kinds.length ? signals.filter((signal) => !kinds.includes(signal.kind)) : signals;
}

/* A persona or scenario that changes nothing is usually a mock that is not reading its cookie. Two states that ask for
   different personas or scenarios but render the same markup on a device are reported with that device. */
export function identicalStates(states, captures) {
  const out = [];
  const ask = (state) => `${state.persona ?? ""}\u0000${state.scenario ?? ""}`;
  for (let i = 0; i < states.length; i++) for (let j = i + 1; j < states.length; j++) {
    const a = states[i], b = states[j];
    if (ask(a) === ask(b)) continue;
    const devices = Object.keys(captures[a.name] ?? {}).filter((d) => captures[b.name]?.[d] && captures[a.name][d].html === captures[b.name][d].html);
    if (devices.length) out.push({ kind: "states-identical", states: [a.name, b.name], devices });
  }
  return out;
}

/* A route written as "(404)" is a screen that stands for the not-found page, so its 404 is the point. */
const notFoundExpected = (route, status) => status === 404 && /^\(.*\)$/.test(route ?? "");

export function suspectSignals({ candidates, textLength, elementCount, mediaCount, bodyText, devOverlayError, redirect, document, failedRequests = [], route }) {
  /* a token with a colon is a Tailwind variant: it describes another state, not this one */
  const tokens = (cls) => cls.split(/\s+/).filter((token) => token && !token.includes(":"));
  const anyToken = (cls, pattern) => tokens(cls).some((token) => pattern.test(token));
  const isSkeleton = (el) => anyToken(el.cls, /skeleton|shimmer|^animate-pulse$/i) || /skeleton/i.test(el.slot);
  /* a bar showing a value (a usage meter, a step count) has finished loading; only one with no value is waiting */
  const isSpinner = (el) => el.busy || (el.role === "progressbar" && !el.determinate) || anyToken(el.cls, /^animate-spin$|spinner|loader|loading/i);
  const isErrorToast = (el) => {
    if (!el.text.trim()) return false;
    if (el.role === "alert") return true;
    if (el.toast && /error|destructive/i.test(el.type)) return true;
    return anyToken(el.cls, /toast/i) && anyToken(el.cls, /error|destructive/i);
  };
  const signals = [];
  const report = (kind, test) => {
    const found = candidates.filter(test);
    if (!found.length) return;
    const signal = { kind, count: found.length };
    /* an element with no text (a bar, an icon) is named by its markup, or the report could not say what raised this */
    const describe = (el) => el.text.trim().slice(0, 120) || (el.tag ? `<${el.tag}${el.role ? ` role=${el.role}` : ""}${el.cls ? ` class="${el.cls.slice(0, 80)}"` : ""}>` : "");
    const samples = found.map(describe).filter(Boolean).slice(0, 3);
    if (samples.length) signal.samples = samples;
    signals.push(signal);
  };
  report("skeleton", isSkeleton);
  report("spinner", isSpinner);
  report("error-toast", isErrorToast);
  const crash = /application error|something went wrong|internal server error|unhandled runtime error/i.exec(bodyText);
  if (crash) signals.push({ kind: "error-text", count: 1, samples: [crash[0]] });
  if (textLength < 20 && elementCount < 15 && mediaCount === 0) signals.push({ kind: "near-empty", count: 1 });
  if (devOverlayError) signals.push({ kind: "dev-overlay", count: 1 });
  if (redirect) signals.push({ kind: "redirected", count: 1, samples: [`${redirect.requested} -> ${redirect.final}`] });
  if (document && document.status >= 400 && !notFoundExpected(route, document.status)) signals.push({ kind: "http-error", count: 1, samples: [`${document.status} ${document.path}`] });
  if (failedRequests.length) signals.push({ kind: "failed-requests", count: failedRequests.length, samples: [...new Set(failedRequests.map((r) => `${r.status} ${r.path}`))].slice(0, 3) });
  return signals;
}
