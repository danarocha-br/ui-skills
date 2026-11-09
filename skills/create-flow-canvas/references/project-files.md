# The files you write: scenarios.json and flows.json

Read this while writing `.flow-canvas/scenarios.json` (step 4) or `.flow-canvas/flows.json` (step 6). `capture-format.md` describes what the scripts write between them; you rarely need it.

## scenarios.json: what to capture

```json
{
  "cookies": { "persona": "flow-persona", "scenario": "flow-scenario" },
  "freeze": { "now": "2026-01-15T12:00:00.000Z", "seed": 42 },
  "budgets": { "item": 150000, "total": 1500000 },
  "settleMs": 4000,
  "screens": [
    {
      "id": "items-id",
      "route": "/items/[id]",
      "url": "/items/item-1",
      "states": [
        { "name": "Signed in", "persona": "member" },
        { "name": "Signed out", "persona": "guest" },
        { "name": "Empty", "persona": "member", "scenario": "empty" },
        { "name": "Delete dialog", "persona": "member", "devices": ["desktop"],
          "steps": [{ "click": "[data-testid=delete]" }, { "waitFor": "[role=dialog]" }] }
      ]
    }
  ]
}
```

Only `screens` is required; the other top-level keys show their defaults.

| Field | Meaning |
| --- | --- |
| `cookies` | Names of the two cookies capture sets. Your mock reads them. |
| `freeze` | `Date` is frozen at `now` and `Math.random` seeded, so regenerating gives the same picture. |
| `budgets` | Bytes of inlined media in the page: `item` per image, `total` per capture. Over budget, an image is dropped and listed. |
| `settleMs` | Wait after page load before any step. Raise it for a screen that is still loading in its reference. |
| `screens[].id` | Letters, digits, `_`, `-`; unique. Derive it from the route pattern and keep it for good. |
| `screens[].route` | The route pattern as the code declares it; `"(404)"` style names for screens with no route. |
| `screens[].url` | The concrete path to load, starting with `/`. May carry a query string. |
| `states[].name` | Shown on the canvas. The first state is the screen's default render, so list one that exists on every device first: only later states get the "doesn't exist on this device" placeholder. |
| `states[].persona` | Value of the persona cookie. |
| `states[].scenario` | Value of the scenario cookie. |
| `states[].devices` | Limit to some of `mobile` (390×844), `tablet` (768×1024), `desktop` (1200×772). Default: all three. |
| `states[].steps` | Run in order after settling, each `{ "click": sel }`, `{ "hover": sel }`, `{ "fill": sel, "value": text }`, `{ "press": key }`, `{ "wait": ms }` or `{ "waitFor": sel }`. Each selector step waits at most 10 seconds. |

A state cannot change the URL. A branch that depends on the URL is a second entry in `screens`, with its own `id`, `url` and a `route` that names the branch:

```json
{ "id": "checkout-success-session-id", "route": "/checkout/success?session_id", "url": "/checkout/success?session_id=cs_flow_1",
  "states": [{ "name": "Paid", "persona": "member" }] }
```

It becomes its own frame, with a scan id made from that route. Don't reuse the exact same `route` string: the fidelity check then can't find the entry's reference and reports `MISSING`, and the ids become position-dependent (`~2`), which can move a reader's saved edits. A link to that path goes to whichever entry comes first in `flows.json`.

## flows.json: what you know about the product

```json
{
  "product": { "id": "acme-app", "name": "Acme", "scanned": "November 2026" },
  "start": "home",
  "screens": [
    { "id": "home", "name": "Home", "file": "src/app/page.tsx", "note": "Marketing landing." },
    { "id": "items-id", "name": "Item", "file": "src/app/items/[id]/page.tsx", "approximate": true,
      "caption": { "title": "Item", "body": "Comments are stubbed." },
      "unreachable": [{ "name": "Suspended", "source": "src/app/items/[id]/page.tsx",
                        "evidence": "rendered when item.suspended, which no code path sets" }] },
    { "id": "admin", "name": "Admin", "file": "src/app/admin/page.tsx", "route": "/admin",
      "unrendered": "Needs a WebGL context the capture browser could not create" }
  ],
  "groups": [
    { "id": "browsing", "title": "Browsing: from landing to an item", "sub": "No account needed", "screens": ["home", "items-id"] }
  ],
  "findings": [
    { "kind": "dead-end", "screen": "items-id", "source": "src/app/items/[id]/page.tsx",
      "text": "The empty state has no way back to the list.",
      "evidence": "the Empty render contains no link or button; page.tsx:41 returns only a heading" }
  ]
}
```

- `product.id` and `product.name` are required. `product.id` scopes the reader's saved layout, so it never changes, even through a rename.
- Every captured screen needs an entry here with `name` and `file`, using its `id` from scenarios.json.
- `unreachable` is described in SKILL.md step 4, `approximate` and `unrendered` in step 5. An `unrendered` screen with no capture also needs `route`.
- A screen is in at most one group. A screen in none is a loose frame; assemble and validate list these.
- Set a group's `id`. Without one it comes from the title up to the first colon, so a retitled group would lose the reader's edits. A group id must differ from every screen id.
- `group.meta` defaults to the source folders of its screens. `open: false` starts it closed.
- `caption` defaults to the screen's name over its route. `on: false` hides it.
- `findings[].kind`, `screen` and `evidence` are required. `text` is what the finding says, and the only wording shown for any kind other than the two below. `evidence` stays in the scan and is not drawn, so make `text` state the claim.

| Finding kind | Facts it needs | Notes |
| --- | --- | --- |
| `reused-component` | `component`: a name tagged in the capture | The engine writes the wording and links the screens using it. |
| `unreachable-states` | none of yours | Written by assemble from a screen's `unreachable` list; don't add it by hand. |
| `unnamed-link` | none of yours | Written by assemble for a captured link with no accessible name. |
| anything else | `text` | Shown as written. |

In flows.json, `budgets` covers what assembly inlines (different from the `budgets` in scenarios.json) and may set `fontBytes` (1.6 MB), `fontTotalBytes` (3 MB), `imageBytes` (150 KB), `imageTotalBytes` (1.5 MB) and `fileBytes` (12 MB). Validate has its own `--max-bytes` for the file limit and does not read this field, so a raised `fileBytes` needs the flag too.

There is no field for connectors, on purpose: see step 6 of SKILL.md.
