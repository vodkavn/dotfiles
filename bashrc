# Keep non-interactive shells (including scp) silent.
[[ $- == *i* ]] || return

# Source the first readable candidate. Defined here, rather than in
# bash_functions.bash, because the blocks below use it to load that file too.
source_first_readable() {
    local candidate
    for candidate in "$@"; do
        if [ -r "$candidate" ]; then
            source "$candidate"
            return 0
        fi
    done
    return 1
}

# Color scheme for grep and ls
export CLICOLOR=1
export LSCOLORS=ExFxBxDxCxegedabagacad
export GREP_COLORS='mt=1;35;40'

# Powerful less
export LESS='--quit-if-one-screen --ignore-case --status-column --LONG-PROMPT --RAW-CONTROL-CHARS --HILITE-UNREAD --tabs=4 --no-init --window=-4'
# Short version
# export LESS='-F -i -J -M -R -W -x4 -X -z-4'
# Colorful less
export LESS_TERMCAP_mb=$'\E[1;31m'     # begin bold
export LESS_TERMCAP_md=$'\E[1;36m'     # begin blink
export LESS_TERMCAP_me=$'\E[0m'        # reset bold/blink
export LESS_TERMCAP_so=$'\E[01;44;33m' # begin reverse video
export LESS_TERMCAP_se=$'\E[0m'        # reset reverse video
export LESS_TERMCAP_us=$'\E[1;32m'     # begin underline
export LESS_TERMCAP_ue=$'\E[0m'        # reset underline

# History datetime format
export HISTTIMEFORMAT="%Y/%m/%d %T "

# Default editor
export EDITOR=vim

export TERM="${TERM:-xterm-256color}"

# Git in WSL
export GIT_DISCOVERY_ACROSS_FILESYSTEM=1

# Load RVM into a shell session *as a function*. RVM must be initialized before
# the modules below: rvm.completion.bash reads $rvm_path.
source_first_readable "$HOME/.rvm/scripts/rvm"

# Initialize Node tools before the modules below: npm.completion.bash runs
# `npm completion`, so npm has to exist on PATH by the time it is sourced.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"

# User specific environment and startup programs, including the pnpm bin
# directory, which is added even when missing because corepack can still create
# it. Directories already on PATH are skipped, so re-sourcing bashrc leaves PATH
# unchanged.
for user_bin in "$PNPM_HOME/bin" "$HOME/.local/bin" "$HOME/bin" "$HOME/usr/bin" \
        "$HOME/.bin" "$HOME/.rbenv/bin" "$HOME/.rvm/bin" \
        /usr/local/heroku/bin "$HOME/.ebcli-virtual-env/executables" \
        "$HOME/.pyenv/bin" /usr/local/go/bin "$HOME/.opencode/bin"; do
    if [ -d "$user_bin" ] || [ "$user_bin" = "$PNPM_HOME/bin" ]; then
        case ":$PATH:" in
            *":$user_bin:"*) continue ;;
        esac
        PATH="$user_bin:$PATH"
    fi
done
unset user_bin
export PATH

# Load .bash_functions, then composure, so modules can cite function metadata.
source_first_readable "$HOME/.bash/bash_functions.bash"
source_first_readable "$HOME/.bash/lib/composure.bash"

# Load in the git branch prompt script.
export GIT_PS1_SHOWSTASHSTATE=1
export GIT_PS1_SHOWDIRTYSTATE=1
export GIT_PS1_SHOWCOLORHINTS=1
export GIT_PS1_SHOWUNTRACKEDFILES=""
source_first_readable /usr/lib/git-core/git-sh-prompt \
    /usr/share/git-core/contrib/completion/git-prompt.sh "$HOME/.bash/git-prompt.sh"

# Ubuntu's maintained completions must load before local completion modules.
if ! declare -F _completion_loader >/dev/null; then
    source_first_readable /usr/share/bash-completion/bash_completion
fi

# Load enabled aliases, completion, plugins, then the custom overrides of each.
if declare -F cite >/dev/null; then
    bash_module_types=(aliases completion plugins)
    if declare -F load_bash_files >/dev/null; then
        for file_type in "${bash_module_types[@]}"; do
            load_bash_files "$file_type"
        done
    fi
    for file_type in "${bash_module_types[@]}"; do
        source_first_readable "$HOME/.bash/$file_type/custom.$file_type.bash"
    done
    unset bash_module_types file_type
fi

if declare -F bash_prompt_powerline >/dev/null && [[ " ${PROMPT_COMMAND[*]} " != *" bash_prompt_powerline "* ]]; then
    PROMPT_COMMAND+=(bash_prompt_powerline)
fi
