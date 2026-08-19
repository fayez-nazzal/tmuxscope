# tmuxscope directory integration

## End state

tmuxscope keeps panes from one concrete directory group together.

- One scope can own many directories.
- One scope session can contain many windows.
- Each window contains panes from one directory group.
- Pane headers show the home-relative current path beside existing labels and badges.
- tmuxscope does not read or depend on Claude Code settings.

## Local setup

Add this line to the local scopes file.

```text
tmuxscope = ~/repos/tools/tmuxscope
```

Organization and path headers are enabled by default. They can be disabled independently with `@tmuxscope-organize-panes` and `@tmuxscope-pane-path`.

## Behavior

### Same scope with several directories

Given the `feos` scope owns several worktrees. Each worktree gets its own window inside the `feos` session.

### Child directories

A pane in a child directory stays in the window for its parent directory group.

### Directory changes

A pane entering a different directory group moves to an existing matching window or a new window in the target scope session. Existing origin restore and close behavior stays unchanged. The running process is not moved.

### Unmatched directories

An unmatched path uses its canonical current directory as its group. Different unmatched directories use different groups.

### Mixed panes

`doctor` reports a mixed window. `repair` moves misplaced panes into matching windows while preserving running processes.

### Header composition

The path appears in home-relative form. Existing manual labels and Claude badges remain visible. tmuxscope does not invoke Claude commands.

### Independent switches

Turning off `@tmuxscope-pane-path` hides only the path. Turning off `@tmuxscope-organize-panes` stops automatic organization only.

### Reload safety

Loading the tmux hook more than once keeps the path fragment once and preserves existing border content.

