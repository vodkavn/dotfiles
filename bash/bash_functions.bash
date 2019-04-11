### FUNCTIONS

upinfo ()
{
    echo -ne "${green}$HOSTNAME ${red}uptime is ${cyan} \t ";uptime | awk /'up/ {print $3,$4,$5,$6,$7,$8,$9,$10}'
}

# Check command exists
function _command_exists() {
    type "$1" &> /dev/null ;
}

# Show ruby version
function prompt_rvm {
    if _command_exists rvm-prompt; then
        rbv=`rvm-prompt`
    fi
    if _command_exists rbenv; then
        eval "$(rbenv init -)"
        rbv=`rbenv version-name`
    fi
    if [[ -n "${rbv/[ ]*\n/}" ]]; then
        #rbv=${rbv#ruby-}
        [[ $rbv == *"@"* ]] || rbv="${rbv}@default"
        echo "["$rbv"]"
    else
        echo ""
    fi
}

# Helper function loading various enable-able files
function load_bash_files() {
    subdirectory="$1"
    if [ -d "$HOME/.bash/${subdirectory}/enable" ]
    then
        FILES="$HOME/.bash/${subdirectory}/enable/*.bash"
        for config_file in $FILES
        do
            if [ -e "${config_file}" ]; then
                source $config_file
            fi
        done
    fi
}

if ! type pathmunge > /dev/null 2>&1
then
    function pathmunge () {
        about 'prevent duplicate directories in you PATH variable'
        group 'helpers'
        example 'pathmunge /path/to/dir is equivalent to PATH=/path/to/dir:$PATH'
        example 'pathmunge /path/to/dir after is equivalent to PATH=$PATH:/path/to/dir'

        if ! [[ $PATH =~ (^|:)$1($|:) ]] ; then
            if [ "$2" = "after" ] ; then
                export PATH=$PATH:$1
            else
                export PATH=$1:$PATH
            fi
        fi
    }
fi

#------------------------------------------////
# System Information:
#------------------------------------------////
# clear
# echo -e "${LIGHTGRAY}";figlet "Terminal Fu";
# echo -ne "${red}Today is:\t\t${cyan}" `date`; echo ""
# echo -e "${red}Kernel Information: \t${cyan}" `uname -smr`
# echo -ne "${cyan}";upinfo;echo ""
# echo -e "${cyan}"; cal -3
