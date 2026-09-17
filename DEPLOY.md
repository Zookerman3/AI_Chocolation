# Deploy

**Current state (Sep 17):** both projects are live, deployed with the Vercel CLI from Ange1G's
Vercel account (`angelgonzalez0316-8491`), not through a GitHub import — Vercel's GitHub app
isn't installed on Zookerman3, so the import in step 1 fails with "you have access to the
repository if it's private". Until that's done, redeploy by hand from a synced checkout:

```bash
vercel --prod          # in AI_Chocolation → https://ai-chocolation.vercel.app
vercel --prod          # in Chocolate_Dashboard → https://case-notes-delta.vercel.app
```

Two things the first deploy taught us, both already in the repo:

- Files under `api/` must import each other with `.js` specifiers, not `.ts`. Vercel compiles the
  functions with plain `tsc`, which keeps the specifier as written; with `.ts` every route fails with
  `FUNCTION_INVOCATION_FAILED`. The type-only warnings it prints (`process` not found, `why`
  narrowing) are harmless — it doesn't read `tsconfig.api.json`.
- `.vercelignore` keeps `api/**/*.test.ts` and `api/_lib/testing.ts` out of the upload; otherwise
  Vercel deploys the test files as `/api/api.test` and `/api/e2e.test` endpoints.

Two Vercel projects, one repo each.

| Project | Repo | What it serves |
|---|---|---|
| **AI_Chocolation** | `Zookerman3/AI_Chocolation` | The counter tablet PWA **and** the API (`api/boxes.ts`, `api/health.ts`) as serverless functions on the same origin. |
| **case-notes** | the dashboard repo | The admin dashboard only. It reads the API cross-origin. |

The API lives inside the tablet project on purpose: the tablet then posts to its own
origin at `/api/boxes` with zero configuration, and there is no third thing to deploy.

Steps 1 and 3 are the minimum for a working demo. Step 2 is what makes it survive the
night. Step 4 is optional and has a real caveat — read it before you turn it on.

---

## 1. Deploy the tablet app and the API

1. Vercel → **Add New → Project** → import `Zookerman3/AI_Chocolation`.
2. **Framework Preset:** Vite. **Root Directory:** repo root.
3. Leave the build settings as detected: Build Command `npm run build`, Output Directory
   `dist`, Install Command `npm install`. Vercel picks up `api/*.ts` as Node serverless
   functions on its own — there is no `vercel.json` and you do not need one.
4. **Node.js Version:** 22.x (Project Settings → General). The handlers import each other
   with explicit `.ts` extensions, which needs a current Node runtime.
5. Set no environment variables yet. The API is designed to answer correctly on the very
   first deploy with nothing configured.
6. Deploy. Note the production URL — everything below calls it `$API`.

Then verify from your laptop. Set the URL once:

```bash
API=https://ai-chocolation.vercel.app
```

**Health.** This should answer 200 and tell you the truth about storage:

```bash
curl -s "$API/api/health"
```

Expect `"ok": true`, `"store": "memory"`, `"durable": false`, `"writesProtected": false`,
and a `note` saying boxes are held in memory and lost when the instance restarts. That is
the correct answer at this point, not a failure.

**Write one box.** The piece counts must add up to `size` or the API will refuse it —
that rule is the same one the tablet enforces before it lets a cashier save:

```bash
curl -s -X POST "$API/api/boxes" \
  -H 'content-type: application/json' \
  -d '{"records":[{
        "id":"smoke-1",
        "size":6,
        "pieces":[{"flavorId":"amaretto","count":4},{"flavorId":"lemon","count":2}],
        "startedAt":"2026-09-16T17:00:00.000Z",
        "completedAt":"2026-09-16T17:00:30.000Z",
        "durationMs":30000,
        "undoCount":0,
        "method":"tap",
        "demo":false
      }]}'
```

Expect 200 and `{"accepted":["smoke-1"],"acceptedCount":1,"rejected":[], ...}`. The
`accepted` list is the acknowledgement the tablet's outbox keys off — an id that does not
come back stays queued.

Run the same command twice. The count does not go up: writes are idempotent on record id.

**Read it back.**

```bash
curl -s "$API/api/boxes?limit=5"
```

Expect `{"records":[…],"count":1,"store":"memory","durable":false,"generatedAt":"…"}`,
and the record carries a `receivedAt` the server stamped.

If all three answer, the API is live and the tablet needs no further configuration.

---

## 2. Add durable storage

