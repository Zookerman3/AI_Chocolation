# AI Chocolation

Our Build Track entry for the **Chocolathon** (WSU AI Club × Cocoa Dolce × Lovable), Sep 14–19, 2026.

> **What it does:** _TBD once we pick a prompt. One sentence here; the submission form asks for it._
>
> **Live link:** _TBD (Vercel)_ · **What to click first:** _TBD_

Stack: React 19 + Vite + TypeScript, Vitest, ESLint. CI runs on every pull request, and
passing PRs merge themselves.

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
| Change is ready | `/ship`: check → commit → push → PR → auto-merge |
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
4. **check passed:** the PR is set to auto-merge, and the issue is labeled `agent-pr-open`
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
- Settings → General → Pull Requests: allow squash merging, allow auto-merge,
  automatically delete head branches
- Settings → Branches: protect `main`: require a pull request and the `check` status check,
  block force pushes. This needs GitHub Pro (free with the Student Developer Pack) on a private repo.
  Without it, auto-merge won't turn on, and passing PRs wait for someone to click Merge.
- Vercel: import the repo. Every PR gets a preview link, and `main` is the live link.

## Known limits

Keep this honest and current. The judges score it.

- The app is an empty shell until the prompt is chosen.
- The overnight runner detects the Claude usage limit by matching the error text. If Claude changes
  that message, the runner will mark the issue `agent-failed` instead of requeueing it.
- Two agents editing the same files will conflict. Area ownership in `CLAUDE.md` is what prevents
  that, not the tooling.
