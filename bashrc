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

bash_prompt() {
    case $TERM in
        xterm*|rxvt*)
            # local TITLEBAR='\[\033]0;\u:${NEW_PWD}\007\]'
            local TITLEBAR='\[\033]0;\h:${NEW_PWD}\007\]'
            ;;
        *)
            local TITLEBAR=""
            ;;
    esac
    local NONE="\[\033[0m\]"  # unsets color to term's fg color

    # regular colors
    local K="\[\033[0;30m\]"  # black
    local R="\[\033[0;31m\]"  # red
    local G="\[\033[0;32m\]"  # green
    local Y="\[\033[0;33m\]"  # yellow
    local B="\[\033[0;34m\]"  # blue
    local M="\[\033[0;35m\]"  # magenta
    local C="\[\033[0;36m\]"  # cyan
    local W="\[\033[0;37m\]"  # white

    # emphasized (bolded) colors
    local EMK="\[\033[1;30m\]"
    local EMR="\[\033[1;31m\]"
    local EMG="\[\033[1;32m\]"
    local EMY="\[\033[1;33m\]"
    local EMB="\[\033[1;34m\]"
    local EMM="\[\033[1;35m\]"
    local EMC="\[\033[1;36m\]"
    local EMW="\[\033[1;37m\]"

    # background colors
    local BGK="\[\033[40m\]"
    local BGR="\[\033[41m\]"
    local BGG="\[\033[42m\]"
    local BGY="\[\033[43m\]"
    local BGB="\[\033[44m\]"
    local BGM="\[\033[45m\]"
    local BGC="\[\033[46m\]"
    local BGW="\[\033[47m\]"

    local UC=$EMY     # user's color
    [ $UID -eq "0" ] && UC=$EMR # root's color

    # extra backslash in front of \$ to make bash colorize the prompt
    # single line
    # PS1="$TITLEBAR${R}[${C}\t${R}]${UC}\u${EMR}@${EMY}\H${W}\w\[\033[m\]\$(prompt_rvm)${EMB}\$(__git_ps1)${EMG}\\$ "
    # new line
    PS1="$TITLEBAR${R}[${C}\t${R}]${UC}\u${EMR}@${EMY}\H${W}\w\[\033[m\]\$(prompt_rvm)${EMB}\$(__git_ps1)${R}\n└${EMG}\\$ "
}

# Git show dirty state
export GIT_PS1_SHOWDIRTYSTATE=true

bash_prompt
unset bash_prompt

# Color scheme for grep and ls
export CLICOLOR=1
export LSCOLORS=GxFxCxDxBxegedabagaced
export GREP_COLOR='1;35;40'

# History datetime format
export HISTTIMEFORMAT="%Y/%m/%d %T "

# Default editor
export EDITOR=vim

export TERM=xterm

# User specific environment and startup programs
PATH=$HOME/usr/bin:$HOME/bin:$PATH
PATH=/usr/local/heroku/bin:$PATH
PATH="$PATH:$HOME/.rvm/bin:$HOME/.rbenv/bin:$HOME/.bin"
export PATH
