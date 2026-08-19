# tmuxscope

[![CI](https://github.com/fayez-nazzal/tmuxscope/actions/workflows/ci.yml/badge.svg)](https://github.com/fayez-nazzal/tmuxscope/actions/workflows/ci.yml) [![License: MIT](https://img.shields.io/badge/License-MIT-blue.svg)](LICENSE)

A tmux and shell setup tool for a person who works across many project
directories. It keeps your tmux server tidy on its own, so you stop hunting for
the window you left open.

The whole idea is one rule.

- One tmux session per scope.
- One scope per set of related directories.
- One directory group per tmux window.

A **scope** is a name plus the paths it owns, like `web = ~/code/webapp`. A
scope can own several directories, including several git worktrees. Every
directory group gets its own window inside the scope session. Anything you did
not claim belongs to a built-in scope called `misc`.

Real work drifts away from that rule. You open a session by hand, or a `cd`
drops a window in the wrong place. Two commands put it back.

- `tmuxscope doctor` reads the tmux server as it is now and names every break. It changes nothing.
- `tmuxscope repair` moves the windows and merges the duplicate sessions.

## How it pairs with your shell

`tmuxscope hook zsh` prints a `chpwd` hook you add to `~/.zshrc`. After that,
every `cd` is checked. When a `cd` takes a pane out of its scope, the hook calls
`tmuxscope route`, which opens the directory in the session that owns it and
sends your pane back where it was. Your shell stays put. Your work moves.

`route` never prints the paths it decides on. It writes them into two files the
hook creates, named by two environment variables.

- `TMUXSCOPE_CD_FILE` receives the directory your shell should return to.
- `TMUXSCOPE_EXEC_FILE` receives a line the shell runs afterwards, such as closing an empty pane.

The hook creates both files, calls `route`, sources whatever came back, then
deletes them. When either variable is empty, `route` skips that write in
silence. So do not call `route` by hand unless you set both variables yourself.

`tmuxscope hook tmux` prints the matching tmux side, which renames or folds a
session you created by hand into the scope it belongs to. A session you are
attached to is never dismantled underneath you.

## Requirements

- tmux 3.0 or newer.
- zsh.
- [bun](https://bun.sh) 1.2 or newer.

## Install

The `tmuxscope` command is a compiled binary at `dist/tmuxscope`. That folder is
gitignored, so a fresh clone has to build it first.

    git clone https://github.com/fayez-nazzal/tmuxscope.git
    cd tmuxscope
    bun install
    bun run build
    bun link

Add the two hooks.

    printf '\neval "$(tmuxscope hook zsh)"\n' >> ~/.zshrc
    printf "\nrun-shell 'tmuxscope hook tmux | tmux source -'\n" >> ~/.tmux.conf

Open a new shell, or run `source ~/.zshrc` and `tmux source ~/.tmux.conf`.

The tmux hook keeps panes from different directory groups in separate windows.
It also adds the home-relative directory to the pane header. Both behaviors are
enabled by default and can be disabled independently with the tmux options
`@tmuxscope-organize-panes` and `@tmuxscope-pane-path`. Existing pane labels and
badges remain in place.

For this repository, add the local scope line `tmuxscope = ~/repos/tools/tmuxscope`
to your scopes file.

## The smallest useful command

    tmuxscope list

It prints every scope, the session that owns it and the paths it claims.

    SCOPE  SESSION  WINDOWS  PATTERNS
    demo   -        -        /tmp/demo-scope
    misc   misc     1        everything else

## Configure

Your scopes live in `~/.config/tmux-scopes.conf`. Set `TMUXSCOPE_CONFIG` to read
a different file. Copy the example to get started.

    mkdir -p ~/.config
    cp tmux-scopes.conf.example ~/.config/tmux-scopes.conf
    $EDITOR ~/.config/tmux-scopes.conf

One scope per line, in the form `name = path [path ...]`.

    api = ~/code/api-service*
    web = ~/code/webapp ~/work/webapp
    dots = ~/.config

A few things worth knowing.

- A pattern covers everything beneath it, so `~/code/webapp` owns `~/code/webapp/src`.
- A star is allowed only in the last part of a path. `~/code/api-*` works, `~/*/api` does not.
- Stars are handy for git worktrees, where `~/code/api-*` catches `api-service` and `api-service.hotfix` alike.
- When two patterns match, the longer one wins, so you can carve a subdirectory out of a wider scope.
- Scope names may use letters, digits, dash and underscore. `misc` is reserved.
- Lines starting with `#` are comments.

Start small. Three or four scopes for the projects you actually switch between
beats a line for every directory you own.

## Commands

    tmuxscope resolve <path> [--json]   print the scope owning a path
    tmuxscope rules <path>              print the zsh fast path rules of that scope
    tmuxscope route <path>              hook entry point for a cd that left the scope
    tmuxscope adopt <session-id>        hook entry point for a new session
    tmuxscope go <scope or path>        attach the scope session, creating it if needed
    tmuxscope list [--json]             every scope, its session and its patterns
    tmuxscope doctor [--json]           report sessions that break the rules
    tmuxscope repair [--dry-run] [--json]  move stray windows and merge duplicates
    tmuxscope organize [--hook] [window-id] [--json]  group panes by directory
    tmuxscope hook zsh | tmux           print the glue to install

`go` also takes a path, so `tmuxscope go ~/code/webapp` works without you
remembering the scope name.

Run `doctor` when something feels off. It explains what it found and changes
nothing. `repair` then acts only on the sessions `doctor` named.

## Flags

- `--json` prints machine readable output. It works on `resolve`, `list`, `doctor` and `repair`.
- `--dry-run` on `repair` prints the plan and changes nothing.
- `organize` moves only panes in mixed-directory windows. `--hook` keeps the
  command quiet for tmux hooks. A window id limits the check to that window.
- `-h` or `--help` prints the usage text.
- `-v` or `--version` prints the version from `package.json`.

Flags may sit anywhere in the command line.

## Environment

- `TMUXSCOPE_CONFIG` points at a different scopes file.
- `TMUXSCOPE_OFF=1` stops routing for that shell only. Useful when a script does a lot of `cd`.

## Exit codes

    0  clean
    1  the invariant is still broken (doctor found something, repair could not fix everything)
    2  bad input (unknown command, broken config, unknown scope)
    3  wrong environment (route run outside tmux or outside a pane)
    4  a tmux call failed

## JSON output

`tmuxscope resolve <path> --json`

    {
      "scope": "demo",
      "matched": "/tmp/demo-scope",
      "path": "/tmp/demo-scope/x"
    }

`tmuxscope list --json`

    {
      "rows": [
        {
          "scope": "demo",
          "session": "",
          "windows": 0,
          "attached": false,
          "patterns": ["/tmp/demo-scope"]
        }
      ]
    }

`tmuxscope doctor --json`

    {
      "mixed": [],
      "split": [{ "scope": "misc", "sessions": ["ghostty", "misc"] }],
      "ambiguous": [],
      "problems": 1,
      "config": [
        { "kind": "missingDirectory", "scope": "demo", "pattern": "/tmp/demo-scope" }
      ]
    }

`tmuxscope repair --json --dry-run`

    {
      "actions": [{ "kind": "move-window", "windowId": "@0", "session": "ghostty" }],
      "unsatisfiable": [],
      "applied": false
    }

Notes on the shapes.

- `applied` is `true` only when `repair` ran without `--dry-run` and every action landed.
- A real run adds an `after` field holding the fresh `doctor` report.
- A failed tmux call adds an `error` field and exits with code `4`.
- When the moves cannot be ordered, `unsatisfiable` lists them and the exit code is `1`.

## Design notes

Sessions you made by hand are welcome. A new session is renamed to match its
scope, or folded into that scope's session when one already exists. A session
you are attached to is never dismantled underneath you.

Symlinked paths are resolved before matching, so `/tmp/work` and
`/private/tmp/work` land in the same scope.

## Tests

    bun test

## Agent skill, optional

An optional agent skill lives at `skills/tmuxscope/`. It teaches an AI coding
agent when to call `doctor` and `repair`. Install it with
`scripts/install-skill.sh`. The tool works exactly the same without it.

## Contributing

See [CONTRIBUTING.md](CONTRIBUTING.md). Security reports go through
[SECURITY.md](SECURITY.md).

## License

MIT, see [LICENSE](LICENSE).
