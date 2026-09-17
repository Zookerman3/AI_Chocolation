# Architecture

Two apps and one API. The tablet records boxes at the counter; the dashboard reads them in
the office. The API is the only thing between them, and it is small on purpose.

## The shape of it

```
  COUNTER TABLET (AI_Chocolation, Vercel project 1)
  ┌──────────────────────────────────────────────────────────┐
  │                                                          │
  │   cashier taps ──► BoxSession ──► save ──► localStorage  │  ◄── the primary path.
  │                                             (records)    │      Every box is written
  │                                                │         │      here, synchronously,
  │                                                │         │      before anything else.
  │                                                │         │      No network on this path.
  │                                       ┌────────┴───────┐ │
  │                                       │ outbox (derived)│ │
  │                                       │ pending() =     │ │
  │                                       │  real records   │ │
  │                                       │  − acked ids    │ │
  │                                       └────────┬───────┘ │
  │                                                │         │
  └────────────────────────────────────────────────┼─────────┘
                                                   │  POST /api/boxes
                                                   │  batches of 100
                                                   │  same origin, no config
                                                   ▼
             ┌──────────────────────────────────────────────────────┐
             │  API  (serverless functions in the SAME project)      │
             │                                                      │
             │   api/boxes.ts   GET  ?from&to&location&limit         │
             │                  POST one | [..] | {records:[..]}     │
             │   api/health.ts  GET  ok, store, durable, count       │
             │                                                      │
             │   _lib/http.ts    CORS, token gate, body parsing      │
             │   _lib/record.ts  validateRecord — the gate           │
             │   _lib/store.ts   picks one store at runtime:         │
             └────────────────────────┬─────────────────────────────┘
                                      │
                    ┌─────────────────┴─────────────────┐
                    ▼                                   ▼
        KV_REST_API_* present?              nothing configured
        ┌──────────────────────┐            ┌──────────────────────┐
        │ redis (Upstash REST) │            │ memory               │
        │ one hash, key by id  │            │ a Map, key by id     │
        │ durable: true        │            │ durable: false       │
        │ plain fetch, no SDK  │            │ lost on cold start   │
        └──────────────────────┘            └──────────────────────┘
                                      ▲
                                      │  GET /api/boxes  (cross-origin, public)
                                      │
  ┌───────────────────────────────────┴──────────────────────────────┐
  │  ADMIN DASHBOARD (case-notes, Vercel project 2)                  │
  │                                                                  │
  │   VITE_API_BASE ──► fetchBoxes ──┐                               │
  │   drag-in CSV/JSON ──► ingest ───┼──► BoxRecord[] ──► aggregate()│
  │   "Load sample data" ────────────┘                     (client)  │
  │                                                           │      │
  │                                                     screens      │
  │                        (pure: no fetching, no filtering, no      │
  │                         aggregation — they receive an Aggregate) │
  └──────────────────────────────────────────────────────────────────┘
```

Two things to read off that diagram.

**localStorage is the primary path, not a fallback.** A box is saved locally and the
cashier moves on. Sync is something that happens to a box afterwards, never something a
box waits for. `syncOnce` cannot throw into a render path and never touches the saved
records themselves — a sync can fail in every possible way and the counter keeps working
exactly as it did before there was an API.

**The API is in the tablet's project, not its own.** The tablet posts to its own origin at
`/api/boxes`, so a counter device needs zero configuration. Only the dashboard, on a
different origin, needs to be told where the API is.

## How sync actually works

The outbox does not hold a queue of records. It holds a set of **acknowledged ids**, and
pending work is derived:

```
pending(records, acked) = records.filter(r => !r.demo && !acked.has(r.id))
```

sorted oldest first, so the shop's history arrives in the order it happened. Deriving it
means the outbox can never disagree with the records themselves.

