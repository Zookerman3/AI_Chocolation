---
description: Turn a rough idea into a well-scoped GitHub issue for an overnight agent
argument-hint: "<idea> [for @username]"
---

Turn this idea into a GitHub issue an unattended agent can finish overnight: $ARGUMENTS

1. Read `CLAUDE.md` (especially "Who owns which area") and look at the relevant code so the issue
   names real files and folders.
2. **Size it.** One issue should be about an hour of agent work and touch one area. If the idea is
   bigger, split it into several issues and say how they depend on each other.
3. Draft the issue using `.github/ISSUE_TEMPLATE/agent-task.md`:
   - **Goal:** one or two sentences, from the user's point of view
   - **Files it may change:** specific folders or files, inside one owner's area
   - **Acceptance criteria:** checkable bullet points
   - **How to verify:** the test to add or the screen to click through
   - **Out of scope:** what the agent must not do
4. **Assignee.** Use the `@username` given in the arguments, or the owner of that area in `CLAUDE.md`.
   If neither is clear, ask. The overnight runner only picks up issues assigned to its owner.
5. Show the draft(s) and ask for a yes before creating anything.
6. Create each one with
   `gh issue create --title "<title>" --body-file <tempfile> --label agent-ready --assignee <username>`,
   then reply with the issue links.
