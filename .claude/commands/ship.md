---
description: Check, commit, push, open a PR, and auto-merge it when CI passes
argument-hint: "[optional: what this change is]"
---

Ship the current work to `main` through a pull request. Context from the user: $ARGUMENTS

1. **Branch.** If on `main`, create a branch named `<github-username>/<short-slug>` describing the change
   (get the username with `gh api user --jq .login`). Never commit to `main`.
2. **Check.** Run `npm run check`. If it fails, fix the cause and re-run. Do not delete tests, weaken
   types, or disable lint rules to get it passing. If a failure can't be fixed, stop and tell the user.
3. **Commit.** Review `git status` and `git diff`. Stage only files that belong to this change (never
   `.env` files or anything in `.gitignore`). Write a short, specific commit message.
4. **Catch up.** `git fetch origin` then `git rebase origin/main`. If there are conflicts, resolve them
   keeping both sides' intent, ask the user if the intent is unclear, then re-run `npm run check`.
5. **Push.** `git push -u origin HEAD`.
6. **Open the PR** with `gh pr create --base main`. Title: what changed. Body, following
   `.github/pull_request_template.md`: summary, how to test it, and **Known limits** (be honest; the
   judges score this). Link the issue with `Closes #N` if there is one.
7. **Auto-merge.** Run `gh pr merge --auto --squash --delete-branch`. If GitHub refuses auto-merge,
   wait about 30 seconds, run `gh pr checks --watch`, and once every check passes run
   `gh pr merge --squash --delete-branch`. If a check fails, show the failure and stop.
8. **Finish.** Once merged, `git switch main` and `git pull --ff-only`. Reply with the PR link and
   whether it merged or is waiting on CI.
