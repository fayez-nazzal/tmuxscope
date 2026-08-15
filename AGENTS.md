# AGENTS.md

`tmuxscope` keeps one tmux session per project scope and one scope per session. For an AI coding agent it is a checker and a fixer, not a session launcher. Other tmux managers build sessions from a config file and then stop caring. `tmuxscope doctor` reads the tmux server as it is right now, names every place the invariant is broken, and `tmuxscope repair` moves the windows to put it back. Every command an agent needs speaks JSON on `--json`, and every outcome is a distinct exit code, so you can branch without parsing prose.

`README.md` is the flag reference. This file is the order to do things in.

## Golden rules

- Always run `tmuxscope doctor --json` before you decide anything. It changes nothing.
- Always run `tmuxscope repair --dry-run --json` before a real `tmuxscope repair`. The dry run prints the exact action list and touches nothing.
- Never treat exit code `1` from `doctor` as a crash. It is the finding. It means the invariant is broken.
- Read `problems` and `config` from the JSON, not the human table. The table is for people.
- Do not pull the whole tmux state into context. `tmuxscope list --json` and `tmuxscope doctor --json` are already the summary. Do not shell out to `tmux list-windows` yourself.
- Assert on JSON fields, never on message text. Strings like `→ web  session created, origin pane restored` are not a contract.
- Never call `tmuxscope route` yourself. It is a `chpwd` hook entry point and it needs environment variables the shell hook sets. See `Pitfalls`.
- Set `TMUXSCOPE_CONFIG` to a scratch file when you want to test without touching the config of the person you work for.
- `tmuxscope go` and `tmuxscope repair` change the live tmux server. Ask before running either on a machine somebody is working on.
- Requires `tmux` on `PATH`. Requires the compiled binary at `dist/tmuxscope`, so run `bun run build` after a fresh clone.

## Recipes

### 1. Check the invariant and stop

Proves whether the tmux server is clean, without changing anything.

```sh
tmuxscope doctor --json
echo "exit=$?"
```

Exit `0` means clean. Exit `1` means there is something to report or fix.

### 2. Plan a repair, then apply it

Proves what `repair` would do, then does it, then proves the result.

```sh
tmuxscope repair --dry-run --json
tmuxscope repair --json
echo "exit=$?"
```

The second call carries an `after` field holding a fresh `doctor` report. If `after.problems` is `0`, the tmux side of the invariant is whole again.

### 3. Ask which scope owns a path

Proves the routing decision for one directory, with no tmux server needed.

```sh
tmuxscope resolve /tmp/demo/web --json
```

A path nobody claims resolves to the built-in scope `misc` with `"matched": null`.

### 4. Take an inventory of scopes and sessions

Proves which scopes have a session and which do not.

```sh
tmuxscope list --json
```

## Reading the output

### `doctor --json`

Real output from a tmux server holding a session named `api` with one window in `/tmp/demo/api` and one in `/tmp/demo/web`, plus a second session named `stray` also sitting in `/tmp/demo/api`.

```json
{
  "mixed": [
    {
      "session": "api",
      "windows": [
        { "index": 0, "path": "/private/tmp/demo/api", "scope": "api" },
        { "index": 1, "path": "/private/tmp/demo/web", "scope": "web" }
      ]
    }
  ],
  "split": [
    { "scope": "api", "sessions": ["api", "stray"] }
  ],
  "ambiguous": [
    { "session": "api", "candidates": ["api", "web"], "count": 1, "rule": "session name matches scope name" }
  ],
  "problems": 3,
  "config": [
    { "kind": "ambiguousLength", "scopes": ["api", "web"], "length": 13 }
  ]
}
```

Assert on these.

- `mixed` lists sessions holding windows from more than one scope.
- `split` lists scopes owning more than one session.
- `ambiguous` lists sessions where no scope holds a clear majority of the windows.
- `problems` is the sum of those three lengths. It does not count `config`.
- `config` lists problems in the scopes file itself. Known `kind` values are `ambiguousLength`, `missingDirectory`, `duplicateDirectory` and `questionMark`.

Exit `1` fires when `problems` is above zero **or** `config` is not empty. So this real output exits `1` even though the tmux server is clean.

```json
{
  "mixed": [],
  "split": [],
  "ambiguous": [],
  "problems": 0,
  "config": [
    { "kind": "ambiguousLength", "scopes": ["api", "web"], "length": 13 }
  ]
}
```

To decide whether tmux itself needs fixing, read `problems`. To decide whether the scopes file needs an edit, read `config`.

### `repair --dry-run --json`

```json
{
  "actions": [
    { "kind": "new-session", "name": "web", "cwd": "/private/tmp/demo/web" },
    { "kind": "move-window", "windowId": "@0", "session": "stray" },
    { "kind": "move-window", "windowId": "@1", "session": "web" }
  ],
  "unsatisfiable": [],
  "applied": false
}
```

`applied` is `false` on every dry run. Exit code is `0` even when there is a long plan.

### `repair --json`

```json
{
  "actions": [
    { "kind": "new-session", "name": "web", "cwd": "/private/tmp/demo/web" },
    { "kind": "move-window", "windowId": "@0", "session": "stray" },
    { "kind": "move-window", "windowId": "@1", "session": "web" }
  ],
  "unsatisfiable": [],
  "applied": true,
  "after": {
    "mixed": [],
    "split": [],
    "ambiguous": [],
    "problems": 0
  }
}
```

