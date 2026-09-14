# AI Chocolation

Our Build Track entry for the Chocolathon (WSU AI Club × Cocoa Dolce × Lovable).
Five teammates, each running Claude Code, all pushing to this repo, with agents
working overnight on every laptop. These rules keep that from turning into chaos.

## The prompt

**Not chosen yet.** Once the team picks one, paste the prompt text here with a
one-paragraph summary of what we're building and who at Cocoa Dolce would use it.

## Commands

| Command | What it does |
|---|---|
| `npm run dev` | Local dev server |
| `npm run check` | Lint, typecheck, tests, build. **Must pass before any PR.** CI runs the same thing. |
| `npm run test:watch` | Tests in watch mode |
| `npm run overnight` | Overnight runner (see README) |
| `npm run labels` | One-time: creates the agent labels on GitHub |

Slash commands in `.claude/commands/`:
- `/ship`: check, commit, push, open a PR, auto-merge when CI is green
- `/sync`: pull the latest `main` into your branch and re-run check
- `/task <idea>`: turn an idea into a well-scoped GitHub issue for an overnight agent

## Team workflow

- **Never commit directly to `main`.** Every change goes through a PR that auto-merges when CI passes.
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

Parallel agents must not edit the same files. Fill this in at the team meeting,
then only change files in your own area unless the issue says otherwise.

| Area (folder) | Owner |
|---|---|
| `src/app/` (shell, routing, layout) | _TBD_ |
| `src/features/<feature-a>/` | _TBD_ |
| `src/features/<feature-b>/` | _TBD_ |
| `src/data/` (Cocoa Dolce data, types) | _TBD_ |
| Tooling, CI, `scripts/` | _TBD_ |

Shared files (`package.json`, `src/App.tsx`, `CLAUDE.md`) are edited by humans, or by
agents only when the issue explicitly names them.

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

- All work started after the prompts unlocked (12:00 AM CDT, Sep 14 2026). Don't copy in code from older projects.
- Don't contact Cocoa Dolce staff or suppliers for this entry.
- Submission: Sat Sep 19, 1:00 to 2:00 PM, in person. The live link, a video of 3 minutes or less, and a what-to-click-first note.

## When you are an unattended overnight agent

- No one will answer questions. Make the smallest reasonable decision and write it down in your summary.
- Stay inside the files the issue allows. If the task is too big, finish a useful slice and list what's left.
- Run `npm run check` until it passes. Commit on the current branch.
- Do not push, open PRs, switch branches, or touch labels. The runner script does that.
- End with `SUMMARY:` and `LIMITS:` lines. The runner copies them into the PR.
