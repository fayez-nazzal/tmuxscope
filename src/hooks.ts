export const ZSH_HOOK = `autoload -Uz add-zsh-hook

_tmuxscope_preexec() {
  case "$1" in
    cd|cd\\ *|z|z\\ *|pushd|pushd\\ *|popd|popd\\ *) return ;;
  esac
  tmux set-option -p @tmuxscope_work 1 2>/dev/null
}

_tmuxscope_chpwd() {
  [[ -n "$TMUX" && -z "$TMUXSCOPE_OFF" ]] || return
  local pattern
  for pattern in \${=TMUXSCOPE_GLOBS}; do
    [[ "$PWD" == \${~pattern} ]] && return
  done
  local cd_file exec_file previous
  previous="$OLDPWD"
  cd_file="$(mktemp)"
  exec_file="$(mktemp)"
  TMUXSCOPE_ORIGIN="$previous" TMUXSCOPE_CD_FILE="$cd_file" TMUXSCOPE_EXEC_FILE="$exec_file" command tmuxscope route "$PWD"
  if [[ -s "$cd_file" ]]; then
    builtin cd -- "$(<"$cd_file")"
    export TMUXSCOPE_GLOBS="$(command tmuxscope globs "$PWD")"
  fi
  if [[ -s "$exec_file" ]]; then
    source "$exec_file"
  fi
  rm -f "$cd_file" "$exec_file"
}

_tmuxscope_init() {
  [[ -n "$TMUX" ]] || return
  export TMUXSCOPE_GLOBS="$(command tmuxscope globs "$PWD")"
}

add-zsh-hook chpwd _tmuxscope_chpwd
add-zsh-hook preexec _tmuxscope_preexec
_tmuxscope_init
`;

export const TMUX_HOOK = `set-hook -g session-created 'run-shell "tmuxscope adopt #{session_id}"'
`;
