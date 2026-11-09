# Keyboard and reduced motion

Read this when changing keyboard handling, menus or Play, or when asked whether the canvas is accessible by keyboard.

Every frame wrapper is a Tab stop with `role="group"`. Its accessible name includes the screen name, route, shown state, group position (or loose), group disclosure state and selection, and exists without a mounted document. `FlowKeyboard` (`<script id="keyboard-module">`) builds the name and owns command recognition, one-slot reordering, loose-frame nudges and moving into a group; it writes only through layout mutators. Taking out uses `FlowArrange.takeOut`. Each edit uses the normal commit and status toast, with the same save format and undo as pointer edits.

| Key on a focused frame | Action |
| --- | --- |
| Tab / Shift+Tab | Native traversal through frames, their controls and mounted screens (a closed group's frames are not stops: its chevron is) |
| Left / Right | Focus and select the previous / next frame in scan order |
| Enter | Mount if necessary, wait, then enter the screen's first available control (or its body) |
| Escape inside a screen | Follow the canvas Escape chain, then return focus to the wrapper when the panel is closed |
| Alt+Shift+Left / Right | Move one slot earlier / later in its group; never wrap |
| Shift+arrow | Move a loose frame by 10 world pixels on the shown device |
| Control/Command+Shift+G | Take selected frames out of their group |
| Shift+F10 or the Menu key | Frame actions: reorder, take out, move, choose a group or choose a connector destination |

A frame also has a native Frame actions button. Frame actions is an ARIA menu anchored to it, with arrow, Home and End navigation; Escape closes it and returns focus to the frame without moving the camera. Its move buttons keep it open and each result is announced in the page's status toast. "Move to group" and "Connect to" open a picker in the same menu: Right or Enter goes in, Left or Escape comes back to the row it came from, and typing jumps to a name.

Shift does not turn the global shortcuts off (`+` and `/` need it on many layouts); Control, Command and Alt do, except AltGr. The `i`, `n`, `l`, `a`, `m`, `t`, `d`, `c`, device and view keys, Control/Command+G, Control/Command+K and Space-pan remain in place. Native text entry and activation stay inside a screen; Tab traversal is left to the browser. Keyboard focus in a screen keeps its document mounted. Explicit navigation and edits stop Play.

Add, Canvas, Views and group options are ARIA menus with arrow, Home and End navigation, Escape and focus return. Group chevrons and the Inspect and Search toggles expose `aria-expanded`; panel toggles control the complementary panel, so they do not claim to open an ARIA popup.

## Reduced motion

`FlowPlayback` (`<script id="playback-module">`, browser-free) owns Play's sequence. With reduced motion, Play selects the first screen and offers Next screen and Stop playback, and never starts an automatic timer. Turning reduced motion on during Play cancels the pending advance and makes the visit manual; turning it off does not restart that visit's timer. The connector token is skipped under reduced motion (an in-flight token stops on the next animation frame). Menu pop runs only with no motion preference. Token and menu durations are named in `TIMING`.

## What automated checks cannot cover

The browser suite (`tests/browser.html`, see `engine.md`) uses the page's real handlers and focus, but a synthetic Tab only proves the handler does not cancel the event, and its Play fixture controls the JavaScript preference rather than CSS media queries. So after changing this area, walk these by hand:

1. Tab and Shift+Tab through every frame and its controls, including a frame whose document starts absent. Use Left/Right to visit every wrapper; check focus ring, camera visibility, names and states.
2. Reach and activate a group chevron twice. Open Add, Canvas, Views and group options; use arrows, Home/End, Tab and Escape. Check expanded states and focus return.
3. Reorder a middle frame both ways and at both boundaries; take it out with Control/Command+Shift+G; nudge it; move it back with the group picker. Undo each edit once.
4. Choose a connector destination in Frame actions (its picker), create it and undo. Recheck pointer drag, reorder, take-out and edge-dot drawing.
5. Enter a mounted screen. Tab past its final control and backward before its first. Check for traps, type text, activate native controls, open Search with Control/Command+K and return with Escape. Recheck Space-pan and canvas shortcuts outside text entry, including `+` (Shift+`=`), `-`, `/` and `=`.
6. Open Inspect and Search by keyboard and close each with Escape. Verify focus return and expanded states.
7. With the OS reduced-motion setting off, run automatic Play. With it on, verify no advance, use Next screen, stop at the last screen, and check menu pop and tokens. Enable the preference mid-Play; verify no pending advance fires.
8. Listen to frame names, states, selection and action toasts with a real screen reader, or inspect the accessibility tree for groups, controls, popup states and live status.
9. Check real touch separately.
