#!/usr/bin/env bash
# Overnight runner.
#
# Works through open GitHub issues labeled `agent-ready` AND assigned to you, oldest first.
# Each issue runs in its own git worktree (outside this repo folder), so your working copy
# is never touched. For each issue:
#   1. Claude Code works on it headless and commits
#   2. this script re-runs `npm run check`, rebases on main, pushes, and opens a PR
#   3. passing PRs are merged right away (there is no CI; the local check is the gate);
#      failing ones become draft PRs labeled `agent-failed`
# Stops when the queue is empty, MAX_TASKS is reached, or your Claude usage limit is hit
# (the unfinished issue goes back to `agent-ready`).
#
# Usage:  npm run overnight
# Tuning: MAX_TURNS=80 MAX_TASKS=10 npm run overnight

set -uo pipefail

MAX_TURNS="${MAX_TURNS:-60}"
MAX_TASKS="${MAX_TASKS:-50}"
# Text Claude Code prints when a Pro/Max usage limit is hit. Confirm against a real message.
LIMIT_PATTERN='usage limit|hit your limit|limit reached|limit will reset|resets at|rate limit'

log() { printf '[%s] %s\n' "$(date +%H:%M:%S)" "$*"; }
die() { log "ERROR: $*"; exit 1; }

# Keep a Mac awake for the whole run.
if [[ "$(uname)" == "Darwin" && -z "${CAFFEINATED:-}" ]] && command -v caffeinate >/dev/null 2>&1; then
  CAFFEINATED=1 exec caffeinate -i bash "$0" "$@"
fi

for cmd in git gh claude npm; do
  command -v "$cmd" >/dev/null 2>&1 || die "'$cmd' is not installed or not on PATH. See README, Team setup."
done

REPO_ROOT="$(git rev-parse --show-toplevel)" || die "Run this from inside the repo."
cd "$REPO_ROOT"
REPO_NAME="$(basename "$REPO_ROOT")"
WT_ROOT="$(dirname "$REPO_ROOT")/${REPO_NAME}-worktrees"
LOG_DIR="$REPO_ROOT/.agent-logs"
mkdir -p "$WT_ROOT" "$LOG_DIR"

gh auth status >/dev/null 2>&1 || die "GitHub CLI is not signed in. Run: gh auth login"
ME="$(gh api user --jq .login)" || die "Could not read your GitHub username."
gh label list --limit 100 --json name --jq '.[].name' | grep -qx 'agent-ready' \
  || die "Labels are missing. Run once: npm run labels"

CURRENT_ISSUE=""
CURRENT_WT=""

remove_worktree() {
  local wt="$1" branch="$2"
  [[ -n "$wt" ]] && git worktree remove --force "$wt" >/dev/null 2>&1
  git worktree prune >/dev/null 2>&1
  [[ -n "$branch" ]] && git branch -D "$branch" >/dev/null 2>&1
  return 0
}

set_label() { # issue, label-to-remove, label-to-add
  gh issue edit "$1" --remove-label "$2" --add-label "$3" >/dev/null 2>&1 || true
}

on_interrupt() {
  echo
  if [[ -n "$CURRENT_ISSUE" ]]; then
    log "Interrupted. Putting #$CURRENT_ISSUE back in the queue."
    set_label "$CURRENT_ISSUE" agent-running agent-ready
    remove_worktree "$CURRENT_WT" "agent/$ME/$CURRENT_ISSUE"
  fi
  exit 130
}
trap on_interrupt INT TERM

next_issue() {
  gh issue list --state open --label agent-ready --assignee "$ME" \
    --search "sort:created-asc" --limit 1 --json number --jq '.[0].number // empty'
}

