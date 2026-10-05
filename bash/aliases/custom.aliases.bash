cite 'about-alias'
about-alias 'personal custom aliases'

# Sudo
alias _='sudo'

# List directory contents
if ls --color -d . &> /dev/null
then
  alias ls='ls --color=auto'
elif ls -G -d . &> /dev/null
then
  alias ls='ls -G'        # Compact view, show colors
fi
alias sl=ls
alias la='ls -AF'       # Compact view, show hidden
alias ll='ls -al'
alias l='ls -a'
alias l1='ls -1'

# Ubuntu/Debian executable names
if ! command -v fd >/dev/null 2>&1 && command -v fdfind >/dev/null 2>&1; then
    alias fd='fdfind'
fi
if ! command -v bat >/dev/null 2>&1 && command -v batcat >/dev/null 2>&1; then
    alias bat='batcat'
fi

# Colored grep
# fgrep/egrep are deprecated GNU grep wrappers; use grep -F / grep -E directly
alias grep='grep --color=auto'
alias fgrep='grep -F --color=auto'
alias egrep='grep -E --color=auto'

# Search process
alias psg='ps aux | grep '

# Terminal
alias c='clear'
alias k='clear'
alias cls='clear'
alias q='exit'

# Language aliases
alias rb='ruby'
alias py='python'
alias ipy='ipython'

# Shell History
alias h='history'
alias hs='history'

# Tree
# No alias is defined when `tree` is unavailable: the previous find|sed
# fallback produced a weaker, differently-formatted listing. Install `tree`
# if you want a `tree` command.

# Directory
alias md='mkdir -p'
alias rd='rmdir'

# Directory navigate
alias dc=cd              # typo
alias ..='cd ..'         # Go up one directory
alias cd..='cd ..'       # Common misspelling for going up one directory
alias ...='cd ../..'     # Go up two directories
alias ....='cd ../../..' # Go up three directories
alias -- -='cd -'        # Go back
alias ,,='cd ..'         # Go up one directory (typo)
alias ,,,='cd ../..'     # Go up two directories (typo)
alias ,,,,='cd ../../..' # Go up three directories (typo)

# VS Code
alias 'code'='code .'
alias 'code.'='code .'

# Shorten extract
alias xt='extract'

# Alias explanation
alias t='type'

# Man or tldr
if command -v tldr &> /dev/null
then
  alias m='tldr'
else
  alias m='man'
fi

# Xargs with alias
# alias: alias [-p] [name[=value] ... ]
# A trailing space in value causes the next word to be checked for alias substitution when the alias is expanded.
alias xargs='xargs '
alias x='xargs '
