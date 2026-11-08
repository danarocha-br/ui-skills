/* Runs in the page before any of its scripts, so two captures of a screen see the same random numbers and the same
   time. Serialised with toString(): it may use only its argument and globals. */
export function freezeClockAndRandom({ now, seed }) {
  const RealDate = Date;
  const fixed = new RealDate(now).getTime();
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(fixed).toString();
    return Reflect.construct(RealDate, args.length ? args : [fixed], new.target === FrozenDate ? RealDate : new.target);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = () => fixed;
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