- `applied` is `true` only when every action landed.
- `after` is a `doctor` report with no `config` key. `repair` never checks the scopes file, so a config finding will not make `repair` exit `1`.
- A failed tmux call replaces `after` with an `error` string and exits `4`.
- Moves that cannot be ordered without a spare session land in `unsatisfiable`, with `actions` empty and exit `1`.

### `resolve --json`

```json
{
  "scope": "api",
  "matched": "/tmp/demo/api",
  "path": "/tmp/demo/api/src"
}
```

`matched` is the winning pattern, or `null` when the answer is `misc`.

### `list --json`

```json
{
  "rows": [
    { "scope": "api", "session": "api", "windows": 2, "attached": false, "patterns": ["/tmp/demo/api"] },
    { "scope": "web", "session": "", "windows": 0, "attached": false, "patterns": ["/tmp/demo/web"] },
    { "scope": "misc", "session": "", "windows": 0, "attached": false, "patterns": [] }
  ]
}
```

An empty `session` string means no tmux session owns that scope yet. The `misc` row always has an empty `patterns` array.

### Exit codes

| Code | Meaning | Real trigger |
| --- | --- | --- |
| `0` | clean | `doctor` found nothing, or `repair --dry-run` printed a plan |
| `1` | the invariant is still broken | `doctor` found problems or config findings, `repair` left problems behind, or `unsatisfiable` is not empty |
| `2` | bad input | `tmuxscope bogus`, `tmuxscope go nope`, or a scopes file line that is not `name = paths` |
| `3` | wrong environment | `route` run outside tmux or without `TMUX_PANE` |
| `4` | a tmux call failed | any `tmux` subprocess exited non zero |

Real captures.

```
$ tmuxscope bogus
unknown command bogus, try --help
exit=2

$ tmuxscope go nope
no scope named nope
known scopes: api web misc
exit=2

$ TMUXSCOPE_CONFIG=/tmp/demo/bad.conf tmuxscope list
/tmp/demo/bad.conf line 1: expected "name = paths", got oops
exit=2

$ tmuxscope route /tmp/demo/web
route only runs inside tmux
exit=3
```

## Pitfalls

| Symptom | Cause | Fix |
| --- | --- | --- |
| `route` prints a message but the shell stays in the wrong directory | `route` writes the return path into the file named by `TMUXSCOPE_CD_FILE` and a kill-pane line into `TMUXSCOPE_EXEC_FILE`. It never prints those paths, and it silently skips the write when the variable is empty. | Let the zsh hook call it. It creates both files, sources them, then deletes them. If you must call `route` by hand, set both variables to files you created and read them after. |
| `route` exits `3` with `route only runs inside tmux` | `TMUX` is not set in the environment. | Run it from a tmux pane, or leave it to the hook. |
| `route` exits `3` with `route needs TMUX_PANE` | `TMUX` is set but `TMUX_PANE` is not. | Pass the real pane id. Do not invent one. |
| `doctor` exits `1` but `problems` is `0` | A `config` finding is present. Exit `1` covers both the tmux state and the scopes file. | Read `config`. Fix the scopes file. `repair` cannot help here. |
| `repair` exits `0` yet the next `doctor` exits `1` | `repair` only reports the tmux side. It never inspects the scopes file. | Compare `after.problems` from `repair` against the `config` array from `doctor`. |
| `--json` produced nothing on stdout | The command hit exit `4`. The tmux failure is written to stderr as plain text, not JSON. | Check the exit code first, then read stderr. Never parse stdout without checking the code. |
| Every path resolves to `misc` | No scopes file was found. A missing file loads as zero scopes with no error. | Point `TMUXSCOPE_CONFIG` at a real file, or create `~/.config/tmux-scopes.conf`. |
| Two scopes fight over the same directory | Patterns are scored by length and the longer one wins. Equal length means config order breaks the tie. | Look for `ambiguousLength` in the `config` array and make one pattern more specific. |
| `TMUXSCOPE_OFF=1` did not stop anything | Only the zsh `chpwd` hook reads that variable. The binary ignores it completely. | Use it to quiet a script that runs a lot of `cd`. Do not expect it to disable a direct command. |
| A pattern with a star matches nothing | A star is only allowed in the last part of a path. `~/code/api-*` is valid, `~/*/api` is rejected at parse time with exit `2`. | Rewrite the pattern so the star sits in the final segment. |
| Paths in the output do not match the paths you passed | Symlinks are resolved before matching, so `/tmp/demo` shows up as `/private/tmp/demo` on macOS. | Compare canonical paths, or compare the `scope` field instead of the path. |

## Reporting

Tell the person these things and nothing more.

- The verdict, in one line. Clean, or the invariant is broken.
- The exit code you saw and what it means.
- For a break, name each `mixed` session, each `split` scope and each `ambiguous` session by name. Counts, not window dumps.
- For a config finding, name the `kind` and the scopes involved, plus the file you read it from.
- If you ran a repair, say whether you ran the dry run first, how many actions were in the plan, and what `after.problems` came back as.
- Give the path of the scopes file you used. Do not paste its contents unless asked.
- Never paste raw JSON or a full tmux window listing into the reply. Summarise it.
