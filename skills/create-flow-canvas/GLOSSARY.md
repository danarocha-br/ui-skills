# Flow canvas

An interactive canvas that shows a product's screens as frames, grouped into flows, with connectors and annotations on top. The words below are the ones the canvas, its skill and its code agree on.

## Language

**Layout**:
The saved arrangement of a canvas: which frames sit in which groups and what each group is called, where things are placed on each device, the user's edits to the scan's groups, connectors, notes, findings and captions, and the groups, connectors and notes the user made. Everything the scan provides is saved the same way, as edits over the scan.
_Avoid_: View state, canvas state

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
Something laid over the frames rather than part of a screen: a note, a scanner finding, a connector, or a caption. Notes and scanner findings can be moved; connectors and captions are edited in place.
_Avoid_: Overlay, marker, comment

**Scan**:
What the scanner found in a product's code: its screens, their states, the groups and links between them, findings, notes and captions. The canvas shows a scan; it does not own it. The Loam canvas is one scan, the **sample**. Everything in it is text, shown as text and never as markup (a route may contain "<", "&" or "[id]"), except a screen's own render, which is markup by design.
_Avoid_: Demo data, seed, fixture

**Screen**:
One route or view of the product, as the scan found it. A **frame** is how a screen is drawn on the canvas.
_Avoid_: Page, artboard

**Frame**:
A screen as drawn on the canvas: the device screen with its caption under it. It is in a group, or **loose** (in no group). In a closed group a frame is drawn small, in the deck.
_Avoid_: Card, tile, artboard

**Place**:
Where a frame is meant to be. A frame in a group takes its slot in the row or the deck; a loose frame is where the user put it on this device, or, when they have not, in the next free spot below the groups. A place is worked out from the layout each time and is not saved, apart from the positions the user chose.
_Avoid_: Slot (that is one place in a row), coordinates

**Device**:
A size the canvas can show every screen at (mobile, tablet, desktop). Each is described once; the sizes of the screen and its caption, the style variables, the class on a frame, the switcher button and the key that reaches it all come from that description. Groups are shared by every device; places are per device. In code, `FlowDevice.describe(id)`.
_Avoid_: Breakpoint, platform

**Carry**:
What a note does on a device it has no place on: it keeps the same relative spot on the frame's screen as on the device it was placed on. A carried place is worked out each time and is not saved, so it never overrides one the user chose. With no place on any device, a note takes the **resting spot** near the frame's right edge.
_Avoid_: Fallback, default position

**Slide**:
A frame travelling from where it was to its new place after the layout changed: each frame sets off in turn, grows or shrinks as it goes, and comes to rest. Everything that depends on where a frame is (connectors, notes, dropping and aiming at a frame) follows the frame as it slides, and the canvas is **settled** once the last frame has stopped. Someone who asks for reduced motion gets no slide: frames are simply at their places.
_Avoid_: Transition, animation (those name the browser mechanism, not the thing the user sees)

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
A screen's own markup for one device and one state: what the product's screen looks like when it is shown. It is markup by design, the one thing in a scan that is. A render is shown whole, so what someone tapped inside a screen (a plant picked, a switch turned, a time chosen) belongs to the render on show and is gone when another is shown, whether that is another state or another device. Which state a frame shows is kept across devices; its taps are not.
_Avoid_: Template, markup (alone)

**Mount**:
Putting a render into a frame. One module owns the inside of every screen (which render is shown, its components, a tap's ripple and reaction, a copy for a search tile); everything else names a screen by its id and never holds a piece of one. Where a mounted screen lives is the business of the one host that mounts it. In code, `FlowFrameDom` (the page's `FrameDom`).
_Avoid_: Embed, inject

**Link**:
The scan's finding that one screen leads to another. On the canvas a link is drawn as a **connector**; the connector is the only thing that says "A leads to B", and buttons inside a frame follow connectors.
_Avoid_: Edge, arrow, transition

**Finding**:
Something the scanner wants a reviewer to notice about a frame, shown as a card pointing at it. Every finding has a **kind** (unreachable states, reused component) that decides its wording and what it does when clicked.
_Avoid_: Scan card, insight, warning

**Edit**:
What the user changed on something the scan produced: moved it, rewrote it, relabelled it, dismissed it, or moved a frame between groups. The layout keeps edits over the scan, not copies of it (what the user made themselves is kept whole), so a new scan still reaches someone who has edits; their edits win where they touched it. An edit to something the scan no longer has is dropped.
_Avoid_: Override, patch

**Caption**:
A title and a body typed in place under a frame. It is an annotation and part of the layout, so it is saved, undone and reset with it ("Reset annotations" puts captions and group text back; "Reset layout" leaves captions alone). (A group's own title and description are part of the group, not captions.)
_Avoid_: Heading

**Panel**:
The right-hand side of the canvas, a sheet along the bottom on a narrow window. It shows **Inspect** (one screen: route, source, components, states) or **Search**, one at a time. It is open or closed, in one mode, and Inspect has a screen it is about (or none). The panel's **inset** is what it takes from the window; the camera leaves it free, so when the camera flies to a screen, a group or everything it fits them in what is left. A resize, while the panel is open and a screen is selected, centres that screen again in the room that remains; it does not re-fit the other frames. In code, `FlowPanel`; the page only paints what it says.
_Avoid_: Sidebar, drawer, inspector (that is Inspect's label to a screen reader)

**Sweep**:
Finding every screen that uses a component: those screens keep their colour, the rest recede, and a list of them is shown in Inspect. It belongs to the panel: it exists only while Inspect is open, survives a change of screen or of device, and ends with Escape, a second click on the component, opening Search or closing the panel.
_Avoid_: Find usages, highlight, filter

**Instances and uses**:
Two counts that answer two questions. The **instances** of a component are how many of it are on a screen in the state shown now (counted from the frame itself, so "—" when a state does not show it). Its **uses** are the screens the scan says use it ("used on 3 of 9 screens"). A screen can use a component it does not show in the current state, so the two need not agree.
_Avoid_: Count (alone)
