---
name: create-flow-canvas
description: Turn a web app's codebase into one self-contained interactive HTML canvas of its real screens, grouped into user flows, at mobile, tablet and desktop size, with states, personas, connectors and findings. It renders the actual frontend code from a throwaway copy with mocked auth and data, so it needs no login, credentials or running backend. Use this whenever someone wants to see, map, review, audit, document or hand off a product's screens or user flows from its code, asks for a flow map, screen inventory, sitemap of screens or "all our pages in one place", or wants to regenerate an existing `.flow-canvas/` canvas, even if they never say "canvas".
---

# Create flow canvas

Given a codebase, produce one HTML file that shows its real screens as frames on a canvas, grouped by user journey. Opening the file needs nothing else: no server, no login. The reader can pan, switch device and state, inspect components, move things and leave notes.

You do the reasoning: what the routes are, where to mock, which states matter, how the journeys read. Scripts do the mechanics: capture, assembly, pixel check and validation.

The main idea is that you have the source, so you don't need an account or a backend. Replace the few files where the app meets the outside world, run the rest for real, and capture what the browser shows.

## Ground rules

These protect the user's project and data, and every step depends on them.

- **Work in a throwaway copy.** The original repository stays untouched until the end, when one new folder is added to it. Mocks overwrite real files, so they must never land in the original.
- **No `.env`, no real credentials.** With fake keys, a call that slips through can't reach anything real or spend anything.
- **Invented data only.** The canvas gets shared, and everything captured travels with it. Never put real customers, emails or tokens in it.
- **Outside network blocked during capture.** Mocks should make outbound calls unnecessary. `block-network.cjs` stops a missed one on the server. Capture guards the browser, letting through only GETs of outside stylesheets and fonts, which the page needs to look right. Assembly later fetches those same fonts and CSS images from the URLs the capture saw, so nothing secret should ever be in a URL.
- **Say what is true.** A canvas that looks finished but quietly shows a stub misleads design and product decisions. Mark what is approximate, omit what you can't prove and report what is missing.

## Prerequisites

Node 22 or newer. Playwright is not a dependency of this skill; capture looks for it in the current folder, the skill and the global npm root, or at `FLOW_PLAYWRIGHT` if you set it, and uses the machine's Chrome if there is one. Below, `$SKILL` is this skill's directory, as an absolute path.

## Workflow

### 1. Make the copy

```bash
REPO=/path/to/project
COPY="$(mktemp -d)/app"
git clone --quiet --no-hardlinks "$REPO" "$COPY"
git -C "$COPY" remote remove origin
find "$COPY" -type f -name '.env*' ! -name '*.example' ! -name '*.sample' ! -path '*/node_modules/*' -delete
```

A clone brings only committed files, so ignored secrets and stale `node_modules` stay behind. The `find` catches an env file someone committed. Also look for tracked key files (`*.pem`, service-account JSON) and delete them from the copy.

If the working tree has uncommitted changes, ask whether to include them. `git -C "$REPO" diff HEAD --binary | git -C "$COPY" apply` brings tracked changes. For a folder that isn't a git repository, `rsync -a --exclude node_modules --exclude '.env*'` does the same job.

Run everything below from the copy's app folder, because the scripts default to `.flow-canvas/` under the current directory. In a monorepo that is the package folder, except for the install, which runs at the workspace root. Shell state may not last between commands, so note the copy's absolute path and `cd` to it each time. If `$REPO/.flow-canvas/` exists, this is a regeneration: see step 9 first.

### 2. Detect the stack and install

Read `package.json` and the lockfile. **Next.js is the tested path.** Other React web stacks (Vite, Remix) are untested but use the same capture path. Vue, Svelte and anything else are best-effort: capture still works, but component names come only from React, so Inspect's component list will be empty. A framework needing a non-Node backend (Rails, Django, Laravel) has no seam this workflow knows how to mock. For anything except Next.js, tell the user before spending the time: this path is untested, here is what may not work.

