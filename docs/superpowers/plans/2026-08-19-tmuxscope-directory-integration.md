# tmuxscope directory integration implementation plan

## Goal

Keep one concrete directory group per tmux window while preserving scope sessions and existing route behavior. Show the home-relative pane path beside existing pane header content.

## Implementation

1. Resolve canonical directory groups for exact paths, wildcard worktrees, and unmatched directories.
2. Extend tmux state with pane records and pane-preserving move actions.
3. Route same-scope directory changes to separate windows while keeping cross-scope behavior.
4. Report mixed panes in `doctor` and separate them in `repair`.
5. Install independent default-on hooks for pane organization and path headers.
6. Add the lightweight `organize` command and document the behavior.
7. Apply the local `tmuxscope` scope and reload the active tmux hook.
8. Run tests, build, diff checks, and publish the pull request.

## Pull request

Title: `Organize tmux panes by directory`

The pull request should explain that scope sessions can contain multiple windows. Same directory groups reuse one window. Different directories use separate windows. Mixed panes are diagnosed and repaired. Pane organization and path headers are default-on independent switches.

