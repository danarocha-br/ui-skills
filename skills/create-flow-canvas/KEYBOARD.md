# Keyboard and reduced-motion support

Base: `a39dc52` (523 passing Node tests). Review source: architecture review 3, B6 accessibility bullets and B5 ownership context.

## Gap verification

- Frame wrappers had no tabindex, role or accessible name: confirmed, including placeholders.
- Disclosure/popup state was absent: confirmed. Panel inertness/focus return, status toasts and device pressed states already existed.
- The claim that taking out or connecting was wholly pointer-only no longer held: Control/Command+Shift+G, the selection toolbar take-out button and C for multiple selected frames already existed. They are preserved. Free movement, group reordering and choosing a connector destination needed keyboard alternatives.
- Connector tokens, Play auto-advance and menu pop ignored reduced motion: confirmed. Existing slide/ripple/spotlight gates are preserved.
- Lazy mounting retained wrappers and visible labels, but not accessible semantics or keyboard focus.
- Screen titles, busy state and the keyboard bridge already existed. Actual native Tab entry/exit could not be verified in this session.

## Decisions before implementation

The recommended focus/shortcut choices were presented to the user before coding. No alternative preference was supplied, so the following defaults were used.

- One Tab stop per frame; Left/Right move real focus in scan order. A group role preserves child semantics. The accessible name includes name, route, shown state, membership, disclosure and selection, without depending on a screen document.
- Preserve all existing shortcuts. Add Alt+Shift+Left/Right for one-slot reorder, Shift+arrow for a loose-frame nudge and Shift+F10 for Frame actions. Reuse Control/Command+Shift+G for taking out. The dialog offers a group picker and connector destination picker. Every layout edit uses the existing commit, save format and undo, and announces results through the status toast.
- Enter waits for mounting then enters a native screen control (or its body). Tab remains native. Escape follows the existing canvas chain and returns focus to the wrapper when the panel is closed. Rebuilds restore wrapper focus without changing selection.
- Add, Canvas, Views and group options are ARIA menus, with matching popup roles, expanded states, arrow/Home/End navigation and Escape/focus return. Inspect/Search control a complementary panel, so use expanded state and controls without claiming an ARIA popup role.
- Reduced-motion Play is manual from its first screen. Enabling the preference cancels automatic advance immediately. Disabling it does not unexpectedly restart that visit; start Play again for automatic playback. Tokens and menu pop are gated; durations belong to TIMING.
- Browser-free seams: FlowKeyboard, FlowPlayback, existing FlowArrange/FlowCommit and FrameDom's opaque focus adapter. Browser seam: the real canvas template with a replacement scan.

## How to test

Use Node 22+ for `node --test skills/create-flow-canvas/tests/*.test.mjs`.

Serve the repository root with `python3 -m http.server`; open `skills/create-flow-canvas/tests/browser.html` in a visible tab. **Click the page first**, then Run browser checks. New cases cover placeholder names/focus, frame edits and undo, menus/panels, screen entry/Escape and reduced-motion Play. Synthetic Tab only proves the handler does not cancel the event; it cannot exercise native traversal. The Play fixture controls the JavaScript preference, not CSS media queries.

Keyboard-only manual checklist (pending):

1. Tab and Shift+Tab through every frame and its controls, including a frame whose document starts absent. Use Left/Right to visit every wrapper; check focus ring, camera visibility, names and states.
2. Reach and activate a group chevron twice. Open Add, Canvas, Views and group options; use arrows, Home/End, Tab and Escape. Check expanded states and focus return.
3. Reorder a middle frame both ways and at both boundaries; take it out with Control/Command+Shift+G; nudge it; move it back with the group picker. Undo each edit once.
4. Choose a connector destination in Frame actions, create it and undo. Recheck pointer drag/reorder/take-out/edge-dot drawing.
5. Enter a mounted screen. Tab past its final control and backward before its first control. Check for traps, type text, activate native controls, open Search with Control/Command+K and return with Escape. Recheck Space-pan and canvas shortcuts outside text entry.
6. Open Inspect and Search by keyboard and close each with Escape. Verify focus return and expanded states.
7. With the actual OS/browser reduced-motion setting off, run automatic Play. With it on, verify no advance, use Next screen, stop at the last screen, and check menu pop/tokens. Enable the preference mid-Play; verify no pending advance fires.
8. Listen to frame names/state/selection and action toasts with a real screen reader. Otherwise inspect the accessibility tree for groups, controls, popup states and live status.
9. Check real touch separately.

## Execution limits

The sandbox refused the Python HTTP server bind (`PermissionError: Operation not permitted`). The visible browser rejects file URLs by policy. No browser-suite run, manual keyboard walkthrough, accessibility-tree inspection or real screen-reader listening was completed in this session. Real touch was not tested. Node and syntax checks do not establish a browser pass.

## Review results

Standards review: two findings, both fixed. Enter could stop at an unavailable fieldset control; the host now checks effective disabled/inert/visibility state and tries candidates until focus succeeds, including summary and editable text. A pointer flag local to one screen could suppress later keyboard re-entry; modality is now shared across parent and product documents. Follow-up review found no remaining concrete issue.

Spec review: two findings, both fixed. Frame-arrow navigation bypassed the old Play cancellation; explicit navigation and edits now stop playback. The new browser action test reopened a dialog before its queued close handler finished; it now awaits completed close/focus return. Follow-up review found no further concrete issue. Worst initial Standards issue: Enter could fail to reach a usable control. Worst initial Spec issue: Play could override explicit keyboard navigation.

Self-review also moved action announcements after the modal closes (the page status region is inert during the modal), revealed a closed group's controls when reached by reverse traversal, focused Stop for single-screen manual Play, kept Search's modifier shortcut available inside menus, and reused the keyboard nudge rule for dialog buttons. Browser regressions were added for these focus/playback cases but remain unexecuted.

## Automated evidence

- Baseline on Node 22.22.2: 523 tests passed.
- Final on Node 22.22.2: 532 tests passed, zero failures, skips or cancellations. This includes the existing engine-purity, layout-write/ownership, geometry and timing guards. The FrameDom public-interface guard still rejects every undeclared method and now declares its tested boolean focus operation.
- All 19 executable HTML script blocks compile; `tests/browser.mjs` passes Node's syntax check.
- Browser harness: 24 cases registered (16 existing plus 8 added), **not run**. This is a count of cases, not a pass count.
- The saved layout schema and persistence modules were not changed. Existing pointer handlers remain in place, but real pointer regression checks are pending with the other browser work.
