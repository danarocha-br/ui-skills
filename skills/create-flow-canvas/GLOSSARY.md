# Flow canvas

An interactive canvas that shows a product's screens as frames, grouped into flows, with connectors and annotations on top. The words below are the ones the canvas, its skill and its code agree on.

## Language

**Layout**:
The saved arrangement of a canvas: which frames sit in which groups and what each group is called, where things are placed on each device, the user's edits to the scan's groups, connectors, notes, findings and captions, and the groups, connectors and notes the user made. Everything the scan provides is saved the same way, as edits over the scan.
The layout owns its writes: what it holds is read-only from outside, and every change goes through one of its **mutators**. How the groups are shown is kept in a record of its own, outside its edits and its snapshot (see **View state**).
_Avoid_: View state, canvas state

**Mutator**:
One of the layout's own ways to change what it holds (`place`, `forgetPlaces`, `takeOut`, `moveInto`, `groupFrames`, `orderGroups`, `setGroupText`, `resetText`, `add`, `edit`, `remove`, `letGoOfMoves`, and `setOpen` for view state), each keeping the layout's rules (a group left empty goes, an id is never used twice, a frame is in one group). The page reads the layout and asks it to change; it never writes to it, and a write to a read throws. A mutator says what it touched, so the commit knows what to redraw.
_Avoid_: Setter, action, reducer

**View state**:
How the groups are shown: open or closed. It is kept apart from the layout's edits, in its own record that is saved with the layout and so comes back after a reload, but is never in a snapshot or an undo step, so undo does not open or close a group. Changed with `setOpen`; the sweep opening a group is the same change. Reset layout puts every group back as the scan shows it.
_Avoid_: UI state, collapse state

**Group**:
An ordered set of frames. Open, it fans out into a flow; closed, it stacks into a deck. Membership is shared by every device. A group carries its own **title** and **description**, so they are saved, undone and reset with it and gone when it is dissolved.
_Avoid_: Lane, cluster. "Lane" is the old name; it survives only where renaming would break something saved or styled: the `lanes` key in the saved layout and the stylesheet's `.lane` class (with the `data-lane` attribute on a frame). Everywhere else, in code and in words, it is a group.

**Membership**:
Which group a frame is in (or none, so it is loose) and its order there. What the user changed is saved one frame at a time, as "this frame is in group X" or "this frame is loose", and an order only for a group the user rearranged. A frame the user never moved follows the scan, so a rescan that regroups it moves it; one the user moved stays where they put it. A group the user dissolved stays dissolved, and one the user made is kept.
In code and in the saved layout the per-frame edit is `place` (with `order` and `seq`); do not confuse it with **Place**, where a frame is drawn, or `pos`.
_Avoid_: Placement

**Title**:
The line a group is headed with, typed in place. Its **name** is the part before the first colon ("Onboarding: how fast to a first plant?" is named "Onboarding"), or "Untitled group" when that is empty. The name is what menus and toasts show. The **description** is the optional line under the title; hiding it keeps its text.
In code the title is `title` and the description is `sub`, shown or hidden by `subOn`; the name is `FlowLayout.groupName`.
_Avoid_: Heading, label, subtitle

**Annotation**:
Something laid over the frames rather than part of a screen: a note, a scanner finding, a connector, or a caption. Notes and scanner findings can be moved; connectors and captions are edited in place. Each is an **annotation kind**.
_Avoid_: Overlay, marker, comment

