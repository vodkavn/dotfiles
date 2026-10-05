# Keep non-interactive shells (including scp) silent.
[[ $- == *i* ]] || return
# Load RVM into a shell session *as a function*
[[ -s "$HOME/.rvm/scripts/rvm" ]] && source "$HOME/.rvm/scripts/rvm"

# Initialize Node tools before registering their aliases and completions.
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"

# pnpm
export PNPM_HOME="$HOME/.local/share/pnpm"
case ":$PATH:" in
    *":$PNPM_HOME/bin:"*) ;;
    *) export PATH="$PNPM_HOME/bin:$PATH" ;;
esac

# Load .bash_functions
if [ -r "$HOME/.bash/bash_functions.bash" ]; then
    . "$HOME/.bash/bash_functions.bash"
fi

# Load composure first, so we support function metadata
if [ -r "$HOME/.bash/lib/composure.bash" ]; then
    source "$HOME/.bash/lib/composure.bash"
fi

# Load in the git branch prompt script.
export GIT_PS1_SHOWSTASHSTATE=1
export GIT_PS1_SHOWDIRTYSTATE=1
export GIT_PS1_SHOWCOLORHINTS=1
export GIT_PS1_SHOWUNTRACKEDFILES=""
for git_prompt_file in /usr/lib/git-core/git-sh-prompt /usr/share/git-core/contrib/completion/git-prompt.sh "$HOME/.bash/git-prompt.sh"; do
    if [ -r "$git_prompt_file" ]; then
        source "$git_prompt_file"
        break
    fi
done
unset git_prompt_file

# Ubuntu's maintained completions must load before local completion modules.
if ! declare -F _completion_loader >/dev/null && [ -r /usr/share/bash-completion/bash_completion ]; then
    source /usr/share/bash-completion/bash_completion
fi

# Load enabled aliases, completion, plugins
for file_type in "aliases" "completion" "plugins"
do
    if declare -F load_bash_files >/dev/null && declare -F cite >/dev/null; then
        load_bash_files "$file_type"
    fi
done

# Load custom aliases, completion, plugins
for file_type in "aliases" "completion" "plugins"
do
    if declare -F cite >/dev/null && [ -r "$HOME/.bash/${file_type}/custom.${file_type}.bash" ]; then
        source "$HOME/.bash/${file_type}/custom.${file_type}.bash"
    fi
done
unset file_type

if declare -F bash_prompt_powerline >/dev/null && [[ " ${PROMPT_COMMAND[*]} " != *" bash_prompt_powerline "* ]]; then
    PROMPT_COMMAND+=(bash_prompt_powerline)
fi

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

# User specific environment and startup programs
for user_bin in "$HOME/.local/bin" "$HOME/bin" "$HOME/usr/bin" \
    "$HOME/.bin" "$HOME/.rbenv/bin" "$HOME/.rvm/bin" \
    /usr/local/heroku/bin "$HOME/.ebcli-virtual-env/executables" \
    "$HOME/.pyenv/bin" /usr/local/go/bin; do
    if [ -d "$user_bin" ]; then
        case ":$PATH:" in
            *":$user_bin:"*) ;;
            *) PATH="$user_bin:$PATH" ;;
        esac
    fi
done
unset user_bin
export PATH
