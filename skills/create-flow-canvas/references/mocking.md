# Writing mocks

Read this at step 3, before writing the first mock. The aim: every route renders real frontend code, with no backend, no credentials and no outside calls, by replacing a few files where the app meets the outside world.

## Find the seams

Look for the smallest number of files that everything passes through, and replace those. Page code stays real, which is why the canvas is worth having.

| Seam | Where to look | Replace with |
| --- | --- | --- |
| Auth | The session helper, middleware, `auth()` calls, provider wrappers | A fake user chosen by the persona cookie |
| Data | The client factory (Supabase, Prisma, Drizzle), the API client, server actions, `fetch` wrappers | A fake client returning invented rows |
| Payments | The Stripe or Paddle wrapper, webhooks, checkout pages | Canned sessions and subscriptions |
| Realtime and collaboration | Liveblocks, Pusher, socket providers | A provider that renders children and emits nothing harmful |
| Mail, analytics, AI, storage | Module-level SDK clients | No-op clients with the right return shapes |
| Feature flags | The flag client | Fixed values, varied by scenario |

Prefer a seam high enough that one fake covers many callers. Editing individual pages is a last resort, and a page edited that way is `approximate: true`.

Not every seam is a client. These came up on real apps, and each needs its own move:

- **A query builder that is the data layer (Drizzle, Kysely, raw SQL).** A Proxy fake can't answer joins and aggregates. Replace the one module that creates the database handle with an in-memory Postgres (PGlite) migrated from the repo's own migration files and filled with invented rows. The real queries then run, so the screens show what the code computes. Seed dates must sit inside the frozen clock's "last 7 days" (see Dates and clocks).
- **An admin or service-role client**, next to the user client. List it as its own seam: pages that read it for counts and membership otherwise render empty or crash.
- **Realtime (Liveblocks and the like).** Stub the room provider and the presence component so they render children and emit nothing. Removing presence avatars changes the picture: say so in the screen's `note`, and mark the screen `approximate` when the missing part is large.
- **A hosted widget (Clerk's sign-in, an embedded third-party iframe, a map).** It won't load with the network blocked. Replace it with a labelled stand-in, and mark the screen `approximate: true`. A blank hole reads as a product bug.
- **Build-time seams.** A `next.config` that validates env, imports a font from the network, or wraps the config in a vendor plugin can stop the server before any page loads. Mock the config file too.
- **Providers that live in a sibling workspace package** (`packages/auth`, `packages/database`). The mock goes at that path: see Where mocks go in a monorepo in SKILL.md step 3.

**One function in a large file.** The Stripe call is one function inside a 360-line module whose other exports must stay real. A mock replaces a whole file, so either copy the file with only that function changed, or add a thin module the page already imports and swap that. Mark the copy in a comment (`/* flow-canvas: only retrieveSession is changed */`) so the next regeneration can compare it with the upstream file, which may have moved on.

## Mock behaviour, not only shape

An API with the right types can still strand the UI. On Jolly Code the editor was captured as a loading skeleton because the fake `onAuthStateChange` never called back. Callbacks must fire, subscriptions must emit their initial value, and promises must resolve. When a screen is stuck loading, look for the event it is waiting on.

Return the error shape the real client returns, too. A missing row should look like the real "no rows" error, so the app's own handling runs.

## Recipes

These worked on Sonara, a real pnpm monorepo on Next 16 with Turbopack.

### Replace an npm package everywhere (Clerk, PostHog)

When imports of a package are spread across the app, redirect the package rather than chasing callers. Add `paths` to the app's `tsconfig.json`, as a mock. Turbopack honours them, and the most specific entry goes first:

```json
"paths": {
  "@clerk/nextjs/server": ["./src/flow-mock/clerk-server"],
  "@clerk/nextjs": ["./src/flow-mock/clerk-client"]
}
```

`paths` covers only code compiled with that tsconfig. A sibling workspace package that imports the same library has its own tsconfig, so give it the same entries or mock its seam. Export everything the app imports: a missing export is a build error that names it.

Make the provider a **server** component that reads the persona cookie and passes the fake user to a client provider. A provider that only runs in the browser renders signed-out on the server, and hydration fails. A real `ClerkProvider` usually sits in the root layout, so that means a mock of `layout.tsx` with the one import changed. Mark it with a `/* flow-canvas: */` comment. Keep the real `proxy.ts` running on the fake `clerkMiddleware`, so redirects are the product's own.

### Prisma on an in-memory Postgres

The real queries run, from the app's own migrations. Add two packages in the copy only, then keep them out of the bundle:

```bash
pnpm add @electric-sql/pglite pglite-prisma-adapter
```

In `next.config`, set `serverExternalPackages: ["@electric-sql/pglite", "pglite-prisma-adapter"]`. The install changes the copy's `package.json` and lockfile, so do it after the frozen install, and note it on a regeneration. Network must be on for that one command, before the server starts. Then replace the module that creates the client:

```ts
/* flow-canvas: Prisma on an in-memory Postgres, built from the repo's migrations. All rows are invented. */
const g = globalThis as unknown as { __flowDb?: Promise<PrismaClient> };
async function build() {
  const pg = new PGlite();
  const dir = path.resolve(process.cwd(), "prisma/migrations");
  for (const name of fs.readdirSync(dir).sort()) {
    const file = path.join(dir, name, "migration.sql");
    if (fs.existsSync(file)) await pg.exec(fs.readFileSync(file, "utf8"));
  }
  const client = new PrismaClient({ adapter: new PrismaPGlite(pg) as any });
  await seed(client);
  return client;
}
g.__flowDb ??= build();
export const db = await g.__flowDb;
```

The adapter sends no array literal for enum arrays, so a `{ has: X }` filter (SQL `col @> $1`) fails. Wrap `pg.query` and, only on statements containing `@>`, turn the parameter into a Postgres array literal such as `{"ADMIN"}`. Check that against your own enums, since a blanket rewrite would also change ordinary string parameters.

### Route handlers and cookies

`cookies()` from `next/headers` can throw "outside a request scope" inside a route handler when work outlives Next's request scope. tRPC's fetch adapter does this. It surfaces as a 500 on a client query and draws as a stuck skeleton: capture reports it as `failed-requests`. Read the cookie from the `Request` instead, with a one-line wrapper in the route file and an `AsyncLocalStorage` your fake auth checks first:

```ts
/* in the fake auth */
export const requestCookies = (globalThis.__flowCookies ??= new AsyncLocalStorage());
const read = (name: string) => requestCookies.getStore()?.(name) ?? null; /* then fall back to next/headers */

/* in the route: only this wrapper is added */
const wrapped = (req: Request) => requestCookies.run(
  (name) => new RegExp(`(?:^|; )${name}=([^;]*)`).exec(req.headers.get("cookie") ?? "")?.[1],
  () => handler(req),
);
export { wrapped as GET, wrapped as POST };
```

## Personas and scenarios

Capture sets two cookies per state, `flow-persona` and `flow-scenario` by default. They are readable on the server and in the browser, so one fake serves both. A persona is who is looking (guest, member, admin, a paid plan). A scenario is what the data looks like (empty, error, over quota, paid). Read each cookie with a default so a page with no cookie still renders.

After any change to a mock or its seed data, restart the dev server. Module state kept on `globalThis` (a seeded database, a cached client) survives hot reloads, so a rerun against the old process captures the old data and sends you looking for a bug that is already fixed.

**Check that a persona actually changes something.** A mock that fails to read its cookie gives every state the same result, and the screen still looks fine: on Orbix the admin and member captures were byte-identical, so admin pages rendered read-only for everyone. Give each persona one thing visibly its own (a name in the header, an admin-only control), and read capture's `WARNING ... render the same` line: it names two states that ask for different personas or scenarios but produce identical markup on a device.

## Dates and clocks

Capture freezes `Date` at `freeze.now` (2026-01-15 by default), in the browser and, through `server-preload.cjs`, on the server, so server-rendered text ("2 hours ago") matches what the browser computes. The server's `Date` stands still even with `"clock": "run"`, and its random numbers stay random. Invented rows dated later are "in the future" to a "last 7 days" panel and the panel is empty. Date the seed relative to `freeze.now`, or set `freeze.now` to fit the seed.

A frozen clock stops anything that animates by time. GSAP-style timelines never advance, so a state that waits for an animation to finish times out on every device. Set `"freeze": { "clock": "run" }` in scenarios.json: the clock starts at `freeze.now` and then runs, and random numbers stay seeded. `"freeze": false` turns both off, for a page that cannot be captured otherwise; the picture is then not repeatable.

## Static files and middleware

A mock file served from `public/` still passes through middleware (`proxy.ts`, `middleware.ts`) unless its extension is in the matcher's skip list. On Sonara, a fake `.wav` came back as sign-in HTML with status 200, so the player broke with no error. Use an extension the matcher already skips, or mock the matcher.

## Environment

Don't copy `.env`. Put invented values in `.flow-canvas/env.fake` (a name most `.gitignore` files don't exclude, and SKILL.md step 3 copies it to `.env.local`), one per key the app requires, shaped like the real thing and pointing nowhere (`sk_test_flowcanvas`, `http://localhost:9`). Both matter when validation is involved: set the validator's skip flag (t3-env has one) and still give every key a fake value, because SDKs such as `new Resend()` throw at module load on a missing key.

