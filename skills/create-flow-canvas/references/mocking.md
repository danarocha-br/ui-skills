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

## Mock behaviour, not only shape

An API with the right types can still strand the UI. On Jolly Code the editor was captured as a loading skeleton because the fake `onAuthStateChange` never called back. Callbacks must fire, subscriptions must emit their initial value, and promises must resolve. When a screen is stuck loading, look for the event it is waiting on.

Return the error shape the real client returns, too. A missing row should look like the real "no rows" error, so the app's own handling runs.

## Personas and scenarios

Capture sets two cookies per state, `flow-persona` and `flow-scenario` by default. They are readable on the server and in the browser, so one fake serves both. A persona is who is looking (guest, member, admin, a paid plan). A scenario is what the data looks like (empty, error, over quota, paid). Read each cookie with a default so a page with no cookie still renders.

## Environment

Don't copy `.env`. Put a file of invented values at `.flow-canvas/mocks/.env.local`, one per key the app requires, shaped like the real thing and pointing nowhere (`sk_test_flowcanvas`, `http://localhost:9`). Both matter when validation is involved: set the validator's skip flag (t3-env has one) and still give every key a fake value, because SDKs such as `new Resend()` throw at module load on a missing key.

This file is committed, so it holds nothing real, ever.

## Invented data

Use obviously fake people and content: `ada@example.test`, "Greeting helper", "Favourites". Don't paste from seeds, fixtures or dumps that might hold real customer data. Do reuse stories and test factories when they are plainly synthetic.

Two things to watch, because the data ends up in the picture:

- A captured `<a href>` to a known route becomes a connector, whether the app or your data wrote it. Links stored in invented rows should be `https://example.test/...`, so they aren't drawn as navigation the product doesn't have.
- For a list linking to a detail page to produce a connector, the row's id must match the `url` you capture: `item-1` in the row, `/items/item-1` in scenarios.json.

## A worked shape

The Jolly Code spike replaced four files in `src/utils/supabase/` with one fake client, and stubbed `Room` and `users-presence` (Liveblocks). Every route rendered.

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

Jolly Code's checkout-success page is the example to learn from. Captured at its bare URL it showed only the no-`session_id` branch, which is the screen almost nobody sees. The real path needs a `session_id` and a Stripe session to look up. The fix is a Stripe mock that returns a paid session for a known id, and a second scenarios entry whose `url` carries that id. Where you can't reach a branch that way, record it under `unreachable` in flows.json, with the line of code as evidence, so the reader knows it exists.
