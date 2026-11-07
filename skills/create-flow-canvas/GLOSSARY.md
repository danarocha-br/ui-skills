# Flow canvas

An interactive canvas that shows a product's screens as frames, grouped into flows, with connectors and annotations on top. The words below are the ones the canvas, its skill and its code agree on.

## Language

**Layout**:
The saved arrangement of a canvas: which frames sit in which groups and what each group is called, where things are placed on each device, the user's edits to the scan's connectors, notes and findings, and the connectors and notes the user made. Frame captions are not part of the layout.
_Avoid_: View state, canvas state

**Group**:
An ordered set of frames. Open, it fans out into a flow; closed, it stacks into a deck. Membership is shared by every device. A group carries its own **title** and **description**, so they are saved, undone and reset with it and gone when it is dissolved.
_Avoid_: Lane (the name the code and the saved data still use), cluster

**Title**:
The line a group is headed with, typed in place. Its **name** is the part before the first colon ("Onboarding: how fast to a first plant?" is named "Onboarding"), or "Untitled group" when that is empty. The name is what menus and toasts show. The **description** is the optional line under the title; hiding it keeps its text.
In code the title is `title` and the description is `sub`, shown or hidden by `subOn`; the name is `FlowLayout.groupName`.
_Avoid_: Heading, label, subtitle

**Annotation**:
Something laid over the frames rather than part of a screen: a note, a scanner finding, a connector, or a caption. Notes and scanner findings can be moved; connectors and captions are edited in place.
_Avoid_: Overlay, marker, comment

**Scan**:
What the scanner found in a product's code: its screens, their states, the groups and links between them, findings, notes and captions. The canvas shows a scan; it does not own it. The Loam canvas is one scan, the **sample**.
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

**Link**:
The scan's finding that one screen leads to another. On the canvas a link is drawn as a **connector**; the connector is the only thing that says "A leads to B", and buttons inside a frame follow connectors.
_Avoid_: Edge, arrow, transition

**Finding**:
Something the scanner wants a reviewer to notice about a frame, shown as a card pointing at it. Every finding has a **kind** (unreachable states, reused component) that decides its wording and what it does when clicked.
_Avoid_: Scan card, insight, warning

**Edit**:
What the user changed on something the scan produced: moved it, rewrote it, relabelled it or dismissed it. The layout keeps edits, not copies, so a new scan still reaches someone who has edits; their edits win where they touched it.
_Avoid_: Override, patch

**Caption**:
A title and a body typed in place under a frame. It is an annotation, but not part of the layout. (A group's own title and description are part of the group, not captions.)
_Avoid_: Heading
