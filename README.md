# AI Chocolation

Our Build Track entry for the **Chocolathon** (WSU AI Club × Cocoa Dolce × Lovable), Sep 14–19, 2026.

> **What it does:** A tablet screen for the counter — the cashier taps the chocolate a customer
> just picked, once per piece, until the count matches the box size, then saves one exportable
> record per box (CSV/JSON), with the assembly time measured automatically. Or, for a full box,
> taps **Use camera**: a photo of the open box is read slot by slot on the tablet itself (no server,
> no API key), the pieces it's sure of are added, and the rest come back as one-tap confirms.
>
> **Live link:** https://ai-chocolation.vercel.app (tablet + box API) · office dashboard:
> https://case-notes-delta.vercel.app · **What to click first:** Pick a box size, tap the tiles (or,
> with a real 16 or 30 box, get it roughly inside the camera outline and tap Capture), then Save —
> Records and Stats fill from what has been saved, and the office dashboard reads the same boxes
> live. There is no sample data anywhere, so save a few boxes before showing it. On a real counter,
> set **This tablet is at** in the footer first so every box carries its shop.

Stack: React 19 + Vite + TypeScript, Vitest, ESLint; `onnxruntime-web` runs the camera's recogniser
in WebAssembly on the device. There is no CI: `npm run check` on your own laptop is the gate before
anything merges.

---

## Team setup

You need **Node 24 LTS** (20.19+ also works), **Git**, the **GitHub CLI** signed in (`gh auth login`), and
**Claude Code for the terminal** signed in with your Pro/Max account.

```bash
git clone https://github.com/Zookerman3/AI_Chocolation.git
cd AI_Chocolation
npm install
npm run check
```

`npm run check` should end with a successful build. If it fails on Vite or Rolldown,
your Node is too old: `node -v` must be 20.19 or newer.

## Daily workflow

| When | Do this |
|---|---|
| Starting work | `/sync` in Claude Code (or `git pull` on main) |
| Change is ready | `/ship`: check → commit → push → PR → merge |
| Have an idea for an agent | `/task <idea> for @username` creates a scoped issue |
| Bedtime | `npm run overnight`, laptop plugged in, lid open |
| Morning (15 min) | `gh pr list` and `gh issue list --label agent-failed` |

Rules for humans and agents live in [CLAUDE.md](CLAUDE.md). Read the "Team workflow" and
"Who owns which area" sections.

## Overnight agents

`npm run overnight` works through open issues that are labeled **`agent-ready`** and
**assigned to you**, oldest first. For each one it:

1. creates a separate worktree from the latest `main`, in the `AI_Chocolation-worktrees` folder
   next to this repo, so your own files are untouched
2. runs Claude Code headless on the issue (`claude -p`, edits auto-accepted, no pushing allowed)
3. rebases on `main`, runs `npm run check`, pushes the branch, and opens a PR
4. **check passed:** the PR is merged right away and the issue closes. If the merge fails, it's labeled `agent-pr-open`
5. **check failed or conflict:** a draft PR plus the `agent-failed` label and a comment for a human

It stops when your queue is empty or your Claude usage limit is hit. Then the unfinished issue
goes back to `agent-ready`. Logs are in `.agent-logs/` (git-ignored). Press Ctrl+C at any time;
the current issue is put back in the queue.

Options: `MAX_TURNS=80 MAX_TASKS=5 npm run overnight`

Issue labels: `agent-ready` → `agent-running` → `agent-pr-open` or `agent-failed`.
Create them once with `npm run labels`.

**Writing good agent tasks:** use `/task` or the "Agent task" issue template. One area of the
code, about an hour of work, checkable acceptance criteria. Vague issues fail.

## Camera assist: how it works and how to rebuild it

