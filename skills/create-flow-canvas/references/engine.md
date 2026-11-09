# The canvas engine

How `assets/flow-canvas.html` works inside. Read this only when changing the engine, debugging a canvas that misbehaves after a clean `validate`, or writing a scan by hand. Producing a canvas with the scripts does not need it. Vocabulary is in `../GLOSSARY.md`; keyboard behaviour is in `keyboard.md`.

## Contents

- What the canvas does
- Rules for the engine
- The scan: blocks, shape, identity, escaping
- Modules, one owner per subject
- Screens: iframes, mounting, trust
- Tests

## What the canvas does

- **Frames and flows:** screens as frames, grouped into flows that open as a row or close into a stack. Drag frames to reorder, regroup or free them. Marquee-select, group, ungroup, rename.
- **Connectors:** straight runs with rounded corners between frames, routed through the gutters so they do not cross a frame, drawn from where each frame is at that moment, so they follow every slide. Drag from a frame's edge dot to create one. Labels are editable, stand on a clear stretch of their line, and are cut to fit or tucked to a dot rather than overlap.
- **Shared navigation:** links on many screens (a sidebar, a header) are noted once above everything instead of being drawn per screen.
- **Annotations:** flow titles and descriptions, notes (one kind, saved with the layout, attached to a frame by dropping them on it), and scanner findings that point at the frame or component they describe.
- **Inspect panel:** route, source file, components (hover to spotlight on the frame, click to find every screen that uses it), states, notes.
- **Devices:** the same scan rendered at mobile, tablet or desktop size.
- **Tidy up:** puts groups and loose frames back in order without touching flows, groups or connectors.
- **Persistence:** the layout lives in `localStorage` under one product-scoped key: positions, the user's edits to the scan's groups (title, description, which frames are in which group and in what order), connectors, notes, findings and frame captions, plus the groups, connectors and notes the user made. Undo covers all of it except open/closed groups, which are saved with the layout but are not an undo step. Because the scan is not copied into storage, a regenerated scan reaches people who already saved a layout, and their edits win where they touched it. A layout saved in an older shape is not read: the canvas starts from the scan and the old one is replaced on the next save.

## Rules for the engine

- Keep frame wrappers and labels present independently of screen documents. Use the browser-free `FlowMounts` policy for nearby, selected and requested screens; apply its answer through `FrameDom.retain`, and mount and await a document before Inspect or Search reads it. Preserve temporary interactions across unmounts in memory; leave the layout save format unchanged.
- Render each mounted product screen in its own iframe at the real device viewport from `FlowDevice`, with its own styles and SVG symbols. Product DOM stays inside the live screen host; the page receives ids and values, never product nodes. Keep the scan styles inert in the shell. Route events through the host, keep native controls and scrolling usable, and wait for replacement documents before rebuilding Inspect or Search. An iframe supplies the separate viewport needed by media queries, viewport units and fixed-position elements; a shadow root alone does not.
- Keep the engine free of demo knowledge: no hard-coded screen ids, finding ids, component names, product class names or product wording. The scan carries all of it. `assets/flow-canvas.html` ships with a sample scan for a fictional plant-care app ("Loam"), and `tests/engine-purity.test.mjs` fails if the engine's scripts or page name a screen, finding, note, component, product or product class that only the sample has.
- Regenerating must not lose user edits. Give every scanned item a stable id and keep user edits separate from scanned data: the saved layout holds edits over the scan, never copies of it (what the user made themselves is kept whole).

## The scan

### The three blocks

A generator replaces the contents of these blocks and nothing else:

- `<script type="application/json" id="flow-scan">`: what was found. It is JSON inside a `<script>`, so `</` is written `<\/`.
- `<style id="flow-scan-styles" media="not all">`: the product's styles, scoped colour and font tokens, font imports and reset. `media="not all"` keeps it inert in the canvas document (`tests/engine-purity.test.mjs` checks it); it is copied into each screen.
- `<script id="flow-scan-behaviour">`: optional in-screen reactions, `FlowScanBehaviour.onTap(screenId, target, root)`.

Product SVG symbols are the scan's optional `icons` markup, mounted locally in each screen document; the shell's sprite contains only canvas icons. The rendering contract is a `.phone` body inside each iframe, with device classes supplied by `FlowDevice`. Relative assets resolve against the canvas URL.

### Shape and reading

