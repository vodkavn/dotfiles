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

# Colored grep
alias grep='grep --color=auto'
alias fgrep='fgrep --color=auto'
alias egrep='egrep --color=auto'

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
if [ ! -x "$(which tree 2>/dev/null)" ]
then
  alias tree="find . -print | sed -e 's;[^/]*/;|____;g;s;____|; |;g'"
fi

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

# Shorten extract
alias xt='extract'

# Alias explanation
alias t='type'

# Man or tldr
if which tldr &> /dev/null
then
  alias m='tldr'
else
  alias m='man'
fi