This file is committed, so it holds nothing real, ever.

## Invented data

Use obviously fake people and content: `ada@example.test`, "Greeting helper", "Favourites". Don't paste from seeds, fixtures or dumps that might hold real customer data. Do reuse stories and test factories when they are plainly synthetic.

Two things to watch, because the data ends up in the picture:

- A captured `<a href>` to a known route becomes a connector, whether the app or your data wrote it. Links stored in invented rows should be `https://example.test/...`, so they aren't drawn as navigation the product doesn't have.
- For a list linking to a detail page to produce a connector, the row's id must match the `url` you capture: `item-1` in the row, `/items/item-1` in scenarios.json.

## A worked shape

On Jolly Code, a real Next.js app, the first version replaced four files in `src/utils/supabase/` with one fake client, and stubbed `Room` and `users-presence` (Liveblocks). Every route rendered.

```ts
/* All data here is invented. */
const USERS: Record<string, any> = {
  guest: null,
  pro: { id: "u-1", email: "ada@example.test", user_metadata: { full_name: "Ada Example" } },
};
const TABLES: Record<string, any[]> = {
  profiles: [{ id: "u-1", plan: "pro", username: "ada" }],
  snippet: [{ id: "s-1", user_id: "u-1", title: "Greeting helper" }],
};

/* A chainable query: unknown methods return the builder, awaiting it gives the real result shape. */
function query(table: string) {
  let rows = [...(TABLES[table] ?? [])], one = false;
  const done = () => ({
    data: one ? rows[0] ?? null : rows,
    error: one && !rows[0] ? { code: "PGRST116", message: "no rows" } : null,
  });
  const builder: any = new Proxy({}, { get(_target, key) {
    if (key === "then") return (ok: any, no: any) => Promise.resolve(done()).then(ok, no);
    if (key === "single") return () => { one = true; return builder; };
    if (key === "eq") return (column: string, value: any) => {
      if (rows[0] && column in rows[0]) rows = rows.filter((row) => row[column] === value);
      return builder;
    };
    return () => builder;
  } });
  return builder;
}

export function client(persona: string) {
  const user = USERS[persona] ?? null;
  const session = user ? { user, access_token: "mock", expires_at: 4102444800 } : null;
  return {
    auth: {
      getUser: async () => ({ data: { user }, error: user ? null : { message: "no session" } }),
      getSession: async () => ({ data: { session }, error: null }),
      /* this callback firing is what got the editor past its skeleton */
      onAuthStateChange: (callback: any) => {
        setTimeout(() => callback("INITIAL_SESSION", session), 0);
        return { data: { subscription: { unsubscribe() {} } } };
      },
    },
    from: query,
    channel: () => ({ on() { return this; }, subscribe() { return this; } }),
    removeChannel: () => {},
  } as any;
}
```

The server and browser entry points each read `flow-persona` their own way (`cookies()` from `next/headers`, `document.cookie`) and call `client(persona)`.

## Hunting branches the happy path hides

Most missed states sit behind something the mock did not provide. For each page, search its code for:

- Query parameters and URL state: `searchParams`, `useSearchParams`, `req.nextUrl`, `location.search`.
- Calls to a provider whose answer decides what renders: `stripe.checkout.sessions.retrieve`, an OAuth callback code, an invite token.
- Conditionals on plan, role, quota, flag or dates.
- `loading.tsx`, `error.tsx`, `not-found.tsx`, and `if (!data)` or `redirect(` near the top of a page.

Redirect-only routes (a page whose only job is `redirect()`) are not screens: capture follows them, so list them in your report instead. `error.tsx` boundaries need a thrown error: add a scenario value your mock turns into a throw for one data call, capture it as a state, or report the boundary as not reached.

For Jolly Code's checkout-success page (SKILL.md step 4), the fix is a Stripe mock that returns a paid session for a known id, and a second scenarios entry whose `url` carries that id (`project-files.md` has the exact shape). Where you can't reach a branch that way, record it under `unreachable` in flows.json, with the line of code as evidence, so the reader knows it exists.
