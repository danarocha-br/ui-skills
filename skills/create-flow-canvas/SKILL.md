---
name: create-flow-canvas
description: Build an interactive flow canvas, a single HTML file, from a scanned codebase. It shows a product's real screens grouped into flows, with connectors, notes, scanner findings, an Inspect panel and mobile/tablet/desktop switching. Use when someone wants to see, review or document a product's flows from its code.
---

# Create flow canvas

Turns a codebase into one self-contained HTML canvas: screens laid out as frames, grouped into flows, tied together by connectors, with editable annotations on top. Open the file in a browser; nothing else to install.

## Status: draft

`assets/flow-canvas.html` is the reference build, made around a fictional plant-care app ("Loam"). The scanner and generator are not written yet. In the reference build the engine and the Loam data share one file; `docs/architecture-review.html` lists what to separate first (layout state owner, one commit seam, annotation kinds, engine vs scanned data).

Done so far: the layout (groups, positions per device, connectors, scanner cards, notes, id counters, undo history) has one owner, the `FlowLayout` module, in its own `<script id="layout-module">` block at the top of the canvas. It has no DOM and no demo knowledge, and `tests/layout.test.mjs` runs it on its own: `node --test skills/create-flow-canvas/tests/layout.test.mjs`. Every edit ends in one place too: the `FlowCommit` module (`<script id="commit-module">`) owns the undo point, the save and the redraw, in a fixed order. Open or closed groups are view state, so undo does not flip them. What notes, scanner cards and connectors share lives in a third module, `FlowAnnotations` (`<script id="annotations-module">`): one drag with one threshold and a real cancel, arrow-key moves, one Delete path, and one "is this an annotation" check. A kind brings an adapter; a new kind is one more adapter. Tests: `node --test skills/create-flow-canvas/tests/*.test.mjs`. Vocabulary is in `GLOSSARY.md`.

## What the canvas does

- **Frames and flows:** screens as frames, grouped into flows that open as a row or close into a stack. Drag frames to reorder, regroup or free them. Marquee-select, group, ungroup, rename.
- **Connectors:** straight runs with rounded corners between frames, drawn from live positions, so they follow every move. Drag from a frame's edge dot to create one. Labels are editable.
- **Annotations:** flow titles and descriptions, notes (one kind, saved with the layout, attach to a frame by dropping them on it), and scanner findings that point at the frame or component they describe.
- **Inspect panel:** route, source file, components (hover to spotlight on the frame, click to find every screen that uses it), states, notes.
- **Devices:** the same scan rendered at mobile, tablet or desktop size.
- **Tidy up:** puts groups and loose frames back in order without touching flows, groups or connectors.
- **Persistence:** the layout (groups with their titles and descriptions, positions, connectors, notes, scanner-finding changes) and the frame captions live in `localStorage`, under two keys; undo covers the layout, including group titles and descriptions, but not frame captions. Layouts and captions saved before group text moved into the layout are migrated on load.

## Intended workflow

1. Scan the codebase: routes, screens, the components each screen uses, states, and navigation between screens.
2. Turn the scan into data: screens, flows (groups), links (connectors), findings, notes.
3. Render each screen. Default: render the real page component in isolation with mocked providers, props and data, taking fixtures from existing stories or tests first. Fall back to a screenshot of the running app for a screen that will not render, and mark that card as an approximation.
4. Inject the data into the canvas template and write one HTML file into the repo, for example `docs/flows.html`.

## Rules for the canvas

- Product screens must not share class names with the canvas chrome. Render them in a shadow root or an iframe.
- Keep the engine free of demo knowledge: no hard-coded screen ids.
- Regenerating must not lose user edits. Key everything by stable ids (the route) and keep user edits separate from scanned data.