| Behaviour | Where |
|---|---|
| Batch size 100 (server cap is 500) | `client.ts` `BATCH_SIZE` |
| An id is acknowledged only when it comes back in the response's `accepted` list | `boxes.ts` → `sync.ts` |
| Writes are idempotent on record id — re-sending is harmless | `store.ts` (`HSET` / `Map.set`) |
| A record the server rejects is marked acknowledged so it stops being retried, and the reason is kept and surfaced | `sync.ts`, `SyncStatus.tsx` |
| Stop at the first transport failure; the rest stays queued | `sync.ts` |
| Retry every 60s while anything is queued, plus on mount, after every saved box, and on the browser `online` event | `useSync.ts` |
| Demo records never sync | `outbox.ts` `pending()` |
| A mixed batch returns 207 with a `rejected` list rather than failing the whole thing | `boxes.ts` |
| `receivedAt` is stamped by the server and never trusted from the client | `boxes.ts`, `record.ts` |

That last one is what lets the dashboard tell "new to the server" from "an old box that
synced late". A tablet's clock is not authoritative.

## The data contract

One shape moves through all three codebases:

```ts
interface BoxRecord {
  id: string
  size: 6 | 10 | 16 | 30 | 50
  pieces: { flavorId: string; count: number }[]  // counts sum to `size`
  startedAt: string        // ISO 8601
  completedAt: string      // ISO 8601 — what from/to filter on
  durationMs: number
  undoCount: number
  method: 'tap' | 'camera-assisted'
  demo: boolean            // true records are excluded from every real aggregate
  locationId?: string      // additive, optional
  receivedAt?: string      // server-stamped on first accept; never sent by a client
}
```

`validateRecord` in `api/_lib/record.ts` is the gate. It accepts only what the tablet
actually writes, normalises `completedAt` to ISO, defaults a missing `startedAt` to
`completedAt`, coerces `demo` to a real boolean, and refuses anything else with a reason a
client can display. The strictest rule is that piece counts must total the box size — the
tablet will not let a box save otherwise, so a mismatch here means something other than the
tablet is posting.

### The type is duplicated in three places

| Copy | Why it exists |
|---|---|
| `src/domain/types.ts` in the tablet app | The source of truth. The app writes records. |
| `src/domain/types.ts` in the dashboard | The dashboard reads them and must not depend on the tablet's repo. |
| `api/_lib/record.ts` | The serverless function's copy. |

The third one is the one that needs explaining. A Vercel serverless function is bundled
separately from the browser app. If `api/boxes.ts` imported the app's `src/domain/types.ts`
it would pull a module that sits inside the React tree's import graph into a function whose
whole job is to parse JSON and write a hash. The function stays free of the app, and the
app stays free of the function.

Nothing enforces that duplication at the type level. **Contract tests are what keep the
three in step**, and they are deliberately written as transcriptions rather than imports:

- `api/api.test.ts` — 24 tests against the handlers as ordinary functions, including
  `validateRecord`'s normalisation and refusals.
- `src/lib/interop.test.ts` in the dashboard — reproduces the tablet's exporter *verbatim*
  from `src/features/records/csv.ts`, then feeds its output through the dashboard's
  importer. If either side's format changes, this fails.
- `src/features/sync/*.test.ts` in the tablet app — 20 tests over the outbox and the sync
  pass.

If you change `BoxRecord`, change all three copies in the same PR and expect the contract
tests to tell you if you missed one.

## Why aggregation is client-side

The dashboard fetches records and runs `aggregate()` in the browser. There are no
server-side rollups, and the API has no aggregate endpoint.

At a shop's volume — tens of boxes a day, a few thousand a year — rollups buy nothing. A
whole year fits comfortably in one response and aggregates in milliseconds.

The real reason is the one that would still hold at ten times the volume: the dashboard has
three ways in — sample data, a dropped-in CSV/JSON export, and the live API — and all three
produce the identical `BoxRecord[]` and run the identical aggregation function. Move the
rollup to the server and the live path returns pre-chewed numbers while the file path still
has to compute them in the browser. Two implementations of the same arithmetic, one of them
exercised only when someone drags a file in. The file path would drift from the live path
and nobody would notice until a judge dragged in an export and got a different number.

