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

**Phase 2 (Wed–Fri): camera assist, only if it passes the checkpoint.**
Switched from the original per-cell-crop plan to whole-box object detection, matching
[Roboflow's own chocolate-identification writeup](https://blog.roboflow.com/identifying-chocolates-with-computer-vision/):
one photo of the open box, a model draws a bounding box and a class around each visible piece. A
detection at or above ~80% confidence auto-adds to the box; anything under that, or a class that
doesn't map to a known flavor, goes to the cashier for a one-tap confirm or correction. The
integration (`src/features/camera/`) is fully built and tested against a stub detector — `applyDetections`
does the auto-add/review/overflow split, `CameraScreen` does the capture-and-confirm UI, and
`roboflowDetector.ts` is a ready client for a Roboflow-hosted model. **What's still missing is the
model itself**: like the Roboflow article, it needs real photos of our actual bonbons, labeled with
classes named exactly as our flavor ids (see `roboflowDetector.ts`'s doc comment) via Roboflow's
Label Assist + Dataset Health Check, the same as the reference project. Until that exists, set
`VITE_ROBOFLOW_API_KEY` / `VITE_ROBOFLOW_MODEL_ID` (see `.env.example`) and the app runs the stub
detector instead — the flow works, it just won't detect anything real.

**Checkpoint: Wednesday night.** On held-out photos, if the camera's top-1 accuracy is at least ~80%
and top-3 is at least ~95%, ship camera assist. Otherwise it goes in the video and Known limits as
tested and measured, and we ship tap-only. That checkpoint needs real training photos taken by
someone on the team — nobody has taken any yet.

**Thursday:** time 10+ real boxes per method (seconds per box, corrections). Those numbers go in the video.

### The design rule: every input feeds the same box

All input methods call the same box-session functions in `src/features/box/`. A tile tap adds a piece
with `source: 'tap'`; the camera adds pieces with `source: 'camera'` and a `confidence`. The count
check, save, records, export and stats never care where a piece came from.
Shared types live in [src/domain/types.ts](src/domain/types.ts). Change them only in a PR that says why.

### Facts to respect

- ~25 bonbon flavors at $3.35 each, some seasonal. Box sizes: 6, 10, 16, 30, 50 pieces.
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
| `src/domain/` | Shared types. Changes need a PR that explains why | everyone, carefully |

Shared files (`package.json`, `src/App.tsx`, `CLAUDE.md`, `src/domain/types.ts`) are edited by
humans, or by agents only when the issue explicitly names them.

Data is stored on the device (localStorage) for now. There is no backend.

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