Until you do this, every cold start of the serverless instance empties the store. A demo
that silently forgets is worse than one that admits it will, which is why `/api/health`
says so — but you still want this done before judging.

1. Vercel dashboard → the **AI_Chocolation** project → **Storage** → **Create Database**
   → the Upstash Redis / KV option from the marketplace integrations.
2. Connect it to the **AI_Chocolation** project, Production (and Preview, if you want
   preview deploys to persist too).
3. The integration injects `KV_REST_API_URL` and `KV_REST_API_TOKEN` into the project's
   environment. You do not copy or paste anything.
4. **Redeploy.** Environment variables are picked up at deploy time; an existing deployment
   will keep using the memory store until you redeploy it.

Confirm the flip:

```bash
curl -s "$API/api/health"
```

Expect `"store": "redis"`, `"durable": true`, and the note now reading `Boxes are stored
durably.` The `count` will read 0 — the memory store's contents are not migrated. Re-post
the smoke-test box if you want something in there.

If you provisioned Upstash directly rather than through Vercel's integration, the API also
accepts `UPSTASH_REDIS_REST_URL` and `UPSTASH_REDIS_REST_TOKEN`. Either pair works; the
`KV_*` names win if both are present.

---

## 3. Deploy the dashboard

1. Vercel → **Add New → Project** → import the **case-notes** repo as a **separate project**.
2. **Framework Preset:** Vite. Build settings as detected.
3. **Environment Variables** → add:

   | Key | Value |
   |---|---|
   | `VITE_API_BASE` | `https://ai-chocolation.vercel.app` — the tablet deployment's origin, no trailing slash, no `/api` |

   The dashboard appends `/api/boxes` itself. A trailing slash or an included `/api` gives
   you a 404 on a URL with a doubled path.
4. Deploy.

`VITE_API_BASE` is compiled into the bundle at build time. Changing it later means a
**redeploy**, not just a settings save.

Without it the dashboard still opens and every screen still works — sample data and
drag-and-drop of the tablet's `boxes.json` / `boxes.csv` — but the live option is hidden
rather than offered as a button that cannot work.

Verify: open the dashboard, switch to the live source, and you should see the smoke-test
box from step 1.

---

## 4. Optional: protect writes

Reads stay public. That is deliberate and not negotiable: the rubric's first gate is that
the link opens with no login and no install, and a dashboard behind auth fails it.

Writes are open until `SYNC_TOKEN` is set. To turn the gate on:

1. **AI_Chocolation** project → Environment Variables → add `SYNC_TOKEN` = some long random
   string.
2. Same project → add `VITE_SYNC_TOKEN` = **the same string**. This is what the tablet
   bundle sends as the `x-sync-token` header.
3. Redeploy the tablet project. Both variables are read at deploy/build time.

Check it took:

```bash
curl -s "$API/api/health"          # "writesProtected": true
curl -s -X POST "$API/api/boxes" -H 'content-type: application/json' -d '{}'
# 401: "This API requires an x-sync-token header."
```

**The caveat, stated plainly.** `VITE_*` variables are compiled into the browser bundle.
`VITE_SYNC_TOKEN` is therefore visible to anyone who opens devtools on the tablet app and
reads the JavaScript. It deters a casual write from someone who found the endpoint; it is
not a secret and must not be treated as one. If you set `SYNC_TOKEN` and forget
`VITE_SYNC_TOKEN`, every tablet sync fails with a 401 and boxes pile up in the outbox —
the tablet keeps working, but nothing reaches the office.

---

## 5. End-to-end verification checklist

Do this once on the real deployment before you hand the links to anyone.

- [ ] `curl -s "$API/api/health"` returns `"ok": true` and `"durable": true`.
- [ ] The tablet URL opens on a phone or tablet with no login and no install prompt.
- [ ] On the tablet: save a real box (demo mode **off** — demo records never sync).
- [ ] The header's sync chip settles on "Synced", not "N boxes waiting" or "Sync failed".
- [ ] `curl -s "$API/api/boxes?limit=5"` shows that box, with a `receivedAt` on it.
- [ ] The dashboard, in live mode, shows the same box on the Boxes screen.
- [ ] Turn the tablet's wifi off, save another box. It saves instantly and the chip reads
      "Offline · boxes saved here". Turn wifi back on: the chip syncs within a moment
      (the `online` event) — you should not have to wait out the 60-second retry.