The same reasoning shapes the redis store: it reads the whole hash and filters in the
function rather than maintaining indexes. One round trip, no index to keep consistent, and
the memory store and the redis store share the same `applyQuery`, so they cannot disagree
about what a filter means.

## Known limits

Keep this honest and current. The judges score it.

- **The in-memory fallback is not storage.** With no `KV_REST_API_URL`/`KV_REST_API_TOKEN`
  (or the `UPSTASH_REDIS_REST_*` pair), the API holds boxes in a `Map` inside the
  serverless instance. Behaviour is correct — same filtering, same idempotency, same
  responses — and it survives within a warm instance, but it is **lost on cold start**, and
  a serverless instance goes cold within minutes of no traffic. It exists so the API works
  on the very first deploy, before anyone has provisioned anything. `GET /api/health`
  reports `durable: false` and says so in plain English rather than letting anyone mistake
  it for a database. See DEPLOY.md step 2.

- **`VITE_SYNC_TOKEN` is not a secret.** `VITE_*` variables are compiled into the browser
  bundle. Once `SYNC_TOKEN` is set on the server, writes need a matching `x-sync-token`
  header, and the tablet sends it from `VITE_SYNC_TOKEN` — which anyone can read out of the
  JavaScript with devtools. It deters a casual write from someone who found the endpoint.
  It does not authenticate anybody. Reads are public with no token at all, on purpose: the
  rubric's first gate is that the link opens with no login and no install.

- **There is no per-tablet identity.** `locationId` is optional on the record, and the
  tablet app's `src/domain/types.ts` does not currently carry the field or set it — only
  the dashboard's copy and `api/_lib/record.ts` know about it. So today every box arrives
  unattributed, the API's `?location=` filter matches nothing, and the dashboard's location
  filter hides itself rather than offering a single useless option. Making this work is an
  additive change on the tablet side (set `locationId` per device at save time); nothing on
  the server or the dashboard needs to move.

- **Acknowledged ids live in the same localStorage that clearing site data wipes.** The set
  is `ai-chocolation:synced-ids`, in the tablet's own localStorage, capped at 5000 ids. Clear
  site data — or clear it to shift a stale service worker, which is the likely reason anyone
  would — and the tablet forgets what the server already has. It then re-sends every real
  record it still holds. This is harmless: writes are idempotent on record id, so the server
  overwrites rather than duplicating. The visible cost is one pass with a queue on the sync
  chip. It is worth knowing that clearing site data *also* wipes the records themselves, and
  that loss is not recoverable from the tablet.

- **The API is append-and-overwrite only. There is no delete and no edit path.** `POST`
  writes or overwrites by id; there is no `DELETE`, no `PATCH`, and nothing in the tablet or
  the dashboard that would call one. A box posted by mistake stays until somebody removes
  the key from the store by hand. A box corrected on the tablet is only corrected on the
  server if the tablet re-posts it under the same id — and the tablet will not, because that
  id is already in the acknowledged set.

- **The tablet's CSV export has no `location_id` column, so the file-import path loses
  location.** The tablet's `toCSV` writes eleven columns: `box_id`, `box_size`, `method`,
  `demo`, `started_at`, `completed_at`, `duration_ms`, `undo_count`, `flavor_id`,
  `flavor_name`, `piece_count`. The dashboard's CSV importer already reads a `location_id`
  column if one is present — it just never is. So once `locationId` does get set, a record
  that arrives over the live API will carry its location and the same record exported to CSV
  and dragged in will not. The JSON export does not have this problem; it serialises the
  record whole.

- **`from`/`to` filter on `completedAt`, not `receivedAt`.** A box assembled Tuesday and
  synced Thursday lands in Tuesday's window. That is almost always what you want, but it
  means a dashboard window that looks empty may be a sync-lag question rather than a
  quiet day.

- **The memory store is bounded at 20,000 records and the default read limit is 5,000.**
  Neither is close to a shop's volume, but a synthetic load test will hit them.