`src/features/camera/` reads a photo of the open box slot by slot. In order: `gridFinder.ts` finds
the insert's real grid near the on-screen outline (the chocolates are the landmarks; off-centre,
turned, smaller, larger and tilted all work); `localDetector.ts` cuts every slot out through that
fit and refuses a frame that's blurred all over; each crop is described by `features.ts` (a
392-number colour/texture fingerprint) and `embed.ts` (a 1280-number embedding from a pretrained
MobileNetV2, ONNX model zoo, int8, 2.5 MB, run by `onnxruntime-web`); `fused.ts` joins the two
0.7/0.3; `gallery.ts` matches the result by nearest neighbour against every labelled training crop
in `public/models/gallery-fused.{json,bin}`; `applyDetections.ts` auto-adds a slot whose winning
vote share is ≥ 0.8 and sends the rest to the cashier. `recognizer.ts` loads the network and the
gallery once, with a progress veil, and falls back to the colour-only `gallery-color` if the network
can't load. Measured numbers are in "Known limits" below; the full story, including what was tried
and dropped, is in [docs/camera-assist-handoff.md](docs/camera-assist-handoff.md).

To add photos or flavors and rebuild (Node 22.18+, Python 3 with `opencv-python-headless pillow
pillow-heif numpy`):

1. Photograph a mixed box from roughly above, several shots per session, and write one label file per
   session: `Photos/Training_Set_N/training_label_N`, one line per slot, `row.col Flavor Name`;
   unlisted slots are empty.
2. `python3 scripts/crop_cells.py path/to/Photos --out dataset --qa qa` — one crop per slot, named
   `<session>_<photo>_r<row>c<col>.jpg`; look at the contact sheets in `qa/` before trusting them.
3. `node scripts/build-gallery.ts dataset` — prints leave-one-session-out accuracy (each session
   scored against the others, so no photo is ever scored against its own shoot) and writes both
   galleries. Both must be rebuilt whenever `features.ts`, `embed.ts`, `fused.ts` or the model file
   changes; the version strings in those files are baked into the galleries so a stale one is refused
   at load.

## Repo settings (owner, one time)

- Settings → Collaborators: add teammates (write access)
- Settings → General → Pull Requests: allow squash merging, automatically delete head branches
- `main` is not protected. That needs GitHub Pro on a private repo. Nothing stops a direct push, so follow CLAUDE.md.
- Vercel: both projects (`ai-chocolation`, `case-notes`) are deployed from Ange1G's Vercel account
  with the CLI (`vercel --prod` in each repo folder), so a push does **not** redeploy on its own —
  see DEPLOY.md. Importing the repos in Vercel's dashboard (owner-only, needs the GitHub app on
  Zookerman3) would add PR preview links and auto-deploys of `main`.

## Known limits

Keep this honest and current. The judges score it.

- **On a phone-width screen the per-flavor tally sits below the grid.** Under 900px the layout is
  one column: the running count is pinned to the top of the screen and the action bar (Use camera,
  Undo, Cancel, Save) to the bottom, so both are always in view — but the "Your box" list with its
  per-flavor +/− corrections comes after the grid, so fixing one specific flavor means a scroll.
  At tablet-landscape width the tally is a side column and none of this applies.

- **Case layout isn't the real one yet.** We have no way to know Cocoa Dolce's actual physical
  display case without asking their staff, which the rules don't allow. The tile grid ships with a
  reasonable default order; a cashier taps "Rearrange case" once to match their counter, and it's
  saved on that device from then on. A "Reset to default" button is there in case a rearrange goes
  wrong.
