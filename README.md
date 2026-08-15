# tmuxscope

One tmux session per project scope, and one scope per session.

It is built to be called by an AI coding agent as much as by a person. Every
command an agent needs speaks JSON on `--json`, and every outcome has its own
exit code, so a caller can branch without reading prose. See
[AGENTS.md](AGENTS.md) for the recipes, the field contract and the traps.

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
    tmuxscope hook zsh | tmux           print the glue to install

`go` also takes a path, so `tmuxscope go ~/code/webapp` works without you
remembering the scope name.

Run `doctor` when something feels off. It explains what it found and changes
nothing. `repair` then acts only on the sessions `doctor` named.

## Flags

- `--json` prints machine readable output. It works on `resolve`, `list`, `doctor` and `repair`.
- `--dry-run` on `repair` prints the plan and changes nothing.
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

A **scope** is a name plus the paths it owns.

    web = ~/code/webapp

Every directory belongs to exactly one scope, and every scope gets at most one
tmux session. Those two rules are the whole idea. Anything you have not claimed
belongs to a built-in scope called `misc`.

When a `cd` takes a pane out of its scope, tmuxscope opens the directory in the
right session and returns your pane to where it was. Your shell stays put. Your
work moves.

Sessions you made by hand are welcome. A new session is renamed to match its
scope, or folded into that scope's session when one already exists. A session
you are attached to is never dismantled underneath you.

Symlinked paths are resolved before matching, so `/tmp/work` and
`/private/tmp/work` land in the same scope.

## Tests

    bun test

## License

MIT