- [ ] That second box now appears in the dashboard too.
- [ ] Reload the dashboard. The box is still there (this is what proves durable storage,
      not the health endpoint's self-report).

---

## 6. Troubleshooting

| Symptom | Cause | Fix |
|---|---|---|
| Dashboard console: CORS / "blocked by CORS policy" | Almost never the API — it sends `Access-Control-Allow-Origin: *` on every response including errors. It is usually `VITE_API_BASE` pointing at a URL that 404s, so the browser reports the failure as CORS. | Check `VITE_API_BASE` has no trailing slash and no `/api`. Confirm `curl "$VITE_API_BASE/api/health"` answers 200 from your laptop. |
| `/api/health` says `"durable": false` | No `KV_REST_API_URL`/`KV_REST_API_TOKEN` in this project's environment, or they were added after the current deployment was built. | Step 2. If the integration is already connected, **redeploy** — env vars are read at deploy time. Check the variables are scoped to Production, not only Preview. |
| Tablet sync chip reads "Sync failed"; POSTs return 401 | `SYNC_TOKEN` is set on the project but `VITE_SYNC_TOKEN` is unset or does not match. | Set both to the same value and redeploy the tablet project. Nothing is lost meanwhile: the boxes stay in the outbox and go up on the next successful pass. |
| Dashboard live mode is empty but the API has records | Either the date filter window excludes them (`completedAt` is what `from`/`to` filter on, not `receivedAt`), or a location filter is set and the records carry no `locationId`. | Widen the window; set location to "all". Compare against raw `curl "$API/api/boxes?limit=5"`. |
| Dashboard live mode is empty and the API is empty | The tablet posted demo records — those never sync — or the store went through a cold start while `durable: false`. | Save a box with demo mode off. Check `/api/health` for `durable`. |
| Tablet shows an old build after a deploy | The service worker precached the previous build (`vite-plugin-pwa`). | On the tablet: close every tab of the app and reopen, or pull-to-refresh twice. If it persists: Settings → site settings → clear site data for that origin, then reload. **Note this wipes localStorage**, which means the acknowledged-ids set goes too, so the tablet re-sends everything it still holds. That is harmless — writes are idempotent on record id — but the chip will show a queue for one pass. |
| `curl` POST returns 422 with a `rejected` list | A record failed validation. The `why` on each entry names the reason. | Read it. The common one is piece counts not summing to `size`. |
| `curl` POST returns 413 | More than 500 records in one batch. | The tablet never does this (it batches 100). Split the request. |

---

## Environment variable reference

| Name | Project | Required | Without it |
|---|---|---|---|
| `KV_REST_API_URL` | AI_Chocolation | No, but effectively yes for judging | Falls back to the in-memory store: correct behaviour, lost on cold start. `/api/health` reports `durable: false`. |
| `KV_REST_API_TOKEN` | AI_Chocolation | Pairs with the above | Same. Both must be present or neither counts. |
| `UPSTASH_REDIS_REST_URL` | AI_Chocolation | No — alternative to `KV_REST_API_URL` | Only matters if you provisioned Upstash outside Vercel's integration. |
| `UPSTASH_REDIS_REST_TOKEN` | AI_Chocolation | Pairs with the above | Same. |
| `SYNC_TOKEN` | AI_Chocolation (server) | No | `POST /api/boxes` is open to anyone who finds it. Reads are public either way, by design. |
| `VITE_SYNC_TOKEN` | AI_Chocolation (build-time, in the bundle) | Only when `SYNC_TOKEN` is set | Tablet POSTs get 401 and boxes queue forever. Visible in the browser bundle — see step 4. |
| `VITE_SYNC_URL` | AI_Chocolation (build-time) | No | Defaults to `/api/boxes` on the tablet's own origin, which is what you want on Vercel. Only set it to point a tablet at a different deployment. The health URL is derived from it. |
| `VITE_API_BASE` | case-notes (build-time) | Yes, for live mode | Dashboard runs on sample data and dropped-in exports only; the live option is hidden rather than shown broken. |
| `VITE_API_TARGET` | case-notes (local dev only) | No | The dev proxy for `/api` targets `http://localhost:8787`. Not used in a Vercel build. |
| `VITE_ROBOFLOW_API_KEY` | AI_Chocolation | No | Camera assist uses the on-device gallery matcher. Unrelated to sync; listed so nobody sets it thinking it is required. |
| `VITE_ROBOFLOW_MODEL_ID` | AI_Chocolation | No | Same. |

Anything prefixed `VITE_` is compiled into a browser bundle at build time. It is not a
secret and changing it requires a redeploy. Anything without that prefix is read by the
serverless function at runtime from the project's environment.
