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

export const TMUX_HOOK = `set-hook -g session-created "run-shell \\"${TMUX_ADOPT_COMMAND}\\""
`;