**Annotation kind**:
One sort of annotation (notes, findings, connectors, captions), declared as one object that the layout, the commit and the annotation module all read. Its **data half** says what is saved (its field in the layout, the items the scan gives, how loading cleans them, which Reset brings it back); its **view half** says how it is drawn (`refresh`), found, grabbed, moved and deleted. Items are ids, and a kind that has DOM keeps its own id-to-DOM lookup (notes and findings a registry, connectors and captions find theirs in the page), so nothing outside it holds a node of it. The page declares one list of kinds; the order of the list is the order they are redrawn in. Adding a kind is adding one object to that list; `tests/kinds.test.mjs` does it with a throwaway fifth kind. A kind the scan itself provides also needs its place in the scan's shape (`FlowScan.read` and `FlowScan.dataKinds`).
_Avoid_: Layer, type, adapter. (A finding's own `kind` field, "unreachable states" or "reused component", is its sort of finding, not an annotation kind.)

**Scan**:
What the scanner found in a product's code: its screens, their states, the groups and links between them, findings, notes and captions. The canvas shows a scan; it does not own it. The Loam canvas is one scan, the **sample**. Everything in it is text, shown as text and never as markup (a route may contain "<", "&" or "[id]"), except a screen's own render and its SVG symbols (`icons`), which are markup by design. The replaceable styles supply the product's colours, fonts and reset.
_Avoid_: Demo data, seed, fixture

**Scan identity**:
A stable `product.id` scopes saved layouts; an item's stable id keeps its edits attached on a rescan. Ids are unique within each annotation kind; screens and groups also have distinct ids because they share saved positions. A duplicate explicit id or an invalid id rejects the scan with a problem, before a layout is loaded. Missing annotation ids use their facts, then occurrence suffixes (`~2`, `~3`, …); these depend on order, so repeated facts that may reorder need explicit stable ids. A saved user group whose id a rescan uses for a screen gets a fresh id, carrying its membership, text, place and view state. Group ids stay data in the page's element registry and `data-group-id`, never document ids. In code, `FlowScan.read` and `FlowScan.storageKey`.
_Avoid_: DOM id (for a scanned id), generated id (for a stable scanner-supplied id)

**Screen**:
One route or view of the product, as the scan found it. A **frame** is how a screen is drawn on the canvas.
_Avoid_: Page, artboard

**Frame**:
A screen as drawn on the canvas: the device screen with its caption under it. It is in a group, or **loose** (in no group). In a closed group a frame is drawn small, in the deck. Its wrapper is a keyboard Tab stop with a group role and a name that describes the screen, route, shown state, membership and selection, even when no screen document is mounted. Keyboard focus selects it and brings it into view; Left/Right move between wrappers, Enter enters the screen and Shift+F10 opens Frame actions.
_Avoid_: Card, tile, artboard

**Approximate**:
A screen flag (`approximate: true` in the scan) meaning part of the screen was stubbed when it was rendered. The frame shows an "Approximate" badge beside its route, and Inspect says so in a line above Source. It is the scanner's statement, never inferred by the engine.
_Avoid_: Mock, fake, partial

**Unrendered**:
A screen the scanner could not render (`unrendered: "reason"` in the scan). Where it has no render for a device, the scan module fills one in: a placeholder that says the screen could not be rendered and gives the reason, as text. A render the scan does supply wins, and Inspect shows the reason either way.
A state the product has on only some devices (a state's `html` lacks a device) gets the same kind of placeholder on the others, saying "This state doesn't exist on <device>"; the state stays selectable everywhere.
_Avoid_: Empty frame, broken screen

**Screen root**:
The `.flow-root` element a generated scan writes each render into, carrying the captured classes, background, colour and font. The product's `:root` rules are re-declared on it, and the strip a frame has beyond its scaled screen takes the root's background when it is painted, and the body's otherwise. (Not the frame's **wrapper**, the Tab stop around a frame.)

**Place**:
Where a frame is meant to be. A frame in a group takes its slot in the row or the deck; a loose frame is where the user put it on this device, or, when they have not, in the next free spot below the groups. A place is worked out from the layout each time and is not saved, apart from the positions the user chose.
_Avoid_: Slot (that is one place in a row), coordinates

**Extent**:
How big a thing on the canvas is, in world pixels on the device on show: a frame (its screen and its caption), a row of frames, a deck, a group's box. Each is worked out once, in `FlowGeometry`, from the device's numbers; nothing else computes one, and `tests/extents-owner.test.mjs` fails if another module or the page names those numbers. (A note's resting spot, in `FlowDevice`, is where an annotation starts, not an extent.) Two kinds of box are drawn round a group and are not its extent: the **drop zone**, the dashed box that lights up when a frame is dragged over it, and the **drop band**, the larger area where a dragged frame counts as over the group (the band is only ever asked, never drawn). The offsets between them are named in one table and are not all consistent on purpose; each is a thing the user sees.
_Avoid_: Size, dimensions, bounds (the geometry's `bounds()` is the whole canvas, for the camera)

**Device**:
A size the canvas can show every screen at (mobile, tablet, desktop). Each is described once: its real **viewport** (the iframe's width and height), the smaller canvas card and caption, style variables, frame class, switcher button and key all come from that description. The iframe renders at the real viewport and scales into the card; media queries, viewport units and fixed-position elements use the screen's viewport. Groups are shared by every device; places are per device. In code, `FlowDevice.describe(id)`.
_Avoid_: Breakpoint, platform

**Carry**:
What a note or a finding does on a device it has no place on: it keeps the same relative spot on the frame's screen as on the device it was placed on. A carried place is worked out each time and is not saved, so it never overrides one the user chose. A note with no place on any device takes the **resting spot** near the frame's right edge; a finding with none stays in its default stack under its frame, and Tidy lets go of a finding's moved places on every device.
_Avoid_: Fallback, default position

**Slide**:
A frame travelling from where it was to its new place after the layout changed: each frame sets off in turn, grows or shrinks as it goes, and comes to rest. Everything that depends on where a frame is (connectors, notes, dropping and aiming at a frame) follows the frame as it slides, and the canvas is **settled** once the last frame has stopped. Anything that has to wait for a slide (Play, after it opens a group) waits for the canvas to be settled, not for a guessed time. Someone who asks for reduced motion gets no slide: frames are simply at their places, and the canvas is settled at once.
_Avoid_: Transition, animation (those name the browser mechanism, not the thing the user sees)

**Pacing**:
A length of time that is the canvas's own choice: how long Play stays on a screen, how long a tap's mark or a message shows, how long a click waits for a second one. Each is named once. It is not a wait for something to finish: that waits for the thing itself (the canvas to be settled, a fade to end, the next frame), so a change to how long something takes cannot leave a guess behind. In code, `TIMING`.
_Avoid_: Delay, timeout, sleep

**Selection**:
The frames the user has selected (a click, shift-click, a marquee, select all), or one connector, never both. One of the selected frames is the **primary** (the last one chosen): the frame the toolbar, the arrow keys, the counter ("03/09") and Inspect are about. Inspect follows the primary however the selection changes. Deselecting frames leaves a selected connector alone; selecting frames lets go of it. In code, `FlowSelection`; the page only paints it.
_Avoid_: Focus alone (use **keyboard focus** for the input position; the **Focus** action moves the camera), active

**Keyboard focus**:
Where keyboard input goes: a frame wrapper, a screen's own control, a menu or the panel. It is separate from the camera's Focus action. The wrapper exists independently of a screen document; entering a screen waits for its document, and Escape follows the canvas's existing cancellation/closing chain before returning keyboard focus to the wrapper when the panel is closed. Native Tab is left to the browser; moving into and out of mounted screens has not been exercised in a real browser (see `KEYBOARD.md`). Keyboard focus selects a frame but never writes the layout: a frame in a closed group is not a Tab stop, so a group opens only when it is asked to.
_Avoid_: Selection (the selected frames are kept by `FlowSelection`)

**Press**:
What the pointer does from button down to button up on the canvas. What it landed on is a **hit** (an edge dot, a group's grip, a deck, a frame, an annotation, something that is not the canvas, or the empty canvas), and what follows is decided in one place by one **mode**: a frame or group held but not yet dragged (**pending**; once it moves far enough it becomes a **gesture**, which `FlowGesture` holds), a marquee, a pan, or a connector being drawn. A note or finding being dragged stays with `FlowAnnotations`, which the pointer asks about before anything else. The click that follows a press that travelled is not a click. In code, `FlowPointer`.
_Avoid_: Drag state, tool (the hand tool and Space make a press pan across the canvas, including over screens)

**Arrangement edit**:
An edit that moves frames about as a whole rather than one at a time: **Tidy** (groups and loose frames back in order on this device, nothing about the flows changed), taking frames out of their groups, and dissolving a group (its frames stay where it was). Each is a write to the layout through its mutators. In code, `FlowArrange`. Keyboard movement within a group, into a group or on the loose canvas uses `FlowKeyboard` over the same layout mutators; taking out shares the arranger.
_Avoid_: Layout command, reset (that puts everything back as the scan has it)

**Gesture**:
A drag of frames, or of a whole group by its grip. While the pointer is down it only proposes; letting go commits, and cancelling (Escape, or the pointer being taken away) ends it with nothing changed. In code, `FlowGesture`.
_Avoid_: Drag state

**Proposal**:
Where a gesture's drop would land: into a group at a slot, onto a loose frame (to make a group), onto the canvas, or, for a group, to a new place. It is never written into the layout. The canvas is drawn from the layout as it would be if the proposal were dropped, so there is nothing to put back when it is thrown away.
_Avoid_: Preview (that is how it is drawn), pending change

**Drop**:
Letting go of a gesture: its proposal is committed once, as one undo step. Dropping frames onto a loose frame makes a group of them, pinned where that frame was; dropping them into a group puts them in the slot shown.
_Avoid_: Commit (that is the module that records every edit)

**State**:
One way a screen can look (empty, denied, error). A state is **reachable** when something in the product's UI leads to it, and **only reachable in code** when nothing does.
_Avoid_: Variant, mode

**Render**:
A screen's own markup for one device and one state: what the product's screen looks like when it is shown. It is markup by design, as are the product's SVG symbols. A render is shown whole, so what someone tapped inside a screen (a plant picked, a switch turned, a time chosen) belongs to the render on show and is gone when another is shown, whether that is another state or another device. Which state a frame shows is kept across devices; its taps are not. Removing an offscreen document to save resources preserves the current render, field values and scroll positions in memory, so returning to it on the same device and state keeps those interactions. A device or explicit state change discards them; a reload discards all such temporary state.
_Avoid_: Template, markup (alone)

**Viewport**:
The real width and height a screen is drawn at on a device (390 × 844 on mobile). Media queries, viewport units and fixed-position elements inside the screen read it. A card is smaller than its viewport, and the screen is scaled into it by one number for both axes, so a card of a different shape shows the screen's own background in the spare strip rather than a stretched screen. In code, `FlowDevice.describe(id).viewport`.
_Avoid_: Size (that is a card's extent), resolution

**Screen document**:
The iframe one screen is mounted in: its own document with the product's styles and icon symbols, at the device's viewport. `sandbox="allow-same-origin"` with no scripts, so nothing in a render runs, while the canvas page can read the document (behaviour, counts, snapshots); the scan is trusted like the canvas itself. A Search tile holds an inert snapshot of one. In code, the live screen host's `makeDocument`.
_Avoid_: Embed, frame (a **Frame** is the card on the canvas)

**Mount**:
Putting a render into a frame. One module owns the inside of every screen (which render is shown, its components, a tap's ripple and reaction, a copy for a search tile); everything else names a screen by its id and never holds a piece of one. The live host mounts each screen in its own iframe with local product styles and SVG symbols, and routes events across the boundary. A mount is ready when the latest document has loaded and its fonts are ready; Inspect and Search wait for it after a state or device change. Search copies are inert snapshots of the current render and field values. A frame keeps its outline and label without a document. `FlowMounts` chooses frames within 300 CSS pixels of the visible canvas after zoom, selected frames and frames requested by Inspect or Search. Far screen documents are serialized and removed, preserving their current render in memory; the layout save format does not include them. In code, `FlowFrameDom` (the page's `FrameDom`), with `retain(ids)` to apply that choice and `ready(id?)` to await one mounted screen or all mounted screens. Search waits 150 ms after typing, reuses unchanged snapshots and tiles, and reads missing snapshots only near the panel's visible area, at most two at a time. Previews outside that margin or in a closed panel have no screen document. Superseded panel reads release their requests immediately; a finding keeps its screen mounted until its spotlight interaction ends.
_Avoid_: Embed, inject

**Play**:
Visiting the frames of a group in flow order. Ordinarily each screen advances after the dwell in `TIMING`. Under reduced motion the visit is manual: Next screen advances and Stop playback ends it. Enabling reduced motion makes an active visit manual; disabling it does not resume automatic advance until Play starts again. In code, `FlowPlayback`.
_Avoid_: Slideshow, autoplay (for a manual visit)

**Link**:
The scan's finding that one screen leads to another. On the canvas a link is drawn as a **connector**; the connector is the only thing that says "A leads to B", and buttons inside a frame follow connectors.
_Avoid_: Edge, arrow, transition

**Finding**:
Something the scanner wants a reviewer to notice about a frame, shown as a card pointing at it. Every finding has a **kind** (unreachable states, reused component) that decides its wording and what it does when clicked.
_Avoid_: Scan card, insight, warning

**Edit**:
What the user changed on something the scan produced: moved it, rewrote it, relabelled it, dismissed it, or moved a frame between groups. The layout keeps edits over the scan, not copies of it (what the user made themselves is kept whole), so a new scan still reaches someone who has edits; their edits win where they touched it. An edit to something the scan no longer has is dropped.
_Avoid_: Override, patch

**Visit**:
One stay in a field the user types in (a note, a caption, a group's title or description): from the first key to leaving the field. Each key goes through a mutator and is saved a moment after the last one, and leaving ends the visit as one undo step, however many keys it took. A commit or an undo ends a visit first, so the two are never one step. In code, `commit.typing`.
_Avoid_: Session, burst (a burst is the arrow keys moving an item)

**Caption**:
A title and a body typed in place under a frame. It is an annotation and part of the layout, so it is saved, undone and reset with it ("Reset annotations" puts captions and group text back; "Reset layout" leaves captions alone). (A group's own title and description are part of the group, not captions.)
_Avoid_: Heading

**Panel**:
The right-hand side of the canvas, a sheet along the bottom on a narrow window. It shows **Inspect** (one screen: route, source, components, states) or **Search**, one at a time. It is open or closed, in one mode, and Inspect has a screen it is about (or none): the selection's primary frame, which it follows. The panel's **inset** is what it takes from the window; the camera leaves it free, so when the camera flies to a screen, a group or everything it fits them in what is left. The room the camera leaves free is the room the panel is drawn in, on a wide window and on a narrow one. A resize, while the panel is open and a screen is selected, centres that screen again in the room that remains; it does not re-fit the other frames. In code, `FlowPanel`; the page only paints what it says.
_Avoid_: Sidebar, drawer, inspector (that is Inspect's label to a screen reader)

**Sweep**:
Finding every screen that uses a component: those screens keep their colour, the rest recede, and a list of them is shown in Inspect. It belongs to the panel: it exists only while Inspect is open, survives a change of screen or of device, and ends with Escape, a second click on the component, opening Search or closing the panel.
_Avoid_: Find usages, highlight, filter

**Instances and uses**:
Two counts that answer two questions. The **instances** of a component are how many of it are on a screen in the state shown now (counted from the frame itself, so "—" when a state does not show it). Its **uses** are the screens the scan says use it ("used on 3 of 9 screens"). A screen can use a component it does not show in the current state, so the two need not agree.
_Avoid_: Count (alone)

**Capture**:
One screen, in one state, on one device, taken from the running throwaway copy by `scripts/capture.mjs`: its DOM, the CSS rules in use, and a **reference**. It is not the layout's snapshot.
_Avoid_: Snapshot (that is the layout's, and Search's inert copy)

**Scenarios**:
The project-owned `.flow-canvas/scenarios.json`: which screens to capture and, for each, which states, with the cookies and steps that reach them.

**Reference**:
The screenshot of the running copy taken for a capture. **Fidelity** is how closely the canvas's render matches it, pixel by pixel. A match says the render is true to the copy, not that the copy's mock was right; a capture's **signals** are what look for that.
_Avoid_: Baseline, golden
