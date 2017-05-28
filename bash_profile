# .bash_profile

# Get the aliases and functions
if [ -f ~/.bashrc ]; then
	. ~/.bashrc
fi

# Show ruby version
function prompt_rvm {
    rbv=`rvm-prompt`
    #rbv=${rbv#ruby-}
    [[ $rbv == *"@"* ]] || rbv="${rbv}@default"
    echo "["$rbv"]"
}

# User specific environment and startup programs

PATH=$HOME/usr/bin:$HOME/bin:$PATH

export PATH
PATH=/usr/lib64/qt5/bin:/usr/local/rvm/gems/ruby-2.4.1@rails/bin:/usr/local/rvm/gems/ruby-2.4.1@global/bin:/usr/local/rvm/rubies/ruby-2.4.1/bin:/usr/local/rvm/bin:/root/usr/bin:/root/bin:/usr/local/sbin:/usr/local/bin:/usr/sbin:/usr/bin
