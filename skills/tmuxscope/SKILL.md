---
name: tmuxscope
description: Checks and repairs the tmux invariant of one session per project scope and one scope per session, with JSON output and distinct exit codes on every command. Use when the user says tmux sessions are a mess, asks to audit, check, clean up, tidy, reorganize or fix tmux sessions and windows, asks which tmux session a directory belongs to, asks to move windows into the right session, mentions tmuxscope, doctor, repair, scopes or the scopes file `~/.config/tmux-scopes.conf`, asks why one project is spread over two tmux sessions, or asks for an inventory of tmux scopes and sessions.
license: MIT
compatibility: Needs `tmux` and the compiled `tmuxscope` binary on `PATH`. Build with `bun run build` after a fresh clone.
metadata:
  author: Fayez Nazzal
  version: "0.2.0"
---

# tmuxscope

Reads the live tmux server, names every place the one scope per session invariant is broken, and moves windows to put it back.

## When to use

- The user wants to know whether the tmux sessions are clean.
- One project is spread over two sessions, or one session holds windows from two projects.
- The user wants windows moved back into the right session.
- The user asks which scope owns a directory.
- The user wants a list of scopes and which ones have a session.
- The scopes file itself looks wrong.

## Check first

```sh
command -v tmux && command -v tmuxscope
```

- No `tmuxscope` on `PATH` means run `bun run build` in the repo and use `dist/tmuxscope`.
- Set `TMUXSCOPE_CONFIG` to a scratch file when testing, so the config of the person you work for stays untouched.

## Core recipe

Check, plan, then apply.

```sh
tmuxscope doctor --json
tmuxscope repair --dry-run --json
tmuxscope repair --json
echo "exit=$?"
```

- Assert `problems` is `0` and `config` is empty in the `doctor` output.
- Assert the dry run `actions` list is what you expect and `unsatisfiable` is empty.
- After the real repair assert `applied` is `true` and `after.problems` is `0`.
- `repair` and `go` change the live tmux server. Ask before running either on a machine somebody is working on.

## Reading the result

- `doctor --json` gives `mixed`, `split`, `ambiguous`, `problems` and `config`. `problems` is the sum of the first three lengths and does not count `config`.
- `config` findings use `kind` values `ambiguousLength`, `missingDirectory`, `duplicateDirectory` and `questionMark`.
- `repair --json` gives `actions`, `unsatisfiable`, `applied` and `after`. `after` is a `doctor` report with no `config` key.
- `resolve --json` gives `scope`, `matched` and `path`. `matched` is `null` when the answer is `misc`.
- `list --json` gives `rows` with `scope`, `session`, `windows`, `attached` and `patterns`. An empty `session` means no session owns that scope.

Exit codes.

- `0` clean, or a dry run plan was printed.
- `1` the invariant is still broken, or `config` is not empty, or `unsatisfiable` is not empty.
- `2` bad input, such as an unknown command or a bad scopes file line.
- `3` wrong environment, such as `route` outside tmux.
- `4` a tmux call failed. Nothing lands on stdout, the error goes to stderr as plain text.

## Rules

- Run `doctor --json` before deciding anything. It changes nothing.
- Run `repair --dry-run --json` before every real `repair`.
- Exit `1` from `doctor` is the finding, not a crash.
- Assert on JSON fields, never on message text.
- Never call `tmuxscope route` yourself. It is a `chpwd` hook entry point and needs variables the shell hook sets.
- Do not shell out to `tmux list-windows`. Do not paste raw JSON or a window dump into the reply, summarise it.

Full recipes, output samples and pitfalls live in `AGENTS.md` in the repo.
