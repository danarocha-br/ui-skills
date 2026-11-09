# Contract between scripts/capture.mjs and scripts/assemble.mjs

Read this when changing either script, or when debugging a capture by reading its JSON. Capture writes `.flow-canvas/capture/capture.json`:

{ screens: [{ id, route, url, states: [{ name, persona }],
    captures: { "<state name>": { "<mobile|tablet|desktop>": {
      html, rootCls, bodyCls, bg, color, font, fs, families: [string],
      links: [{ href, text }], title,
      sheets: [{ key, href, raw?: true, rules: [Rule] }] } } } }],
  blocked: { host: count }, assets: { host: count }, errors: [] }

Rule is { s, t, u } (style rule: selector, text, used), { g, c: [Rule] } (grouping rule: head, children) or { t, u: true } (other at-rules).
`html` carries `data-flow-c="Name Name"` and `data-flow-href`.

Each capture (`captures[state][device]`) also has:
- `scrollH` (number)
- `pageErrors: [string]`, uncaught page errors, at most 5
- `finalUrl`: the path and query the page was on after settling. When it differs from the entry's `url`, the signals carry `redirected`
- `textColors: { "<computed colour>": characters }`, the visible text counted by colour (at most 24 colours). `fidelity.mjs` counts the canvas frame the same way and fails when more than `--max-color-pct` (5) of the characters changed colour: pixel comparison cannot see a wrong colour on a few words
- `signals: [{ kind, count, samples?: [string] }]`, suspected wrong mock. kind is skeleton | spinner | error-toast | error-text | near-empty | dev-overlay | redirected (samples: `"<asked> -> <ended>"`). A state's `acknowledge` removes kinds
- `components: { source: "react-fiber" | "none", tagged: number, error?: string }`. With "none", `html` has no `data-flow-c`
- `inlined: { images, canvases, bytes, dropped: [url or "canvas"] }`. A dropped image has no `src` and a grey background

Top level:
- `errors` is `[{ screen, state, device, message }]`. A failed capture is absent from `captures`, so the assembler must tolerate a missing device
- `errors[]` entries also carry `pageErrors: [string]`
- `socketsGuarded: boolean`
- Screen entries carry `warnings: [{ kind: "states-identical", states: [a, b], devices }]`: states that ask for different personas or scenarios but render the same markup. `report.json` lists them under `warnings`
- `--only id,id` recaptures just those screens and merges them into the existing capture.json (a screen is replaced whole; a screen the scenarios no longer list is dropped)
- `escaped: { host: count }`, outside hosts reached by a redirect from the app (Playwright cannot route those)
- The assembler copies each error onto its state as `failed: { <device>: message }` in the scan. The canvas shows "Capture failed on <device>" there (never "doesn't exist"), and `validate.mjs` fails on it
- A state may list `devices: ["desktop"]`; the other devices are then absent from its captures, on purpose. Scenarios may also set top-level `cookies`, `freeze`, `budgets`, `settleMs`
- Screen entries carry whatever scenarios.json gave (`id, route, url, states`), including `states[].steps`

Next to capture.json: `report.json` (same run, no page bodies) and `ref-<screen>-<state slug>-<device>.png`, slug being `name.replace(/\W/g, "_")`.

scripts/fidelity.mjs reads the assembled canvas's `flow-scan` and `flow-scan-styles` blocks, expecting `screens[].html[device]` for the first state and `screens[].states[i].html[device]` for later ones.
