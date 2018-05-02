# .bash_profile

# Get the aliases and functions
if [ -f ~/.bashrc ]; then
	. ~/.bashrc
fi

# User specific environment and startup programs

PATH=$HOME/usr/bin:$HOME/bin:$PATH
PATH=/usr/local/heroku/bin:$PATH

export PATH
