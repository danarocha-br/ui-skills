/* Runs in the page before any of its scripts, so a first-visit banner or a saved preference is already settled.
   Serialised with toString(). A frame that refuses storage (about:blank) is left alone. */
export function seedLocalStorage(entries) {
  try {
    for (const [key, value] of Object.entries(entries)) localStorage.setItem(key, value);
  } catch { /* no storage in this frame */ }
}

/* Runs in the page before any of its scripts, so two captures of a screen see the same random numbers and the same
   time. Serialised with toString(): it may use only its argument and globals. */
export function freezeClockAndRandom({ now, seed, clock }) {
  const RealDate = Date;
  const base = new RealDate(now).getTime();
  const began = RealDate.now();
  /* "run": start at the frozen time but keep moving, for animation libraries that stall on a clock that stands still */
  const current = () => (clock === "run" ? base + (RealDate.now() - began) : base);
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(current()).toString();
    return Reflect.construct(RealDate, args.length ? args : [current()], new.target === FrozenDate ? RealDate : new.target);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = current;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  globalThis.Date = FrozenDate;

  let state = seed >>> 0; /* mulberry32 */
  Math.random = () => {
    state = (state + 0x6d2b79f5) >>> 0;
    let t = state;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
  if (globalThis.crypto?.randomUUID) {
    const hex = (count) => Array.from({ length: count }, () => Math.floor(Math.random() * 16).toString(16)).join("");
    crypto.randomUUID = () => `${hex(8)}-${hex(4)}-4${hex(3)}-${"89ab"[Math.floor(Math.random() * 4)]}${hex(3)}-${hex(12)}`;
  }
}
