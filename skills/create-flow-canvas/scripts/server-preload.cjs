/* The one preload a dev server starts with during a capture. Quote the path, so a space in it cannot split it:

     NODE_OPTIONS="--require \"$SKILL/scripts/server-preload.cjs\"" npx next dev --port 3210

   It does three things:
   - blocks the outside network (block-network.cjs, with its FLOW_ALLOW_HOSTS);
   - freezes the server's Date at the capture's freeze.now, read from .flow-canvas/scenarios.json in the folder the
     server starts in or one above it. The capture freezes the browser; a server on real time renders different text
     ("2 hours ago"), and hydration fails. `"freeze": false` leaves the clock alone. With no scenarios file yet it uses
     capture's default instant. The file is read once, so restart the server after changing freeze;
   - loads anything in FLOW_PRELOAD, a comma-separated list of files, relative to where the server starts.

   The server's clock stands still even with `"clock": "run"`: only the starting instant has to agree. Random numbers
   are left alone here, because a server needs its ids and tokens to differ. Next's middleware (proxy.ts) runs in its
   own sandbox with its own Date, which this does not reach. */
"use strict";
const fs = require("node:fs");
const path = require("node:path");
require("./block-network.cjs");

const DEFAULT_NOW = "2026-01-15T12:00:00.000Z"; /* the same instant as DEFAULTS.freeze.now in capture.mjs */

function scenariosFreeze() {
  for (let dir = process.cwd(); ; dir = path.dirname(dir)) {
    const file = path.join(dir, ".flow-canvas", "scenarios.json");
    if (fs.existsSync(file)) {
      try {
        return JSON.parse(fs.readFileSync(file, "utf8")).freeze;
      } catch (error) {
        process.stderr.write(`[flow-canvas] could not read ${file}, so the server clock uses ${DEFAULT_NOW}: ${error.message}\n`);
        return undefined;
      }
    }
    if (dir === path.dirname(dir)) return undefined;
  }
}

function freezeDate(at) {
  const RealDate = Date;
  function FrozenDate(...args) {
    if (!new.target) return new RealDate(at).toString();
    return Reflect.construct(RealDate, args.length ? args : [at], new.target === FrozenDate ? RealDate : new.target);
  }
  FrozenDate.prototype = RealDate.prototype;
  FrozenDate.now = () => at;
  FrozenDate.parse = RealDate.parse;
  FrozenDate.UTC = RealDate.UTC;
  globalThis.Date = FrozenDate;
}

const freeze = scenariosFreeze();
if (freeze !== false) {
  const at = Date.parse(freeze?.now ?? DEFAULT_NOW);
  if (Number.isNaN(at)) process.stderr.write(`[flow-canvas] freeze.now "${freeze.now}" is not a date, so the server clock was not frozen\n`);
  else freezeDate(at);
}

for (const entry of (process.env.FLOW_PRELOAD || "").split(",").map((item) => item.trim()).filter(Boolean)) {
  require(path.resolve(process.cwd(), entry));
}
