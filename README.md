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

- **Case layout isn't the real one yet.** We have no way to know Cocoa Dolce's actual physical
  display case without asking their staff, which the rules don't allow. The tile grid ships with a
  reasonable default order; a cashier taps "Rearrange case" once to match their counter, and it's
  saved on that device from then on.
- **No camera assist yet.** Phase 1 (this) is tap-only. Camera input is gated behind a Wednesday-night
  accuracy checkpoint (see `CLAUDE.md`) and will only ship if it clears it; otherwise it's out of
  scope and this stays a tap-only submission.
- **Local device storage only.** Records live in the browser's localStorage, per device, with no
  backend, no login, and no sync across tablets. Losing the tab or clearing site data loses the data.
- **The in-app timer isn't the full "measured, not guessed" story.** It correctly measures real
  elapsed time per box in the app, but the seconds-per-box number for the submission comes from
  timing real people assembling real boxes by hand (planned for Thursday), not just this timer.
- **Not deployed yet.** No live Vercel link. That's a one-time repo-owner action (see "Repo settings"
  above); until then, this only runs locally (`npm run dev`).
- The overnight runner detects the Claude usage limit by matching the error text. If Claude changes
  that message, the runner will mark the issue `agent-failed` instead of requeueing it.
- There is no CI and `main` is unprotected. If someone merges without running `npm run check`, `main` can
  break. Run `/sync` and check before starting work.
- Two agents editing the same files will conflict. Area ownership in `CLAUDE.md` is what prevents
  that, not the tooling.
