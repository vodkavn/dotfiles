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

bash_prompt_powerline
unset bash_prompt_powerline

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
