/* Keeps a dev server off the network during a capture. Mocks should already make outbound calls unnecessary; this
   makes sure one that was missed cannot reach a real service. Load it before the server starts:

     NODE_OPTIONS="--require /absolute/path/to/block-network.cjs" npm run dev

   NODE_OPTIONS reaches child processes and workers too. Connections to this machine and Unix sockets still work.
   FLOW_ALLOW_HOSTS is a comma-separated list of hosts to let through (next/font/google needs fonts.googleapis.com
   and fonts.gstatic.com when it fetches from JavaScript).

   Every Node client (http, https, fetch, tls, net) ends in net.Socket.prototype.connect, so that is the one place
   guarded. A refused connection fails asynchronously with code EFLOWBLOCKED, as a refused connection would, so the
   app's own error handling runs. Native code, such as a bundler written in Rust, does not go through Node and is not
   covered. */
"use strict";
const net = require("node:net");

const LOOPBACK = /^(localhost|127(\.\d+){3}|::1|\[::1\]|0\.0\.0\.0|::|::ffff:127(\.\d+){3})$/i;
const allowed = new Set((process.env.FLOW_ALLOW_HOSTS || "").split(",").map((host) => host.trim().toLowerCase()).filter(Boolean));
const announced = new Set();

/* The host a connect() call is for, or null when it stays on this machine. net.connect passes [options, callback]. */
function targetHost(args) {
  const first = Array.isArray(args[0]) ? args[0][0] : args[0];
  if (first && typeof first === "object") {
    if (first.path) return null;
    return first.host || first.hostname || "localhost";
  }
  if (typeof first === "string" && !/^\d+$/.test(first)) return null; /* a Unix socket path */
  return typeof args[1] === "string" ? args[1] : "localhost";
}

const realConnect = net.Socket.prototype.connect;
net.Socket.prototype.connect = function connect(...args) {
  const host = targetHost(args);
  if (host === null || LOOPBACK.test(host) || allowed.has(host.toLowerCase())) return realConnect.apply(this, args);
  if (!announced.has(host)) {
    announced.add(host);
    process.stderr.write(`[flow-canvas] refused outbound connection to ${host}\n`);
  }
  const error = Object.assign(new Error(`flow-canvas: outbound connection to ${host} refused during capture`), { code: "EFLOWBLOCKED", host });
  process.nextTick(() => this.destroy(error));
  return this;
};
