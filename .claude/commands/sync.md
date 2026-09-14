---
description: Pull the latest main into your current branch and re-run check
---

Bring this working copy up to date with `origin/main`.

1. Run `git status`. If there are uncommitted changes, tell the user and ask whether to commit them
   first or leave them. Don't stash or discard anything without asking.
2. `git fetch origin`.
3. If on `main`: `git pull --ff-only`. If that fails because local `main` has its own commits, stop and
   explain. Those commits belong on a branch.
4. If on another branch: `git rebase origin/main`. On conflicts, open each conflicted file, keep both
   sides' intent, and ask the user when the right resolution isn't clear. Continue with
   `git add <file>` and `git rebase --continue`.
5. If `package-lock.json` changed, run `npm install`.
6. Run `npm run check` and report the result in one or two lines: what came in from `main`
   (`git log --oneline` of the new commits) and whether check passes.
