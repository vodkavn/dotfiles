# Fix scp
[ -z "$PS1" ] && return
# Load RVM into a shell session *as a function*
[[ -s "$HOME/.rvm/scripts/rvm" ]] && source "$HOME/.rvm/scripts/rvm"

# Load .bash_functions
if [ -f $HOME/.bash/bash_functions.bash ]; then
    . $HOME/.bash/bash_functions.bash
fi

# Load composure first, so we support function metadata
source $HOME/.bash/lib/composure.bash

# Load in the git branch prompt script.
source $HOME/.bash/git-prompt.sh

# Load enabled aliases, completion, plugins
for file_type in "aliases" "completion" "plugins"
do
    load_bash_files $file_type
done

# Load custom aliases, completion, plugins
for file_type in "aliases" "completion" "plugins"
do
    if [ -e "$HOME/.bash/${file_type}/custom.${file_type}.bash" ]; then
        source "$HOME/.bash/${file_type}/custom.${file_type}.bash"
    fi
done

export PROMPT_COMMAND=bash_prompt_powerline

# Color scheme for grep and ls
export CLICOLOR=1
export LSCOLORS=ExFxBxDxCxegedabagacad
export GREP_COLOR='1;35;40'

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

export TERM=xterm-256color

# Git in WSL
export GIT_DISCOVERY_ACROSS_FILESYSTEM=1

# Config for nvm
export NVM_DIR="$HOME/.nvm"
[ -s "$NVM_DIR/nvm.sh" ] && \. "$NVM_DIR/nvm.sh"  # This loads nvm
[ -s "$NVM_DIR/bash_completion" ] && \. "$NVM_DIR/bash_completion"  # This loads nvm bash_completion

# User specific environment and startup programs
PATH=$HOME/usr/bin:$HOME/bin:$HOME/.local/bin:$PATH
PATH=$HOME/.rvm/bin:$HOME/.rbenv/bin:$HOME/.bin:$PATH
PATH=/usr/local/heroku/bin:$PATH
PATH=$HOME/.ebcli-virtual-env/executables:$PATH
PATH=$HOME/.pyenv/versions/3.7.2/bin:$PATH

export PATH