The shape is documented in the header of `<script id="scan-module">`. The engine reads the scan only through `FlowScan`: `read(raw, { devices, validateSelector? })` cleans it, dropping and reporting anything that points at a screen the scan does not have (the caller names the devices, so the scan module never reads the device module); `merge` and `diff` lay the user's edits over it and take them off again; `mergeGroups` and `diffGroups` do the same for groups, adding which frames are in which group. The browser passes its native CSS parser to `read`; bad component selectors are reported and omitted, so Inspect still opens. Without that parser only selector types and emptiness are checked.

- Findings: the engine knows `unreachable-states` and `reused-component` and writes their wording from the facts the scan gives. Any other kind shows its `text`.
- A screen with more than one rendered state gets the state switcher.
- `approximate: true` puts a badge on the frame and a line in Inspect. `unrendered: "reason"` gives a placeholder with the reason where the screen has no render. A state missing a device gets a placeholder saying it does not exist there; the screen's first state, stored in `screen.html`, does not, and shows blank on that device. A state's `failed: { device: reason }` (the assembler writes it from capture errors) gives "Capture failed on <device>" with the reason instead, first state included, and the validator treats it as an error.
- The strip under a frame takes the background of a `.flow-root` element at the top of the screen when there is one and it is painted, otherwise the body's.
- A button inside a screen (`data-go="<screen id>"`) follows a connector that exists or the scan's `navigation`, so those two are the answer to "A leads to B".
- `navigation: [{ to, label, from }]` is what the assembler took out of the connectors (`journeyLinks` in `scripts/assemble.mjs`): the same words to the same screen on `SHARED_NAVIGATION_SCREENS` (3) or more screens. It keeps a connector only where it is the next step of a group's flow. A pair of screens gets one connector. A list row's record text (line breaks, over 40 characters, or the same link with line breaks on another device) is not a label; the connector takes the target's name. A finding with the same words about the same thing on several screens is one finding on the first, with `screens` (shown in full on the card's tooltip) and a sentence naming the first three (`mergeSharedFindings`).

### Identity

Give a scan a stable `product.id` and every scanned item a stable id. `FlowScan` rejects a scan with duplicate explicit ids, invalid ids (empty, untrimmed, control characters, unpaired surrogates or Object prototype names), or a group id shared with a screen. Annotation kinds have separate id spaces. Missing annotation ids use fact-based defaults and occurrence suffixes (`~2`, `~3`, …), reserving explicit ids from valid annotations first; supply explicit ids for repeated facts that may reorder on a rescan. A saved user group whose id a new screen takes gets a fresh id with its edits, place and view state. `FlowScan.storageKey(scan)` scopes the layout to `product.id` (the trimmed product name for older scans). `tests/scan.test.mjs`, `tests/group-identity.test.mjs` and `tests/rescan.test.mjs` cover the policy.

### Escaping

Scanned text enters markup only through `FlowMarkup` (`<script id="markup-module">`): `esc` is safe in text and in quoted attributes, `html` escapes every value put in a template, and `sel` makes a scanned id safe in an attribute selector. A route with `<`, `&` or `[id]` shows as typed. `tests/markup.test.mjs`, `tests/groups-overlay.test.mjs` and `tests/rescan.test.mjs` cover this.

## Modules

Each subject has one owner, in its own `<script id="…">` block. Most have no DOM and are tested alone under Node.

| Module | Block id | Owns |
| --- | --- | --- |
| `FlowLayout` | `layout-module` | Groups, positions per device, connectors, findings, notes, id counters, undo history |
| `FlowCommit` | `commit-module` | The undo point, the save and the redraw, in a fixed order |
| `FlowAnnotations` | `annotations-module` | What annotation kinds share: drag, arrow-key moves, Delete |
| `FlowGesture` | `gesture-module` | Dragging frames or a group |
| `FlowArrange` | `arrange-module` | Tidy, taking out, dissolving |
| `FlowGeometry` | `geometry-module` | Every extent and drop area |
| `FlowRouting` | `routing-module` | Connector routes round the frames, label places, and a finding's leader line |
| `FlowSelection` | `selection-module` | Selected frames, the primary one, the selected connector |
| `FlowPointer` | `pointer-module` | What a press, move and release mean |
| `FlowDevice` | `device-module` | Each device's sizes, classes, button and key |
| `FlowPanel` | `panel-module` | Inspect or Search, and the room it takes |
| `FrameDom` (`FlowFrameDom.create`) | `framedom-module` | Everything inside a frame's own DOM |
| `FlowMounts` | `mounts-module` | Which screens have a document |
| `FlowScan` | `scan-module` | Reading, cleaning and merging the scan |
| `FlowMarkup` | `markup-module` | Escaping |
| `FlowKeyboard` | `keyboard-module` | See `keyboard.md` |
| `FlowPlayback` | `playback-module` | Play's sequence |

