# Flow canvas

An interactive canvas that shows a product's screens as frames, grouped into flows, with connectors and annotations on top. The words below are the ones the canvas, its skill and its code agree on.

## Language

**Layout**:
The saved arrangement of a canvas: which frames sit in which groups, where things are placed on each device, and the connectors, notes and scanner-finding changes the user made. Captions are not part of the layout.
_Avoid_: View state, canvas state

**Group**:
An ordered set of frames. Open, it fans out into a flow; closed, it stacks into a deck. Membership is shared by every device.
_Avoid_: Lane (the name the code and the saved data still use), cluster

**Annotation**:
Something laid over the frames rather than part of a screen: a note, a scanner finding, a connector, or a caption. Notes and scanner findings can be moved; connectors and captions are edited in place.
_Avoid_: Overlay, marker, comment

**Caption**:
A title or description typed in place on a frame or a group. It is an annotation, but not part of the layout.
_Avoid_: Heading
