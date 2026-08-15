#!/usr/bin/env bash
# Installs the TOOL_NAME agent skill into the AI agents you pick.
set -euo pipefail

TOOL="tmuxscope"
REPO="fayez-nazzal/tmuxscope"
BRANCH="main"

BOLD=$'\033[1m'; DIM=$'\033[2m'; GREEN=$'\033[32m'; CYAN=$'\033[36m'; RED=$'\033[31m'; OFF=$'\033[0m'

SCOPE="project"
CHOSEN=""
ASSUME_YES="no"

usage() {
  cat <<EOF
${BOLD}$TOOL skill installer${OFF}

  Installs the $TOOL agent skill so your AI coding agent knows how to use it.

${BOLD}USAGE${OFF}
  install-skill.sh [options]

${BOLD}OPTIONS${OFF}
  --agents <list>   Comma separated. claude,codex,cursor,opencode,grok,antigravity,all
  --scope <where>   project (default) or user
  -y, --yes         Do not ask, use the defaults
  -h, --help        Show this help

${BOLD}EXAMPLES${OFF}
  install-skill.sh
  install-skill.sh --agents claude -y
  install-skill.sh --agents all --scope user -y
EOF
}

while [ $# -gt 0 ]; do
  case "$1" in
    --agents) CHOSEN="${2:-}"; shift 2 ;;
    --scope) SCOPE="${2:-}"; shift 2 ;;
    -y|--yes) ASSUME_YES="yes"; shift ;;
    -h|--help) usage; exit 0 ;;
    *) printf '%s\n' "${RED}Unknown option $1${OFF}" >&2; usage >&2; exit 2 ;;
  esac
done

if [ "$SCOPE" != "project" ] && [ "$SCOPE" != "user" ]; then
  printf '%s\n' "${RED}--scope must be project or user${OFF}" >&2
  exit 2
fi

agent_dir() {
  case "$1:$SCOPE" in
    claude:project) printf '.claude/skills' ;;
    claude:user) printf '%s/.claude/skills' "$HOME" ;;
    codex:project) printf '.agents/skills' ;;
    codex:user) printf '%s/.agents/skills' "$HOME" ;;
    cursor:project) printf '.cursor/skills' ;;
    cursor:user) printf '%s/.cursor/skills' "$HOME" ;;
    opencode:project) printf '.opencode/skills' ;;
    opencode:user) printf '%s/.config/opencode/skills' "$HOME" ;;
    grok:project) printf '.grok/skills' ;;
    grok:user) printf '%s/.grok/skills' "$HOME" ;;
    antigravity:project) printf '.agents/skills' ;;
    antigravity:user) printf '%s/.gemini/config/skills' "$HOME" ;;
  esac
}

ALL_AGENTS="claude codex cursor opencode grok antigravity"
label_for() {
  case "$1" in
    claude) printf 'Claude Code' ;;
    codex) printf 'OpenAI Codex CLI' ;;
    cursor) printf 'Cursor' ;;
    opencode) printf 'opencode' ;;
    grok) printf 'xAI Grok CLI' ;;
    antigravity) printf 'Google Antigravity' ;;
  esac
}

if [ -z "$CHOSEN" ] && [ "$ASSUME_YES" = "yes" ]; then
  CHOSEN="claude"
fi

if [ -z "$CHOSEN" ]; then
  TTY="/dev/tty"
  if [ ! -r "$TTY" ]; then
    printf '%s\n' "${RED}No terminal available. Pass --agents, for example --agents claude -y${OFF}" >&2
    exit 2
  fi
  printf '\n  %s\n' "${BOLD}Install the $TOOL skill${OFF}"
  printf '  %s\n\n' "${DIM}Pick your AI agents. Enter for Claude Code.${OFF}"
  i=1
  for a in $ALL_AGENTS; do
    suffix=""
    if [ "$a" = "claude" ]; then suffix=" ${DIM}(recommended)${OFF}"; fi
    printf '    %s%d%s  %s%s\n' "$CYAN" "$i" "$OFF" "$(label_for "$a")" "$suffix"
    i=$((i + 1))
  done
  printf '    %sa%s  every one of them\n\n' "$CYAN" "$OFF"
  printf '  %s' "Numbers, comma separated: "
  read -r reply < "$TTY" || reply=""
  if [ -z "$reply" ]; then reply="1"; fi
  if [ "$reply" = "a" ]; then
    CHOSEN="all"
  else
    picked=""
    OLDIFS=$IFS; IFS=','
    for token in $reply; do
      token=$(printf '%s' "$token" | tr -d ' ')
      n=1
      for a in $ALL_AGENTS; do
        if [ "$n" = "$token" ]; then picked="$picked,$a"; fi
        n=$((n + 1))
      done
    done
    IFS=$OLDIFS
    CHOSEN="${picked#,}"
  fi
fi

if [ "$CHOSEN" = "all" ]; then
  CHOSEN=$(printf '%s' "$ALL_AGENTS" | tr ' ' ',')
fi

if [ -z "$CHOSEN" ]; then
  printf '%s\n' "${RED}Nothing picked, so nothing was installed.${OFF}" >&2
  exit 2
fi

WORK=$(mktemp -d)
cleanup() { rm -rf "$WORK"; }
trap cleanup EXIT

SRC=""
HERE=$(cd "$(dirname "${BASH_SOURCE[0]:-$0}")" 2>/dev/null && pwd || printf '')
if [ -n "$HERE" ] && [ -f "$HERE/../skills/$TOOL/SKILL.md" ]; then
  SRC="$HERE/../skills/$TOOL/SKILL.md"
else
  URL="https://raw.githubusercontent.com/$REPO/$BRANCH/skills/$TOOL/SKILL.md"
  if ! curl -fsSL "$URL" -o "$WORK/SKILL.md"; then
    printf '%s\n' "${RED}Could not download the skill from $URL${OFF}" >&2
    exit 1
  fi
  SRC="$WORK/SKILL.md"
fi

printf '\n'
installed=0
OLDIFS=$IFS; IFS=','
for agent in $CHOSEN; do
  IFS=$OLDIFS
  dir=$(agent_dir "$agent")
  if [ -z "$dir" ]; then
    printf '  %s  %s\n' "${RED}skipped${OFF}" "unknown agent $agent"
    IFS=','
    continue
  fi
  target="$dir/$TOOL"
  mkdir -p "$target"
  cp "$SRC" "$target/SKILL.md"
  printf '  %s%s%s  %-20s %s\n' "$GREEN" "installed" "$OFF" "$(label_for "$agent")" "${DIM}$target/SKILL.md${OFF}"
  installed=$((installed + 1))
  IFS=','
done
IFS=$OLDIFS

printf '\n  %s\n' "${BOLD}Done. $installed agent(s) now know how to use $TOOL.${OFF}"
printf '  %s\n\n' "${DIM}Start a new agent session so the skill is picked up.${OFF}"