- **Camera assist is on-device, measured, and honest about its edges.** No API and nothing trained
  by us: each slot of the insert is cropped from a photo the cashier lines up with an on-screen
  outline and described two ways — a 392-number colour/texture fingerprint
  (`src/features/camera/features.ts`) and a 1280-number embedding from a pretrained MobileNetV2
  (`embed.ts`: ONNX model zoo, ImageNet weights, int8, 2.5 MB, run in the browser by `onnxruntime-web`
  in WebAssembly). Fused 0.7/0.3 (`fused.ts`), the crop is matched by nearest neighbour against a
  gallery of our own labelled crops (`public/models/`, 1,920 crops from 64 photos of a mixed 30-slot
  box across four sessions). Measured with each session held out in turn and scored against the other
  three (`node scripts/build-gallery.ts` prints it): **99.2% top-1, 99.9% top-3** (colour alone: 92.2 /
  96.8). The whole flow was also run in a real browser on three held-out photos: 27 of 27 pieces
  right on each, no wrong auto-fills, no confirm taps, about 2.5 s from photo to result.
  Then we broke it on purpose. 18 held-out frames, 27 conditions, through the shipped code path
  (top-1 on occupied slots; "wrong auto" is a wrong piece added without asking, the failure that costs
  the shop):

  | Condition | Colour only (before) | Colour + network (now) |
  |---|---|---|
  | as shot | 94%, 9 wrong auto | 100%, 1 wrong auto |
  | dim (×0.6) / very dim (×0.4) | 37% / 14% | 98% / 90% |
  | bright (×1.4) / blown out (×1.8) | 78% / 54% | 100% / 93% |
  | warm / cool white balance | 58% / 55% | 97% / 99% |
  | low contrast, glare on every piece, JPEG quality 35 | 25% / 80% / 94% | 98% / 99% / 100% |
  | sensor noise σ 10 / 20 / 35 | 94% / 83% / 64% | 99% / 95% / 89% |
  | pieces turned 90° / 180° in their slots | 94% / 91% | 100% / 99% |
  | a finger across one row | 74% | 87% |
  | slight blur (3 px) | 91% | 97% |
  | real blur (6 px / 10 px) | 86% / 75% | 79% / 52% — **refused instead** |

  And where the box is. The outline on screen is a guide: `gridFinder.ts` looks for the insert's
  actual lattice near it (the chocolates are the landmarks, fitted with a homography, ~60 ms) and
  reads the cells through that, so the box can be off-centre, turned, closer, farther or tilted. It
  found the grid on 18 of 18 frames in every row below:

  | Where the box is | Fixed cells, colour only | Fixed cells, + network | **Grid-finder, + network (shipped)** |
  |---|---|---|---|
  | on the outline | 94% | 100% | 100% |
  | a fifth / a third of a cell off | 29% / 4% | 98% / 65% | 99% / 99% |
  | 10% too big / too small for the outline | 44% / 35% | 95% / 98% | 99% / 99% |
  | turned 7° / 12° | 36% / 7% | 97% / 54% | 100% / 99% |
  | tilted 15° / 30° / 45°, 30° + 20° twist | — | — | 99% / 100% / 99% / 100% |

  In a real browser: the box at 70% of the outline turned 6°, a third of a cell off turned 10°, at
  45° tilt, and at 30° tilt with a twist — 27 of 27 pieces right on each, 0 wrong, 0 taps, ~3.7 s.
  The tilt rows are synthetic (a straight-down photo warped as a tilted camera would see it), which
  proves the geometry, not the look of a piece's side; real angled photos are the open check.

  Blur is the one thing the network is *worse* at than colour, and it fails confidently, so the
  detector measures sharpness first and refuses a soft frame with "hold still and capture again"
  (`localDetector.ts`, threshold set in the gap between the 3 px and 6 px rows). If the network fails
  to load — no WebAssembly, a broken download — the screen says "basic colour matching" and runs the
  colour gallery instead, with the numbers in the left column. Where it is weakest even now: the
  copper-splatter browns (Manhattan, Espresso Martini, Amaretto, Champagne, Turtle) under a strong
  colour cast or heavy noise, which is what the "please confirm" step is for. The gallery holds one
  physical piece per flavor, photographed 64 times; a second box of each would tighten it further.
  Roboflow remains an opt-in override (`.env.example`) if a hosted detector ever beats this.
- **The camera needs enough pieces in the box to find the grid, and a real-angle check.** The
  grid-finder needs about a third of the slots filled (8 pieces in a 30, 5 in a 16, 4 in a 6 or 10)
  to lock on; below that it falls back to reading the outline as drawn, which is when "roughly lined
  up" matters again. The angled-camera numbers above are synthetic; a piece photographed from 45°
  shows its side and the divider wall starts hiding it, and that is what still needs six real photos
  to confirm, and maybe one angled shoot to add to the gallery if it doesn't hold. Only inserts we've
  measured are supported: 4×4 (16) and 5×6 (30); 6 and 10 are assumed 2×3 / 2×5 and need checking
  against real boxes; the 50-piece box is no longer offered on the tablet at all (taken off the size
  picker on Sep 18, since it has no measured insert). Where the live preview isn't available (an `http://` dev
  server on a phone, or a denied permission) it falls back to the OS camera and the same grid-finder
  reads the photo. First open downloads about 20 MB (the WebAssembly runtime is 14 MB of it, 3.7 MB
  compressed); after that everything is cached offline.
