# AI Chocolation

Our Build Track entry for the Chocolathon (WSU AI Club × Cocoa Dolce × Lovable).
Five teammates, each running Claude Code, all pushing to this repo, with agents
working overnight on every laptop. These rules keep that from turning into chaos.

## The prompt: B-1 "Chocolate Vision — Know Every Piece in Every Box"

Source: https://www.wsuaiclub.com/hq#prompts (Build track, released Sep 13 2026, 9:30 PM CDT).

> **Problem.** At the chocolate bar in every Cocoa Dolce shop, the customer picks their pieces and
> the cashier assembles the box by hand. Nobody records which chocolates went in. The sale is
> logged; what was in the box is not.
>
> **Challenge.** Build a fast, simple way to capture what goes into each box as it is sold. It has
> to fit a busy counter: a few seconds per box, nothing extra asked of the customer, and no slower
> line. Tap-to-add, scan, photo, voice, or something else. No training data is provided. A simple
> method that works beats a clever one that does not.
>
> **Winning entry includes:**
> - A working capture flow, demoed on a realistic box from the first piece to the saved record
> - How many seconds it adds per box at the counter, **measured rather than guessed**
> - One record per box (which pieces, how many) that the shop can export as CSV or JSON
> - Honest notes on where it breaks: a rush at the counter, a mis-tap, look-alike pieces, a large box
>
> **Stretch goal.** A view across many boxes: the most-picked pieces and the combinations customers
> keep coming back to.

**Our user** is the cashier at the chocolate bar, on a tablet next to the display case. The
**record's user** is whoever at Cocoa Dolce plans production and flavors.

## What we're building

**Phase 1 (Mon–Wed): tablet case layout. This is the entry.**
A tablet screen whose flavor tiles are arranged exactly like the physical display case, so the
cashier taps where they just grabbed. Pick box size → tap a tile per piece → count shows `7 / 16` →
undo → save only when the count matches → one record per box → CSV/JSON export → timer on every box.
Plus a demo mode with sample boxes (judges open the link without chocolates) and a stats view.

**Phase 2 (Wed–Fri): camera assist — checkpoint passed, on-device, robust.**
Per-cell crop and match: the cashier gets the open box roughly inside an outline on screen;
`gridFinder.ts` finds the insert's real lattice near it (the chocolates are the landmarks, fitted
with a homography, so off-centre, turned, smaller, larger and tilted all work — it needs about a
third of the slots filled, else it reads the outline as drawn), the app cuts each slot out through
that fit and describes it two ways: a colour/texture fingerprint (`src/features/camera/features.ts`)
and a 1280-number embedding from a pretrained MobileNetV2 (`embed.ts`; ONNX model zoo, ImageNet
weights, nothing trained by us, 2.5 MB int8, run on the tablet by `onnxruntime-web` in WebAssembly).
The two are fused 0.7/0.3 (`fused.ts`) and matched by nearest neighbour against a gallery of our
own labelled crops (`public/models/gallery-fused.{json,bin}`, 3.1 MB, built by
`node scripts/build-gallery.ts` from the crops `scripts/crop_cells.py` cuts out of the Photos folder). A cell whose winning vote share is
≥ 0.8 auto-adds; anything under that, or an unsure "empty", goes to the cashier for a one-tap
confirm or fix, with a thumbnail of what the camera saw. A frame that is blurred all over is refused
with "hold still" rather than guessed at. If the network can't load, `recognizer.ts` falls back to the
colour-only gallery (`gallery-color`, 735 KB) and the screen says so.
Measured with each photo session held out in turn: **99.2% top-1 / 99.9% top-3** fused (colour alone
92.2 / 96.8; checkpoint was 80 / 95). Both galleries must be rebuilt whenever `features.ts`,
`embed.ts`, `fused.ts` or the model file changes — the version strings in those files are baked into
the galleries so a stale one is refused at load. `roboflowDetector.ts` stays as an opt-in override via
`.env.example`.

**Checkpoint: Wednesday night — cleared.** Held-out top-1 99.2%, top-3 99.9% (`scripts/build-gallery.ts`
prints the current figures, for the colour-only fallback too). What's left is real-counter timing.

**Thursday:** time 10+ real boxes per method (seconds per box, corrections). Those numbers go in the video.

### The design rule: every input feeds the same box

All input methods call the same box-session functions in `src/features/box/`. A tile tap adds a piece
with `source: 'tap'`; the camera adds pieces with `source: 'camera'` and a `confidence`. The count
check, save, records, export and stats never care where a piece came from.
Shared types live in [src/domain/types.ts](src/domain/types.ts). Change them only in a PR that says why.

### Facts to respect

- 27 bonbon flavors at $3.35 each, some seasonal (25 in the public feed plus Orange and Strawberry, sold in-store only — see `src/data/flavors.local.json`). Box sizes: 6, 10, 16, 30, 50 pieces.
  Box price depends only on size, never on flavor.
- The store's product data has **mislabeled handles**: `amaretto-copy` is Confetti Cake and
  `confetti-cake-copy` is Tea & Honey. Always identify flavors by product **title**, never by handle.
- Look-alike groups (camera risk): brown with copper splatter (Manhattan, Espresso Martini, S'Mores,
  Peanut Butter Caramel, Amaretto, Champagne, Crème Brûlée, Turtle); blues (Cookies & Cream,
  Cheesecake, Confetti Cake); reds (Raspberry, Strawberry Shortcake); purples (Brownie Batter, Salted Caramel).
