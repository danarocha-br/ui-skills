# Flow canvas

An interactive canvas that shows a product's screens as frames, grouped into flows, with connectors and annotations on top. The words below are the ones the canvas, its skill and its code agree on.

## Language

**Layout**:
The saved arrangement of a canvas: which frames sit in which groups and what each group is called, where things are placed on each device, and the connectors, notes and scanner-finding changes the user made. Frame captions are not part of the layout.
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

**Caption**:
A title and a body typed in place under a frame. It is an annotation, but not part of the layout. (A group's own title and description are part of the group, not captions.)
_Avoid_: Heading
