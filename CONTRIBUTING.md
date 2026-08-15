# Contributing

Thanks for helping out. Small focused changes are the easiest to land.

## Setup

    git clone https://github.com/fayez-nazzal/tmuxscope.git
    cd tmuxscope
    bun install
    bun run build

You also need `tmux` 3.0 or newer and `zsh` on your machine. One test drives a real tmux server.

## Tests

    bun test

Every test must pass before you open a pull request.

## Code style

- No code comments. Names carry the meaning.
- One return at the end of a function. No early return and no guard clause.
- One line per declaration, assignment, argument and call.
- `if` statements instead of ternaries.
- Explicit braces and explicit parentheses always.
- Plain checks instead of clever operators.

## Proposing a change

- Open an issue first for anything that changes behaviour or output.
- Keep the diff to what the issue asks for.
- Add a test for every bug fix and every new behaviour.
- Update `README.md` when you change a command, a flag or an exit code.
- Fill in the pull request template.
