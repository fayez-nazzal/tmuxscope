import { homedir } from "node:os";

export const ZSH_HOOK = `autoload -Uz add-zsh-hook

_tmuxscope_preexec() {
  case "$1" in
    *'&'*|*';'*|*'|'*|*$'\\n'*) ;;
    cd|cd\\ *|z|z\\ *|pushd|pushd\\ *|popd|popd\\ *) return ;;
  esac
  tmux set-option -p @tmuxscope_work 1 2>/dev/null
}

_tmuxscope_rules() {
  export TMUXSCOPE_RULES="$(command tmuxscope rules "$PWD")"
}

_tmuxscope_chpwd() {
  [[ -n "$TMUX" && -z "$TMUXSCOPE_OFF" ]] || return
  local TMUXSCOPE_OFF=1
  setopt localoptions extended_glob
  local rule
  for rule in \${(f)TMUXSCOPE_RULES}; do
    if [[ "$PWD" == \${~rule[2,-1]} ]]; then
      [[ "\${rule[1]}" == "+" ]] && return
      break
    fi
  done
  local cd_file exec_file previous
  previous="$OLDPWD"
  cd_file="$(mktemp)"
  exec_file="$(mktemp)"
  TMUXSCOPE_ORIGIN="$previous" TMUXSCOPE_CD_FILE="$cd_file" TMUXSCOPE_EXEC_FILE="$exec_file" command tmuxscope route "$PWD" || print -u2 "tmuxscope: route failed, this pane stayed put"
  if [[ -s "$cd_file" ]]; then
    builtin cd -- "$(<"$cd_file")"
  fi
  _tmuxscope_rules
  if [[ -s "$exec_file" ]]; then
    source "$exec_file"
  fi
  rm -f "$cd_file" "$exec_file"
}

_tmuxscope_init() {
  [[ -n "$TMUX" ]] || return
  _tmuxscope_rules
}

add-zsh-hook chpwd _tmuxscope_chpwd
add-zsh-hook preexec _tmuxscope_preexec
_tmuxscope_init
`;

export const TMUX_ADOPT_COMMAND = "tmuxscope adopt '#{session_id}'";

const TMUX_HOME = homedir().replaceAll("|", "\\|");
const TMUX_PANE_PATH = `#{?#{!=:#{@tmuxscope-pane-path},0},#{s|^${TMUX_HOME}|~|:pane_current_path},}`;
const TMUX_PANE_PATH_FORMAT = ` #[fg=colour245]${TMUX_PANE_PATH}#[default]`;
const TMUX_ORGANIZE_HOOK = `if-shell -F "#{!=:#{@tmuxscope-organize-panes},0}" "run-shell 'tmuxscope organize --hook'"`;
const TMUX_PATH_HOOK = `if-shell -F "#{!=:#{@tmuxscope-pane-path-installed},1}" "set-option -g pane-border-status top \\; set-option -ag pane-border-format '${TMUX_PANE_PATH_FORMAT}' \\; set-option -g @tmuxscope-pane-path-installed 1"`;

export const TMUX_HOOK = `set-hook -g session-created "run-shell \\"${TMUX_ADOPT_COMMAND}\\""
set-hook -g after-split-window "${TMUX_ORGANIZE_HOOK}"
set-hook -g pane-focus-in "${TMUX_ORGANIZE_HOOK}"
${TMUX_PATH_HOOK}
`;
