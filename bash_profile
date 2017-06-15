# .bash_profile

# Get the aliases and functions
if [ -f ~/.bashrc ]; then
	. ~/.bashrc
fi



# User specific environment and startup programs

PATH=$HOME/usr/bin:$HOME/bin:$PATH
PATH=/usr/local/heroku/bin:$PATH
PATH=/usr/lib64/qt5/bin:/usr/local/rvm/gems/ruby-2.4.1@rails/bin:/usr/local/rvm/gems/ruby-2.4.1@global/bin:/usr/local/rvm/rubies/ruby-2.4.1/bin:/usr/local/rvm/bin:/root/usr/bin:/root/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin:$PATH

export PATH
