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

## Known issues

Live verification against a real tmux server (see
`.superpowers/sdd/2026-08-06-tmuxscope/task-9-report.md`) found two bugs in the
hook-triggered paths that unit tests, which mock tmux state, did not catch:

- `tmuxscope route` (`src/cli.ts`) queries tmux state after the shell has
  already `cd`ed, so the origin pane's own window can already report the
  target path. This makes `route` either misattribute the destination to the
  origin session, or crash with `can't find window: misc` when the origin
  session has only one window.
- The installed tmux hook (`src/hooks.ts` `TMUX_HOOK`) passes `#{session_id}`
  through `run-shell`, which executes via a shell. Tmux session ids look like
  `$1`, `$2`, ..., so the shell reinterprets that as an empty positional
  parameter. `tmuxscope adopt` never receives a real session id, so new and
  duplicate sessions are never adopted automatically.

`doctor` and `repair` were verified clean against real tmux state and are not
affected.
