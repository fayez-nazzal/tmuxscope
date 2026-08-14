# tmuxscope

One tmux session per project, automatically.

You tell tmuxscope which directories belong to which project. From then on your
sessions organise themselves. `cd` into a project and you land in that project
session. `cd` somewhere else and you land somewhere else. No manual session
juggling, and no drawer of half-named sessions by Friday.

## How it works

A **scope** is a name plus the paths it owns.

    web = ~/code/webapp

Every directory belongs to exactly one scope, and every scope gets at most one
tmux session. Those two rules are the whole idea. Anything you have not claimed
belongs to a built-in scope called `misc`.

When a `cd` takes a pane out of its scope, tmuxscope opens the directory in the
right session and returns your pane to where it was. Your shell stays put. Your
work moves.

## Requirements

tmux 3.0 or newer, zsh, and [bun](https://bun.sh).

## Install

    git clone https://github.com/fayez-nazzal/tmuxscope.git
    cd tmuxscope
    bun link

Add the two hooks.

    printf '\neval "$(tmuxscope hook zsh)"\n' >> ~/.zshrc
    printf "\nrun-shell 'tmuxscope hook tmux | tmux source -'\n" >> ~/.tmux.conf

Open a new shell, or run `source ~/.zshrc` and `tmux source ~/.tmux.conf`.

## Configure

Your scopes live in `~/.config/tmux-scopes.conf`. This file is yours and stays on
your machine. Copy the example to get started.

    mkdir -p ~/.config
    cp tmux-scopes.conf.example ~/.config/tmux-scopes.conf
    $EDITOR ~/.config/tmux-scopes.conf

One scope per line, in the form `name = path [path ...]`.

    api = ~/code/api-service*
    web = ~/code/webapp ~/work/webapp
    dots = ~/.config

Run `tmuxscope list` to check what you wrote, and `tmuxscope resolve <path>` to
ask which scope owns a directory.

A few things worth knowing.

- A pattern covers everything beneath it, so `~/code/webapp` owns `~/code/webapp/src`.
- A star is allowed only in the last part of a path. `~/code/api-*` works, `~/*/api` does not.
- Stars are handy for git worktrees, where `~/code/api-*` catches `api-service` and `api-service.hotfix` alike.
- When two patterns match, the longer one wins, so you can carve a subdirectory out of a wider scope.
- Scope names may use letters, digits, dash and underscore. `misc` is reserved.

Start small. Three or four scopes for the projects you actually switch between
beats a line for every directory you own.

## Daily use

Mostly you just `cd` and let the hooks work. Four commands cover the rest.

    tmuxscope go <scope>    jump to a scope, creating its session if needed
    tmuxscope list          every scope, its session and its patterns
    tmuxscope doctor        report sessions that break the two rules
    tmuxscope repair        fix what doctor reported

`go` also takes a path, so `tmuxscope go ~/code/webapp` works without you
remembering the scope name.

Run `doctor` when something feels off. It explains what it found and changes
nothing. `repair` then acts only on the sessions `doctor` named, and
`repair --dry-run` shows you the plan first.

Sessions you made by hand are welcome. A new session is renamed to match its
scope, or folded into that scope's session when one already exists. A session
you are attached to is never dismantled underneath you.

## Turning it off

    TMUXSCOPE_OFF=1

Set it in a shell to stop routing for that shell only. Useful when a script does
a lot of `cd` and you would rather it stayed in one place.

## Everything else

    tmuxscope resolve <path>     which scope owns this path
    tmuxscope rules <path>       the zsh fast path rules for that scope
    tmuxscope hook zsh | tmux    print the glue to install
    tmuxscope --help

Symlinked paths are resolved before matching, so `/tmp/work` and
`/private/tmp/work` land in the same scope.

## Exit codes

    0  clean
    1  the invariant is still broken (doctor found something, repair could not fix everything)
    2  bad input (unknown command, broken config, unknown scope)
    3  wrong environment (route run outside tmux or outside a pane)
    4  a tmux call failed

## Tests

    bun test

## License

MIT
