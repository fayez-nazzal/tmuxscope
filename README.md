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
    tmuxscope hook zsh | tmux       print the glue to install

Set `TMUXSCOPE_OFF=1` to disable routing in one shell.

## Tests

    bun test

Live verification against a real, isolated tmux server exercised routing, scratch
pane cleanup, session creation, duplicate merging, and `doctor`, end to end. See
`.superpowers/sdd/2026-08-06-tmuxscope/task-9-report.md` for the full log, including
two hook-triggered bugs that were found and fixed along the way (`route` mis-locating
the origin pane, and the tmux hook losing the session id to shell positional-parameter
expansion).
