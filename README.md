# AI Chocolation

Our Build Track entry for the **Chocolathon** (WSU AI Club × Cocoa Dolce × Lovable), Sep 14–19, 2026.

> **What it does:** A tablet screen for the counter — the cashier taps the chocolate a customer
> just picked, once per piece, until the count matches the box size, then saves one exportable
> record per box (CSV/JSON), with the assembly time measured automatically.
>
> **Live link:** _TBD (Vercel)_ · **What to click first:** Turn on "Demo mode," then open the
> Records and Stats tabs to see sample data without needing real chocolates on hand.

Stack: React 19 + Vite + TypeScript, Vitest, ESLint. There is no CI: `npm run check` on your own
laptop is the gate before anything merges.

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

## Repo settings (owner, one time)

- Settings → Collaborators: add teammates (write access)
- Settings → General → Pull Requests: allow squash merging, automatically delete head branches
- `main` is not protected. That needs GitHub Pro on a private repo. Nothing stops a direct push, so follow CLAUDE.md.
- Vercel: import the repo. Every PR gets a preview link, and `main` is the live link.

## Known limits

Keep this honest and current. The judges score it.

- **Narrow/portrait tablet: progress and Save are below the fold on a fresh box.**
  The redesigned layout (Manus AI) collapses to one column under 900px and its
  `box-actions` bar is sticky-to-bottom once reached, but the "Your Box" panel
  still renders after the full flavor grid in DOM order — on a brand-new box, the
  cashier has to scroll past the whole grid once before seeing the running count
  or the Save button at all. Fine at desktop/landscape width; worth fixing before
  this runs on a real portrait tablet at the counter.

- **Case layout isn't the real one yet.** We have no way to know Cocoa Dolce's actual physical
  display case without asking their staff, which the rules don't allow. The tile grid ships with a
  reasonable default order; a cashier taps "Rearrange case" once to match their counter, and it's
  saved on that device from then on. A "Reset to default" button is there in case a rearrange goes
  wrong.
- **Camera assist is on-device and measured, not trained.** No model download and no API: each cell
  of the insert is cropped from a photo the cashier lines up with an on-screen outline, turned into a
  392-number colour/texture fingerprint (`src/features/camera/features.ts`), and matched against a
  735 KB gallery of our own labelled crops (`public/models/`). Measured on 64 photos of a mixed
  30-slot box across four sessions, each session held out in turn and scored against the other
  three (`node scripts/build-gallery.ts`): **92% top-1, 97% top-3**. On a session the gallery never
  saw, read through the same whole-frame path the tablet uses: 93.6% top-1, 97.7% top-3, 87% of
  cells auto-filled with 1.9% of those wrong, all 54 empty slots recognised with no false pieces —
  about two confirm taps and one wrong auto-fill every three 16-piece boxes. Where it's weakest,
  honestly: **Maple Cream vs Turtle** (both tan domes; most of the misses) and **Grey Salt Caramel
  vs Crème Brûlée / Brownie Batter** (dark squares against black plastic). Those are what the
  "please confirm" step is for. The gallery holds one physical piece per flavor, photographed 64
  times; a second box of chocolates would tighten it further. Roboflow remains an opt-in override
  (`.env.example`) if a hosted detector ever beats this.
- **The camera needs the box lined up.** It reads fixed slots, so the cashier holds the tablet over
  the open box until the insert fills the outline — about a second — then taps Capture. Only inserts
  we've measured are supported: 4×4 (16) and 5×6 (30); 6 and 10 are assumed 2×3 / 2×5 and need
  checking against real boxes; 50 stays tap-only. Where the live preview isn't available (an
  `http://` dev server on a phone, or a denied permission) it falls back to the OS camera and reads
  the photo as if the insert filled 88% of it, which is less forgiving.
- **Local device storage only.** Records live in the browser's localStorage, per device, with no
  backend, no login, and no sync across tablets. Losing the tab or clearing site data loses the data.
- **The in-app timer isn't the full "measured, not guessed" story.** It correctly measures real
  elapsed time per box in the app, but the seconds-per-box number for the submission comes from
  timing real people assembling real boxes by hand (planned for Thursday), not just this timer.
- **Not deployed yet.** No live Vercel link. That's a one-time repo-owner action (see "Repo settings"
  above); until then, this only runs locally (`npm run dev` or `npm run build && npm run preview`).
- **Offline works after the first load, not before it.** The app is installable (Add to Home Screen)
  and precaches itself plus every flavor photo a device has viewed, via a service worker
  (`vite-plugin-pwa`). That covers the real risk — event wifi dropping mid-shift — but a device that
  has never opened the link once still needs that first connection.

### Where this breaks, named against the four scenarios the prompt calls out

- **A rush at the counter.** One tap per piece, no confirm dialogs, so it doesn't slow anyone down —
  but that also means there's no friction to catch a mistake in the moment. The backstops: Save stays
  disabled until the count exactly matches the box size (and the count is large and always visible),
  and a live per-flavor tally sits above the grid so a wrong count is visible before the box is called
  done, not just at the very end.
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
- **A large box.** Works up to 50 pieces (tested). The running tally's `+` button lets a cashier add
  repeats of a flavor already in the box without re-finding its tile in the grid, which cuts down the
  search-and-tap cost for a big box — but it's still one count per tap, so a 50-piece box is
  meaningfully slower than a 6-piece one, and each tap is still a chance to mis-tap. Exactly why the
  50-piece box needs its own real timing pass on Thursday, not just the 6-piece one.
- The overnight runner detects the Claude usage limit by matching the error text. If Claude changes
  that message, the runner will mark the issue `agent-failed` instead of requeueing it.
- There is no CI and `main` is unprotected. If someone merges without running `npm run check`, `main` can
  break. Run `/sync` and check before starting work.
- Two agents editing the same files will conflict. Area ownership in `CLAUDE.md` is what prevents
  that, not the tooling.