- **The device is the source of truth; the server is a copy.** Records live in the browser's
  localStorage, per device, with no login. Each saved box is also posted to `/api/boxes` on the same
  origin (queued when offline, retried on reconnect), which is what the office dashboard reads.
  Clearing site data on a tablet loses whatever hadn't synced yet.
- **The server copy lives in one free-tier Redis.** The API stores boxes in Upstash Redis, connected
  through Angel's Vercel account (`/api/health` reports `store: redis, durable: true`). Free tier is
  plenty for a shop's volume, but there is no backup and no delete endpoint: removing a bad record
  means an `HDEL` against the database (DEPLOY.md). If the Vercel env vars are ever missing at
  deploy time the API silently falls back to memory — `/api/health` and the dashboard's state chip
  say so, which is the thing to check before a demo.
- **The in-app timer isn't the full "measured, not guessed" story.** It correctly measures real
  elapsed time per box in the app, but the seconds-per-box number for the submission comes from
  timing real people assembling real boxes by hand (planned for Thursday), not just this timer.
- **Deploys are manual.** The live link is updated by someone running `vercel --prod` from a synced
  checkout, not by merging to `main`. If `main` moves and nobody redeploys, the link is stale.
- **Offline works after the first load, not before it.** The app is installable (Add to Home Screen)
  and precaches itself plus every flavor photo a device has viewed, via a service worker
  (`vite-plugin-pwa`). That covers the real risk — event wifi dropping mid-shift — but a device that
  has never opened the link once still needs that first connection.

### Where this breaks, named against the four scenarios the prompt calls out

- **A rush at the counter.** One tap per piece, no confirm dialogs, so it doesn't slow anyone down —
  but that also means there's no friction to catch a mistake in the moment. The backstops: Save stays
  disabled until the count exactly matches the box size (and the count is large and always visible),
  and a live per-flavor tally sits beside the grid (below it on a narrow screen, with the running
  count pinned at the top) so a wrong count is visible before the box is called done, not just at the
  very end.
- **A mis-tap.** Fixed: each row in the running tally has its own +/− buttons, so a cashier can correct
  one specific flavor without touching the rest of the box or replaying every tap after it. Sequential
  "Undo" (last tap only) is still there too, for the common case of catching a mistake immediately.
- **Look-alike pieces.** This is a tap-UI limit, not just a camera one: several flavors are genuinely
  hard to tell apart even from the reference photo on each tile, e.g. the brown-with-copper-splatter
  group (Manhattan, Espresso Martini, S'Mores, Peanut Butter Caramel, Amaretto, Champagne, Crème
  Brûlée, Turtle) all look similar at tile size. If a cashier misidentifies one by eye, they'll
  correctly tap the tile for what they *think* it is, and the app has no way to catch that — it only
  catches a mismatched *count*, not a mismatched *flavor*. The new allergen badges and search box help
  a cashier double-check a specific flavor by name rather than relying on the photo alone, but don't
  eliminate this.
- **A large box.** The picker goes up to 30 pieces (tested); the 50-piece box was taken off it on
  Sep 18 (no measured insert, so no camera path), though a saved 50-piece record is still valid data.
  The running tally's `+` button lets a cashier add repeats of a flavor already in the box without
  re-finding its tile in the grid, which cuts down the search-and-tap cost for a big box — but it's
  still one count per tap, so a 30-piece box is meaningfully slower than a 6-piece one, and each tap
  is still a chance to mis-tap. Exactly why the 30-piece box needs its own real timing pass on
  Thursday, not just the 6-piece one.
- The overnight runner detects the Claude usage limit by matching the error text. If Claude changes
  that message, the runner will mark the issue `agent-failed` instead of requeueing it.
- There is no CI and `main` is unprotected. If someone merges without running `npm run check`, `main` can
  break. Run `/sync` and check before starting work.
- Two agents editing the same files will conflict. Area ownership in `CLAUDE.md` is what prevents
  that, not the tooling.