**Layout.** Has no DOM and no demo knowledge. Everything the scan provides is saved the same way, as the user's edits over the scan, under one key and in one undo history. What it holds is read-only from outside; every change goes through a mutator (`place`, `takeOut`, `moveInto`, `groupFrames`, `orderGroups`, `setGroupText`, `resetText`, `add`, `edit`, `remove`, `letGoOfMoves`, and `setOpen` for view state), and the page is strict code, so a stray write throws. `tests/layout-writes.test.mjs` pins the mutators and `tests/layout-owner.test.mjs` fails if the page script writes to the layout, or to a group, note, connector or finding under the names it uses for them, or hangs a DOM handle on a group. A write through some other alias is not caught by that test but throws when it runs. Every write is counted, so the snapshot is worked out once per change. Open or closed groups are view state, in a record of their own. `FlowLayout.flowOrder` is the order a group plays in.

**Commit.** Every edit ends here. Typing in a note, a caption or a group's title goes through `commit.typing`: each key writes through a mutator, the text is saved a moment after the last key, and leaving the field is one undo step. The commit redraws what the mutators say they touched, so a caller names only what the layout cannot know.

**Annotation kinds.** Notes, findings, connectors and captions are each one object declared once, in the page's `KINDS`, handed to `FlowLayout` (the data half: layout field, the scan's items, cleaning on load, which Reset applies), `FlowCommit` (its `refresh`, drawn in list order) and `FlowAnnotations` (how it is found, grabbed, moved and deleted, by id). A kind with DOM keeps its own id-to-DOM lookup. The data halves of the four kinds a scan provides are `FlowScan.dataKinds`. A new kind is one more object in that list; `tests/kinds.test.mjs` proves it with a throwaway fifth kind. Only a kind the scan itself provides also needs a place in the scan's shape. Findings carry across devices the way notes do.

**Gesture.** The drag holds a proposal outside the layout, the canvas draws the layout as it would be (`gesture.view()`), and the drop commits once. Escape and a taken-away pointer throw the proposal away, so there is nothing to restore. Group-making is one data change, `layout.groupFrames`, shared by ⌘G and a drop onto a frame.

**Arrange.** Writes to the layout through its mutators, worked out from where the geometry has things; the page wraps them in a commit and says what happened. `tests/arrange.test.mjs` runs it on the real layout and geometry.

**Geometry.** How big a frame, a row, a deck or a group is, and the area where a dragged frame joins a group, is answered once (`frame`, `rowW`, `deckSpread`, `slotPlace`, `exitX`, `dropZone`, `dropBand`, `slotAt`, `closedTitle`, with every offset named in `EDGES`). `tests/extents-owner.test.mjs` fails if any other module or the page names the device's frame, row and deck sizes (`colW`, `phTop`, `phH`, `cap`, `deckW`, `peekX`, `peekY`, `collH`, `closedW`) or the world's gap and head. `FlowGeometry.readingOrder` gives reading order, and `geo.worldOf` turns a point on a frame into a world point.

**Routing.** `FlowRouting.planner()` answers for every connector at once. A connector keeps its plain route when that is clear of the frames; otherwise a search over the gutters' tracks (both sides of every frame and the middle of each gap, side ports only, so a line stays off captions and titles) finds the cheapest right-angle path, and lines sharing a channel are spread into lanes. `geo.routeScene(now)` says what to keep off: frames and closed decks are hard, group titles and finding cards are soft. While frames move or a gesture is live, a route still clear is kept and searches share a budget, so a slide stays smooth; a line past the budget is drawn plainly and marked provisional until the next settled draw. If no way round exists, as when a frame is walled in by others, the route takes the fewest frames, is marked `crossed` and is drawn dotted. `placeLabels` puts each label on the longest clear run of its line, then just above or below, then cut to the run, then tucked to a dot that shows the label on hover and focus.

**Findings and Frame actions.** A finding's stack makes its group taller (`stackRoom`), so cards end before the next title; a group the user placed themselves does not push what is below it. Frame actions is a `.menu` anchored to the frame's "…", redrawn in place for its pickers.

**Selection.** Never frames and a connector together. `FlowSelection.follows` makes the panel follow the primary frame however the selection changed; the page only paints. `tests/selection.test.mjs` runs it with the real panel.

