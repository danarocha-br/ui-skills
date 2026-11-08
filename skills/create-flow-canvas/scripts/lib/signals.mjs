/* What a wrong mock looks like. Pixel diff cannot see one: the reference shows the same skeleton or error toast.
   The page gathers plain facts; this decides what they suggest. Every signal is a suspicion for a person or agent to
   check, not a verdict. */

export function suspectSignals({ candidates, textLength, elementCount, mediaCount, bodyText, devOverlayError }) {
  /* a token with a colon is a Tailwind variant: it describes another state, not this one */
  const tokens = (cls) => cls.split(/\s+/).filter((token) => token && !token.includes(":"));
  const anyToken = (cls, pattern) => tokens(cls).some((token) => pattern.test(token));
  const isSkeleton = (el) => anyToken(el.cls, /skeleton|shimmer|^animate-pulse$/i) || /skeleton/i.test(el.slot);
  const isSpinner = (el) => el.busy || el.role === "progressbar" || anyToken(el.cls, /^animate-spin$|spinner|loader|loading/i);
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
    const samples = found.map((el) => el.text.trim().slice(0, 120)).filter(Boolean).slice(0, 3);
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
  return signals;
}