# Returns 0 = PR opened and passing, 1 = failed (needs a human), 2 = usage limit hit (stop).
run_issue() {
  local n="$1"
  local branch="agent/$ME/$n"
  local wt="$WT_ROOT/issue-$n"
  local stamp; stamp="$(date +%Y%m%d-%H%M%S)"
  local log_file="$LOG_DIR/issue-$n-$stamp.log"
  local out_file="$LOG_DIR/issue-$n-$stamp.claude.txt"
  local check_file="$LOG_DIR/issue-$n-$stamp.check.txt"

  CURRENT_ISSUE="$n"; CURRENT_WT="$wt"

  local title body
  title="$(gh issue view "$n" --json title --jq .title)"
  body="$(gh issue view "$n" --json body --jq .body)"
  log "#$n $title"
  set_label "$n" agent-ready agent-running

  fail() {
    log "  failed: $1"
    gh issue comment "$n" --body "Overnight runner on @$ME's laptop could not finish this: $1" >/dev/null 2>&1 || true
    set_label "$n" agent-running agent-failed
    remove_worktree "$wt" "$branch"
    CURRENT_ISSUE=""; CURRENT_WT=""
    return 1
  }

  # Fresh worktree from the latest main.
  git fetch origin --quiet >>"$log_file" 2>&1 || { fail "git fetch failed"; return 1; }
  remove_worktree "$wt" "$branch"
  git worktree add -b "$branch" "$wt" origin/main >>"$log_file" 2>&1 || { fail "could not create a worktree"; return 1; }

  log "  installing dependencies"
  (cd "$wt" && npm ci) >>"$log_file" 2>&1 || { fail "npm ci failed (see .agent-logs)"; return 1; }

  local prompt
  prompt="You are working unattended overnight on GitHub issue #$n. No human will answer questions.

Issue title: $title

Issue body:
$body

Follow CLAUDE.md, especially the section for unattended overnight agents:
- Only change the files the issue allows. If the task is too big, finish a useful slice.
- Run \`npm run check\` and fix problems until it passes.
- Commit your work on the current branch. Do not push, open PRs, switch branches, or edit labels.
- End your final message with exactly these two lines:
SUMMARY: <one or two sentences on what changed>
LIMITS: <what does not work yet, or was left out>"

  log "  claude is working (max $MAX_TURNS turns)"
  (cd "$wt" && printf '%s' "$prompt" | claude -p \
      --permission-mode acceptEdits \
      --max-turns "$MAX_TURNS" \
      --output-format text \
      --disallowedTools "Bash(git push *)" "Bash(gh *)") >"$out_file" 2>&1
  local claude_exit=$?

  if ! grep -q '^SUMMARY:' "$out_file" && grep -qiE "$LIMIT_PATTERN" "$out_file"; then
    log "  Claude usage limit reached. Requeueing #$n."
    set_label "$n" agent-running agent-ready
    remove_worktree "$wt" "$branch"
    CURRENT_ISSUE=""; CURRENT_WT=""
    return 2
  fi
  [[ $claude_exit -ne 0 ]] && log "  claude exited with code $claude_exit"

  # Commit anything Claude left uncommitted.
  if [[ -n "$(git -C "$wt" status --porcelain)" ]]; then
    git -C "$wt" add -A >>"$log_file" 2>&1
    git -C "$wt" commit -m "Issue #$n: uncommitted agent work (auto-committed by overnight runner)" >>"$log_file" 2>&1
  fi
  if [[ "$(git -C "$wt" rev-list --count origin/main..HEAD)" == "0" ]]; then
    fail "Claude made no changes. Output: .agent-logs/$(basename "$out_file")"
    return 1
  fi

  # Catch up with main before checking, so the PR reflects what will actually merge.
  local conflict=""
  git -C "$wt" fetch origin --quiet >>"$log_file" 2>&1
  if ! git -C "$wt" rebase origin/main >>"$log_file" 2>&1; then
    git -C "$wt" rebase --abort >>"$log_file" 2>&1
    conflict="yes"
  fi

  local passed=""
  if [[ -z "$conflict" ]]; then
    log "  running npm run check"
    (cd "$wt" && npm run check) >"$check_file" 2>&1 && passed="yes"
  fi

  local summary limits
  summary="$(grep -m1 '^SUMMARY:' "$out_file" | sed 's/^SUMMARY:[[:space:]]*//')"
  limits="$(grep -m1 '^LIMITS:' "$out_file" | sed 's/^LIMITS:[[:space:]]*//')"
  [[ -z "$summary" ]] && summary="(Claude did not write a summary. See the commits.)"
  [[ -z "$limits" ]] && limits="(Claude did not list limits. Review before trusting this.)"

  git -C "$wt" push --force-with-lease -u origin "$branch" >>"$log_file" 2>&1 || { fail "git push failed"; return 1; }

  local status_line pr_body_file="$LOG_DIR/issue-$n-$stamp.pr.md"
  if [[ -n "$passed" ]]; then
    status_line="\`npm run check\` passed on @$ME's laptop."
    printf '## Summary\n%s\n\nCloses #%s\n\n## How to test\nSee the acceptance criteria in #%s.\n\n## Known limits\n%s\n\n---\nOpened by the overnight runner. %s\n' \
      "$summary" "$n" "$n" "$limits" "$status_line" >"$pr_body_file"
  else
    if [[ -n "$conflict" ]]; then
      status_line="Could not rebase on \`main\` (merge conflict). Needs a human."
    else
      status_line="\`npm run check\` FAILED. Last lines:"$'\n\n```\n'"$(tail -n 40 "$check_file")"$'\n```'
    fi
    printf '## Summary\n%s\n\nRelated to #%s (not closing: this needs a human).\n\n## Known limits\n%s\n\n---\nOpened by the overnight runner. %s\n' \
      "$summary" "$n" "$limits" "$status_line" >"$pr_body_file"
  fi

  local pr_url
  pr_url="$(gh pr view "$branch" --json url --jq .url 2>/dev/null)"
  if [[ -z "$pr_url" ]]; then
    local draft_flag=()
    [[ -z "$passed" ]] && draft_flag=(--draft)
    pr_url="$(gh pr create --base main --head "$branch" --title "#$n: $title" \
      --body-file "$pr_body_file" ${draft_flag[@]+"${draft_flag[@]}"} 2>>"$log_file")" || { fail "could not open a PR"; return 1; }
  else
    gh pr edit "$branch" --body-file "$pr_body_file" >>"$log_file" 2>&1
    [[ -n "$passed" ]] && gh pr ready "$branch" >>"$log_file" 2>&1
  fi

  remove_worktree "$wt" "$branch"
  CURRENT_ISSUE=""; CURRENT_WT=""

  if [[ -n "$passed" ]]; then
    # No CI: the local `npm run check` above is the gate, so merge right away.
    if gh pr merge "$branch" --squash --delete-branch >>"$log_file" 2>&1; then
      gh issue edit "$n" --remove-label agent-running >/dev/null 2>&1 || true
      log "  merged: $pr_url"
    else
      set_label "$n" agent-running agent-pr-open
      log "  check passed but merge failed (likely a conflict); PR waiting: $pr_url"
    fi
    return 0
  fi

  gh issue comment "$n" --body "Overnight runner opened a draft PR that needs a human: $pr_url" >/dev/null 2>&1 || true
  set_label "$n" agent-running agent-failed
  log "  needs a human: $pr_url"
  return 1
}

log "Overnight runner for @$ME. Worktrees in $WT_ROOT"
done_count=0; ok=0; failed=0; stopped_for_limit=""

while (( done_count < MAX_TASKS )); do
  issue="$(next_issue)"
  if [[ -z "$issue" ]]; then
    log "No more agent-ready issues assigned to @$ME."
    break
  fi
  done_count=$((done_count + 1))
  run_issue "$issue"
  case $? in
    0) ok=$((ok + 1)) ;;
    2) stopped_for_limit="yes"; break ;;
    *) failed=$((failed + 1)) ;;
  esac
done

log "Finished. PRs opened: $ok. Needs a human: $failed.${stopped_for_limit:+ Stopped at the Claude usage limit.}"
log "Morning check: gh pr list   and   gh issue list --label agent-failed"
