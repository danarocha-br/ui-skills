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