Install from the lockfile with lifecycle scripts off, since this is code you are about to run with no review: `npm ci --ignore-scripts`, `pnpm install --frozen-lockfile --ignore-scripts`, or for Yarn `yarn install --immutable --mode=skip-build` (Yarn 1: `yarn install --frozen-lockfile --ignore-scripts`). If a native package then fails to load, rebuild only that one.

If Playwright isn't available, install it into an empty temp folder, not into the copy: `P="$(mktemp -d)"; (cd "$P" && npm init -y >/dev/null && npm i playwright)`, then record where it is so every later command finds it: `mkdir -p .flow-canvas && echo "$P/node_modules/playwright" > .flow-canvas/playwright-path`. (A plain `npm i --no-save playwright` inside a pnpm project fails, and an exported `FLOW_PLAYWRIGHT` doesn't survive to the next command; the scripts read the file, and `FLOW_PLAYWRIGHT` still wins if set.)

### 3. Find routes and write mocks

List every user-facing route from the code rather than from a guess at the navigation. In Next.js: `page.*` files under `app/` (folders in parentheses don't appear in the URL; skip `api/` and `route.*`), `pages/` in older apps, and `not-found.*` as a screen with route `"(404)"` and a `url` that doesn't exist. Note middleware that redirects, and dynamic segments, which need an id your mock data provides.

Then read `references/mocking.md` and write the mocks. Keep them in `.flow-canvas/mocks/`, mirroring the paths they replace, with fake env values in `.flow-canvas/env.fake`. Apply them with these commands, first checking that `pwd` is the copy, because on a regeneration the original has the same folder and this would overwrite its real files:

```bash
pwd
cp -R .flow-canvas/mocks/. ./
cp .flow-canvas/env.fake .env.local
```

**Where mocks go in a monorepo.** Mocks mirror paths from the app folder. A seam that lives in a sibling package (`packages/auth`, `packages/database`) is outside it, so keep those under `.flow-canvas/mocks/_root/`, mirroring paths from the workspace root, and copy them with a second command (`cp -R .flow-canvas/mocks/_root/. ../../`, from the app folder, adjusting the number of levels). The first command would otherwise create a literal `_root` folder in the app, so exclude it: `rsync -a --exclude _root .flow-canvas/mocks/ ./` does both jobs.

Keeping them apart from the source is what makes them reusable on the next regeneration. Start the server, with the outside network blocked and on a port you pick:

```bash
NODE_OPTIONS="--require $SKILL/scripts/block-network.cjs" npm run dev -- --port 3210
```

If the project's `dev` script isn't plain Node (`bun --bun next dev`, `turbo dev`), run the framework directly under Node so the preload applies: `NODE_OPTIONS=... npx next dev --port 3210` (Vite: `npx vite --port 3210`). If a `predev` or env check rejects the fake values, use the project's own skip flag (`SKIP_ENV_VALIDATION=true` for t3-env) rather than editing the check. Both are choices to mention in your report.

Run it in the background and watch its log. `[flow-canvas] refused outbound connection to <host>` names something you haven't mocked: mock it. If the app fetches fonts at build time from JavaScript, let those hosts through with `FLOW_ALLOW_HOSTS=fonts.googleapis.com,fonts.gstatic.com`. Use the dev server, not a production build, because component names come from React's development fibers. Native code such as a Rust bundler doesn't go through Node and isn't covered by the preload, which is one more reason the keys have to be fake.

### 4. Decide states and write scenarios

Read `references/project-files.md`, then write `.flow-canvas/scenarios.json`.

Each state comes from a persona cookie, a scenario cookie or clicks, all of which your mocks and the real UI respond to. Go page by page and ask what a person could actually see here: signed in and out, each plan or role that changes the screen, empty, error, an open dialog or menu. Prefer a few states that change the picture over many that don't.

**Look for branches the happy path hides.** Search each page for query parameters and provider-dependent results, the way `references/mocking.md` describes. Jolly Code, a real Next.js app this skill was built against, is the example: its checkout-success page, captured at its bare URL, showed only the no-`session_id` branch; the screen real customers land on needs a `session_id` and a mocked Stripe session. Write a scenario for each such branch you find, or record it as unreachable.

Ways a state can fall short:

- **Exists in code, can't be reproduced.** List it under the screen's `unreachable` in flows.json with evidence. It shows as a state marked `reachable:false` in the scan, and assemble writes the finding. Also list a state you did capture if nothing in the real UI leads to it. The canvas words every such finding as "no entry point in the UI", which overstates a state you merely couldn't mock, so try a scenario first and say which it was in your report.
- **Exists on only some devices** (a hover menu, a desktop-only panel). Give it `devices`. The other devices get a "doesn't exist on this device" placeholder automatically. Don't list such a state first: the first state is the screen's default render and has no placeholder.

**Capture what a person lands on.** A page that redirects after load (a checkout-success page that sends the customer home after a moment) is captured wherever it ends, and capture says so: the capture's signals carry `redirected` with where it ended. Decide what the frame is for. To show the page itself, give that state a short `settleMs` so it is caught before the redirect, name it for what it is ("Redirecting"), and add a second state or screen for where the customer ends up. Don't stub the redirect out to get a prettier picture of a page that is only "Redirecting...": that frame is honest but uninformative, so write in the screen's `note` what the customer then sees. If you can't reproduce the landing (it needs a provider's answer), list it under `unreachable` with the line of code.

In-screen tap reactions are not generated in this version. Don't write a `behaviour.js`; assemble would pick one up, but states come from real captures. Taps on links still follow connectors.

### 5. Capture, and repair what's wrong

```bash
node "$SKILL/scripts/capture.mjs" http://localhost:3210
```

It only accepts a local address. It captures each screen × state × device in a fresh browser context, with the clock and random numbers frozen, and writes `.flow-canvas/capture/`: `capture.json`, `report.json` and one `ref-<screen>-<state>-<device>.png` per capture. Options: `--scenarios`, `--out`, `--src` (the folder scanned for component names; default `src/`, or the project root), `--only id,id` (recapture just those screens, keep the rest), and `--timeout ms`. Expect several minutes: it first requests each URL once so a dev server compiles cold routes outside the page-load limit, then takes about 5 to 15 seconds per capture. A browser that dies mid-run is relaunched and the capture retried once.

**A clean exit doesn't mean right screens.** Read `report.json`, where each capture has `signals` (skeleton, spinner, error-toast, error-text, near-empty, dev-overlay, redirected), `finalUrl` and `pageErrors`, and the top-level `warnings`. Then open the reference PNGs and look at them. A mock can produce a perfectly rendered error page, and every later check will agree with it. Signals are suspicions: a state you looked at and accept lists them under `acknowledge`, and they stop showing. A `WARNING ... render the same` line means a persona or scenario changed nothing: the mock isn't reading its cookie.

| What you see | Likely cause | What to do |
| --- | --- | --- |
| `FAILED … Timeout` on a step | Selector wrong, or the control is missing on that device | Fix the step, or limit the state with `devices` |
| `FAILED` on page load | Server crashed or redirected | Read the server log |
| Skeleton or spinner | A callback or subscription in a mock never fires | Mock the behaviour, raise `settleMs` only if it was merely slow |
| Error toast, "Missing API key" | Fake env value missing, or a mock returning an error | Add it |
| `escaped` hosts in the output | The app redirected somewhere outside | Mock the route that redirects |
| `redirected` signal | A client-side redirect after load; the capture is where the page ended, not the page you asked for | Decide which one the frame is for (step 4, "Capture what a person lands on") |
| Every page is the Next or Vite error overlay | The dev server's compiler or a subprocess died (a SIGTERM in its log) | Restart the server, then recapture |
| `FAILED` with a timeout on a state that waits for an animation | A frozen clock stops time-based animation | `"freeze": { "clock": "run" }` in scenarios.json |
| Mock or seed data changed, picture didn't | A module cached state on `globalThis` | Restart the server, then recapture |
| `no component names` | Not React, or not a dev build | Expected off React; otherwise use the dev server |

Exit code 1 means at least one capture failed. Don't assemble over a failure: the canvas would show a "Capture failed" placeholder, and validate rejects it. Repair each page in this order, and stop when you reach the bounds. A long tail of mock-fixing on one page costs more than an honest placeholder:

1. **Repair the mock**, up to about three attempts per page, each aimed at a specific error.
2. **Render the page without its layout.** If a shell or provider is what breaks, stub that layout in `.flow-canvas/mocks/` so the page body renders and the stub survives a regeneration. Mark the screen `approximate: true`.
3. **Placeholder plus finding.** Remove it from scenarios, add it to flows.json with `route` and `unrendered: "<the actual reason>"`, and add a finding saying what's missing.

Use `approximate: true` for any screen with a stubbed part someone could mistake for real: a replaced widget, a canned chart, an edited page. Use `unrendered` only when there's no render at all. If a mock changes, recapture the screens that use it with `--only`, or everything when it is a shared seam: a mismatched canvas costs more than a rerun. To drop one state, remove it from scenarios.json and recapture its screen with `--only`.

### 6. Name groups, and state findings

Write `.flow-canvas/flows.json` (format in `references/project-files.md`).

**Groups are user journeys, not folders.** "Getting started: from invite to first project" says what a person is doing; `app/settings` says where a file is. A reader should be able to follow a group from left to right as one trip. A good title is a name, a colon, and the question the flow answers.

**Connectors are derived, never written.** Assemble draws them from `<a href>` links actually captured that lead to another captured screen, which is why flows.json has no field for them. Navigation done in code (`router.push`, a form redirect) produces no connector, and that's the right outcome: a missing line is honest and an invented one is a false claim about the product. Mention significant ones in a screen's `note` if they matter.

**Findings must be provable.** Each one needs `evidence` saying what in the code or the capture shows it, and assemble refuses one without. Good: "the Empty render has no link or button; `page.tsx:41` returns only a heading". Not a finding: "this could be clearer". If you can't point at it, leave it out.

### 7. Assemble, check, validate

With the dev server still running, because assembly fetches fonts and images from the URLs the capture saw:

```bash
node "$SKILL/scripts/assemble.mjs"
node "$SKILL/scripts/fidelity.mjs" --canvas .flow-canvas/flow-canvas.html --refs .flow-canvas/capture
node "$SKILL/scripts/validate.mjs"
```

Fidelity reads the assembled canvas, so assembly comes first. The server can stop after assembly.

**Assemble** writes `.flow-canvas/flow-canvas.html` and `assemble-report.json`, always from the skill's current template. Options: `--capture`, `--flows`, `--out`, `--template`. It stops with a list of problems when flows.json and the capture disagree; fix each one. Check the report's `dropped` fonts and images. A dropped font visibly changes the screen, and a font over budget can be allowed with `budgets` in flows.json if the file size can bear it.

**Fidelity** renders each capture as the canvas will and compares it to its reference, writing `fidelity.json` and `snap-*.png`. Default threshold 1%; options `--max-pct` and `--out`. Over threshold, compare `snap-<name>.png` with `ref-<name>.png` at the rows it names. Causes are usually a dropped font or a stylesheet that didn't make it across. Besides pixels, fidelity counts the page's text by colour in the reference and in the canvas, and fails when more than 5% of the characters changed colour (`--max-color-pct`): that is how a wrong stylesheet shows up, since the words are a sliver of the picture. Other causes seen: a WebGL canvas (its pixels aren't in the markup; the capture stores a still, which can differ), a `<video>` with no source (the canvas shows native controls), and a scrolled container (the reference had scrolled to the bottom of a chat). Fix the cause and don't raise the threshold to pass: a raised threshold hides exactly what this check exists to find. If a difference is real but small and you can't remove it, keep the threshold and report that screen. `MISSING` means no reference exists for a render. A match only proves the capture equals the running copy, not that the mock was right.

**Validate** reads the finished file with the canvas's own scan reader. Option: `--max-bytes`. Errors mean the page would open broken; each message names what to fix. Re-run from assemble after changing flows.json, and from capture after changing scenarios.json. Read warnings too: a "blank screen" warning means a device has no render for a screen's first state, usually because of a device-limited first state. A failed capture is an error.

### 8. Open it and look

The scripts can't tell you it reads well. `node "$SKILL/scripts/screenshot.mjs"` writes `.flow-canvas/canvas.png` and lists console errors, which is the way to look when no browser will open a `file://` page. Otherwise open the canvas in a visible browser tab (frames away from the view mount lazily; a background tab can look frozen). Check:

- Every group's frames show real screens, not skeletons or error pages.
- Switch mobile, tablet and desktop. Use the state switcher on a screen with several states.
- Inspect shows route, file and components.
- Connectors go where the product goes. Findings point at the right frame.
- The console has no errors.

Fix anything wrong at its source (mock, scenario, flows.json) and regenerate. Never hand-edit the HTML, since the next regeneration would discard it.

### 9. Save the project files

Copy the reusable part back into the original repository. This new folder is the only change the original gets:

```bash
mkdir -p "$REPO/.flow-canvas"
cp -R .flow-canvas/mocks .flow-canvas/env.fake .flow-canvas/scenarios.json .flow-canvas/flows.json .flow-canvas/flow-canvas.html "$REPO/.flow-canvas/"   # mocks/_root comes with mocks
```

Scan `mocks/` and `env.fake` for anything real before running this. In a monorepo, use the app's folder under `$REPO`, the same level you ran the scripts from. Don't commit unless asked. Recommend committing `mocks/`, `env.fake`, `scenarios.json` and `flows.json`, and adding `.flow-canvas/capture/` to `.gitignore`: it is large and rebuilt each run. Delete the throwaway copy when you're done, and stop the dev server.

**Regenerating.** Start at step 1, then copy `$REPO/.flow-canvas/` into the new copy and continue from step 2. In step 3, apply the mocks and check they still fit, since a replaced file may have changed upstream, and look for new routes and removed ones.

Keep ids stable, because the reader's saved layout is attached to them. `product.id` never changes. A screen's `id` in scenarios.json derives from its route pattern and stays (the scan's id is made from the route: `/items/[id]` becomes `items-id`, `/` becomes `home`). Give every group an explicit `id`. A regenerated canvas uses the current template and replaces only three blocks of it: `flow-scan`, `flow-scan-styles` (which keeps `media="not all"`, so the product's CSS can't restyle the canvas) and `flow-scan-behaviour`. A reader's moved frames and notes survive, and new screens appear.

### 10. Report honestly

Tell the user where the file is and what's in it, plainly, including:

- **Captured:** how many screens, states and devices (from `report.json`).
- **Approximate:** each `approximate` screen and what was stubbed.
- **Not reachable or not rendered:** each `unreachable` state and `unrendered` screen, and why.
- **Likely gaps:** branches you suspect but didn't capture, routes you skipped, navigation in code that has no connector.
- **Checks:** fidelity result with any screen over threshold, validate's result, dropped fonts, and anything you didn't get to look at.
- **Stack caveats**, if this wasn't Next.js.

Also say what changed in the repository (the new `.flow-canvas/` folder, not committed). A short honest list of gaps is worth more than a tour of the features: the reader's trust in every other frame depends on it.

## Reference files

| File | Read it when |
| --- | --- |
| `references/mocking.md` | Writing mocks, or a screen renders wrong (step 3, step 5) |
| `references/project-files.md` | Writing scenarios.json or flows.json (steps 4 and 6) |
| `references/capture-format.md` | Debugging by reading capture.json, or changing the scripts |
| `references/engine.md` | Changing the canvas engine or debugging it after a clean validate |
| `references/keyboard.md` | Changing keyboard handling or Play, or answering accessibility questions |
| `GLOSSARY.md` | Naming things in the engine or its docs |
