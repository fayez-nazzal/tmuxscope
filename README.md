# tmuxscope

One tmux session per project scope, one scope per session.

## Install

    bun link
    printf '\neval "$(tmuxscope hook zsh)"\n' >> ~/.zshrc
    printf "\nrun-shell 'tmuxscope hook tmux | tmux source -'\n" >> ~/.tmux.conf

## Config

`~/.config/tmux-scopes.conf`, one scope per line.

    api = ~/code/api-service*
    web   = ~/webapp ~/repos/webapp

Patterns cover subdirectories. A star is allowed only in the last part of the path.
On overlap the longest pattern wins. Anything unmatched belongs to `misc`.

## Commands

    tmuxscope go <scope or path>    attach the scope session, creating it if needed
    tmuxscope list                  every scope, its session and its patterns
    tmuxscope doctor                report sessions that break the rules
    tmuxscope repair [--dry-run]    move stray windows and merge duplicates
    tmuxscope resolve <path>        print the scope owning a path
    tmuxscope rules <path>          print the zsh fast path rules of that scope
    tmuxscope hook zsh | tmux       print the glue to install

Set `TMUXSCOPE_OFF=1` to disable routing in one shell.

`go` starts the session in a directory that belongs to the scope. If a star pattern
matches nothing on disk it says so and creates nothing.

`repair` only touches the sessions `doctor` names. A session it reports as clean keeps
its name and its windows.

`globs` is the older name of `rules`, kept so a shell opened before the rename keeps
working until it is restarted.

## Limits

Paths are compared as written, with no symlink resolution. zsh reports the logical
`$PWD` while tmux reports the physical `pane_current_path`, so a scope reached
through a symlink can resolve one way in the shell and another way in tmux, for
example `/tmp/work` against `/private/tmp/work`. Point scope patterns at real paths.

## Tests

    bun test

Live verification against a real, isolated tmux server exercised routing, scratch
pane cleanup, session creation, duplicate merging, and `doctor`, end to end. See
`.superpowers/sdd/2026-08-06-tmuxscope/task-9-report.md` for the full log, including
two hook-triggered bugs that were found and fixed along the way (`route` mis-locating
the origin pane, and the tmux hook losing the session id to shell positional-parameter
expansion).