- The 16-piece box uses a black plastic 4×4 insert with pieces in fixed slots.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run check` | Lint, typecheck, tests, build. **Must pass before any merge.** There is no CI, so this is the only gate. |
| `npm run test:watch` | Tests in watch mode |
| `npm run overnight` | Overnight runner (see README) |
| `npm run labels` | One-time: creates the agent labels on GitHub |

Slash commands in `.claude/commands/`:
- `/ship`: check, commit, push, open a PR, merge it
- `/sync`: pull the latest `main` into your branch and re-run check
- `/task <idea>`: turn an idea into a well-scoped GitHub issue for an overnight agent

## Team workflow

- **Never commit directly to `main`.** Every change goes through a PR, merged only after `npm run check`
  passes locally. Nothing on GitHub enforces this, so it's on each of us.
- Branch names: `<github-username>/<short-slug>` for people, `agent/<github-username>/<issue#>` for the overnight runner.
- One PR = one issue or one idea. Small PRs merge fast and rarely conflict.
- Pull often (`/sync`). Five people plus agents move `main` quickly.
- Never make `npm run check` pass by deleting tests, weakening types, or disabling lint rules.
  Fix the cause, or say in the PR why it can't be fixed yet.

## Team (GitHub usernames)

Use these for `/task` assignees and branch names.

- `Zookerman3` (repo owner)
- `A1gUs3`
- `mathib2`
- `Ange1G`
- _fifth teammate TBD_

## Who owns which area

Parallel agents must not edit the same files. Fill in owners at the team meeting,
then only change files in your own area unless the issue says otherwise.

| Area (folder) | What lives there | Owner |
|---|---|---|
| `src/app/` | App shell, navigation, demo mode | A1gUs3 |
| `src/data/` + `scripts/fetch-flavors.mjs` | Flavor catalog from the public store feed | A1gUs3 |
| `src/features/box/` | Box session logic and the box screen | A1gUs3 |
| `src/features/layout/` | Flavor tile grid and case layout editor | A1gUs3 |
| `src/features/records/` | Saved box records, CSV/JSON export, records screen | A1gUs3 |
| `src/features/stats/` | Most-picked flavors and combinations (stretch) | A1gUs3 |
| `src/features/camera/` | Phase 2 camera assist | A1gUs3 |
| `src/features/sync/` | Outbox that posts saved boxes to the API, sync chip, location picker | Zookerman3 |
| `api/` | The box API (`/api/boxes`, `/api/health`), deployed with the app as Vercel functions | Zookerman3 |
| `DEPLOY.md`, `.vercelignore`, `vercel.json` | Deploying both apps; Ange1G runs the deploys | Ange1G |
| `src/domain/` | Shared types. Changes need a PR that explains why | everyone, carefully |

Shared files (`package.json`, `src/App.tsx`, `CLAUDE.md`, `src/domain/types.ts`) are edited by
humans, or by agents only when the issue explicitly names them.

Data is stored on the device (localStorage); that copy is the source of truth. Each saved box is
also posted to `/api/boxes` (Vercel serverless functions in `api/`, same origin), which the office
dashboard (Chocolate_Dashboard) reads. Live: https://ai-chocolation.vercel.app and
https://case-notes-delta.vercel.app — the store is Upstash Redis (durable); see DEPLOY.md for
how to redeploy and how to remove a record.

## Code conventions

- TypeScript strict. React function components. No `any` without a comment saying why.
- Tests sit next to the code: `Thing.tsx` → `Thing.test.tsx` (Vitest + Testing Library).
- Add a dependency only when it earns its place, and say why in the PR.
- No secrets in the repo. If something needs a key, add it to `.env.example` with a placeholder.
- Use only public Cocoa Dolce information, and note the source in a comment or in `src/data/`.

## Writing for the judges

The first-round Build rubric scores four lines, 1 to 10 each:
1. **It runs** end to end on the live link, with no login or install. This line is also the first tiebreaker.
2. **They could operate it:** Cocoa Dolce staff could use it Monday without us there.
3. **It answers the prompt**, built for how they actually work.
4. **Honest about limits:** say where it breaks, and the fix.

So: every PR has a **Known limits** section. Keep the README's Known limits list up to date.
Prefer a small thing that works end to end over a big thing that half works.

## Competition rules that affect code

- All work started after the prompts unlocked (9:30 PM CDT, Sep 13 2026). Don't copy in code or files
  from older projects or pre-unlock research; re-fetch public data with scripts in this repo.
- Don't contact Cocoa Dolce staff or suppliers for this entry.
- Submission: Sat Sep 19, 1:00 to 2:00 PM, in person. The live link, a video of 3 minutes or less, and a what-to-click-first note.

## When you are an unattended overnight agent

- No one will answer questions. Make the smallest reasonable decision and write it down in your summary.
- Stay inside the files the issue allows. If the task is too big, finish a useful slice and list what's left.
- Run `npm run check` until it passes. Commit on the current branch.
- Do not push, open PRs, switch branches, or touch labels. The runner script does that.
- End with `SUMMARY:` and `LIMITS:` lines. The runner copies them into the PR.