**Pointer.** One mode (idle, press, pan, marquee, connect) in place of flags. The page says what was pressed (a hit: edge dot, grip, deck, frame, annotation, chrome or canvas) and does what the arbiter asks through a host. `tests/pointer.test.mjs` drives it with fake events.

**Device.** A device's screen and caption sizes, style variables, frame class, switcher button and key all derive from one entry. Adding a device is one entry, its renderings of each screen, and an icon symbol. A note with no place of its own on a device is carried over from one that has it.

**Panel.** Whether it is open, Inspect or Search, which screen Inspect is about, which component is being swept, and the room it takes from the window (the camera asks `panel.insets()`; a resize re-centres the selected screen while the panel is open). How much of the window it takes is `FlowPanel.SIZE`: `FlowPanel.cssVars()` hands the stylesheet its width and height at boot. A media query cannot read a variable, so `tests/panel.test.mjs` fails if the stylesheet's breakpoint is not `SIZE.narrowAt`. The page only listens and paints (`paintPanel`).

**Timing.** Every duration a timer spells out is in one frozen `TIMING` table at the top of the page script (`fly`, `fade` and `tapMark` also feed the stylesheet). A wait for frames to come to rest is `whenSettled`, a fade waits on its `transitionend`, and `tests/timing-owner.test.mjs` fails on a timer that spells its own number or a read of the world's computed transform.

**FrameDom.** Which render a screen shows, mounting it, counting and lighting up a component, the ripple and the product's reaction to a tap, where a tap leads, and a search tile's copy. It hands back numbers, ids and where a tap leads, never a node, and knows a screen only through a host adapter, marked "live screen host" in the page. `FrameDom.ready(id?)` waits for the latest mount of one or every mounted screen. `tests/framedom.test.mjs` runs it with a fake host and fails if the page reaches into a screen any other way.

## Screens

**Live host.** The only code that mounts product DOM: one iframe per screen at the device's real viewport, scaled into its frame on the canvas. Each document owns its product styles, fonts and SVG symbols; the canvas owns the wrapper, ripple and spotlight. Events cross through the host with normalised coordinates and opaque product targets, so product class names cannot trigger canvas handlers. Native controls remain interactive, background drags move frames, wheel inside a screen scrolls that screen, wheel on empty canvas pans, Ctrl/⌘+wheel zooms and Space+drag pans. The scan's static renders and `FlowScanBehaviour` are the content source; app bundles are not booted. A link in a render never navigates the screen. Mouse, trackpad and keyboard events cross the host; real touch has not been checked.

**Trust.** The iframes use `sandbox="allow-same-origin"` without `allow-scripts`. Scripts in a render never run, but the canvas page reaches into each screen's document (to run `FlowScanBehaviour`, count components and snapshot a screen). The choice is deliberate, and it means the scan is trusted as much as the canvas file itself: markup, styles and behaviour from an untrusted codebase are not made safe by the iframe.

**Mounting.** `FlowMounts` (browser-free, `tests/mounts.test.mjs`) chooses screens within 300 CSS pixels of the visible canvas after zoom, plus selected screens and those Inspect or Search are reading. The page applies those ids through `FrameDom.retain`; wrappers, labels, connectors and findings always exist, with a cheap outline while a document is absent. `colOf` reads the frame registry. Far documents are serialized and removed; their taps, field values and scroll positions survive returning on the same device and state. Which state is shown survives too. Device changes and explicit state changes start the render clean. These parked documents are memory-only. Camera flights use their actual transition progress to choose nearby screens. An overview where every frame is near can still mount every screen. A mount unfinished after `TIMING.mountWait` no longer holds Inspect, Search or a device switch.

**Search.** Debounces typing by `TIMING.searchInput` (150 ms), keeps unchanged tiles and cached snapshots, and reads at most two missing snapshots at a time for tiles near the panel's visible area; changed markup or field values invalidate a snapshot. Previews are inert; those outside the margin or in a closed panel are removed while their snapshots stay cached. Superseded Inspect and Search reads release their mounting requests immediately; a finding holds its screen for the whole spotlight interaction.

## Tests

`node --test skills/create-flow-canvas/tests/*.test.mjs` from the repository root, on Node 22 or newer.

For the live host checks, serve the repository root with `python3 -m http.server`, open `skills/create-flow-canvas/tests/browser.html` in a visible tab, click the page first to give it focus, then click **Run browser checks**. They cover isolation, real viewports, assets, taps, dragging, controls, scroll and zoom routing, keyboard entry, Inspect, Search, state changes and device switching.
