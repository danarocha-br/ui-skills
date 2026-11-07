---
name: create-flow-canvas
description: Build an interactive flow canvas, a single HTML file, from a scanned codebase. It shows a product's real screens grouped into flows, with connectors, notes, scanner findings, an Inspect panel and mobile/tablet/desktop switching. Use when someone wants to see, review or document a product's flows from its code.
---

# Create flow canvas

Turns a codebase into one self-contained HTML canvas: screens laid out as frames, grouped into flows, tied together by connectors, with editable annotations on top. Open the file in a browser; nothing else to install.

## Status: draft

`assets/flow-canvas.html` is the reference build, made around a fictional plant-care app ("Loam"). The scanner and generator are not written yet. The engine and the scan are separate inside the one file (see "The scan" below); `docs/architecture-review.html` lists what is still to separate (device description, the panel).

Done so far: the layout (groups, positions per device, connectors, findings, notes, id counters, undo history) has one owner, the `FlowLayout` module, in its own `<script id="layout-module">` block at the top of the canvas. It has no DOM and no demo knowledge, and `tests/layout.test.mjs` runs it on its own: `node --test skills/create-flow-canvas/tests/layout.test.mjs`. Every edit ends in one place too: the `FlowCommit` module (`<script id="commit-module">`) owns the undo point, the save and the redraw, in a fixed order. Open or closed groups are view state, so undo does not flip them. What notes, findings and connectors share lives in a third module, `FlowAnnotations` (`<script id="annotations-module">`): one drag with one threshold and a real cancel, arrow-key moves, one Delete path, and one "is this an annotation" check. A kind brings an adapter; a new kind is one more adapter. Dragging frames or a group has its own too, `FlowGesture` (`<script id="gesture-module">`): the drag holds a proposal outside the layout, the canvas draws the layout as it would be (`gesture.view()`), and the drop commits once; Escape and a taken-away pointer throw the proposal away, so there is nothing to restore. Group-making is one data change, `layout.groupFrames`, shared by ⌘G and a drop onto a frame. A device is described once, in `FlowDevice` (`<script id="device-module">`): its screen and caption sizes, style variables, frame class, switcher button and key are all derived from that one entry, and a note with no place of its own on a device is carried over from one that has it, so it keeps its spot on the screen instead of jumping. Adding a device is one entry there, its renderings of each screen, and an icon symbol. Tests: `node --test skills/create-flow-canvas/tests/*.test.mjs`. 

The scan: what a scanner finds lives in `<script type="application/json" id="flow-scan">`, with the product's own styles in `<style id="flow-scan-styles">` and, optionally, its in-screen reactions in `<script id="flow-scan-behaviour">` (`FlowScanBehaviour.onTap(screenId, target, phone)`). The generator replaces those three blocks and nothing else; Loam is the sample scan. The engine reads the scan only through `FlowScan` (`<script id="scan-module">`): `read` cleans it (dropping and reporting anything that points at a screen the scan does not have), `merge` and `diff` lay the user's edits over it and take them off again. The shape is documented at the top of that block. The engine knows two finding kinds, `unreachable-states` and `reused-component`, and writes their wording from the facts the scan gives; a screen with more than one rendered state gets the state switcher. A button inside a screen (`data-go="<screen id>"`) only follows a connector that exists, so a link in the scan is the one answer to "A leads to B". `tests/engine-purity.test.mjs` fails if the engine's scripts or page name a screen, finding, note, component, product or product class that only the sample has (wording that is not one of those words it cannot know).

Vocabulary is in `GLOSSARY.md`.

## What the canvas does

- **Frames and flows:** screens as frames, grouped into flows that open as a row or close into a stack. Drag frames to reorder, regroup or free them. Marquee-select, group, ungroup, rename.
- **Connectors:** straight runs with rounded corners between frames, drawn from where each frame is at that moment (`FlowGeometry`, `<script id="geometry-module">`), so they follow every slide, however many frames the flow has. The routing itself is `FlowRouting` (`<script id="routing-module">`). Drag from a frame's edge dot to create one. Labels are editable.
- **Annotations:** flow titles and descriptions, notes (one kind, saved with the layout, attach to a frame by dropping them on it), and scanner findings that point at the frame or component they describe.
- **Inspect panel:** route, source file, components (hover to spotlight on the frame, click to find every screen that uses it), states, notes.
- **Devices:** the same scan rendered at mobile, tablet or desktop size.
- **Tidy up:** puts groups and loose frames back in order without touching flows, groups or connectors.
- **Persistence:** the layout (groups with their titles and descriptions, positions, and the user's edits to the scan's connectors, notes and findings plus the connectors and notes the user made) and the frame captions (only the fields the user changed) live in `localStorage`, under two keys; undo covers the layout, including group titles and descriptions, but not frame captions. Because the scan is not copied into storage, a regenerated scan reaches people who already saved a layout, and their edits win where they touched it. Layouts saved before this (full lists of connectors and notes, whole captions, group text kept elsewhere) are migrated on load.

## Intended workflow

1. Scan the codebase: routes, screens, the components each screen uses, states, and navigation between screens.
2. Turn the scan into data: screens, flows (groups), links (connectors), findings, notes.
3. Render each screen. Default: render the real page component in isolation with mocked providers, props and data, taking fixtures from existing stories or tests first. Fall back to a screenshot of the running app for a screen that will not render, and mark that card as an approximation.
4. Inject the data into the canvas template and write one HTML file into the repo, for example `docs/flows.html`.

## Rules for the canvas

- Product screens must not share class names with the canvas chrome. Render them in a shadow root or an iframe.
- Keep the engine free of demo knowledge: no hard-coded screen ids, finding ids, component names, product class names or product wording. The scan carries all of it.
- Regenerating must not lose user edits. Give every scanned item a stable id (the scanner chooses; the engine reads no meaning into it) and keep user edits separate from scanned data: the saved layout holds edits, never copies.
