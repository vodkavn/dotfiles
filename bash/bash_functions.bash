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
    PS1="$TITLEBAR${R}[${C}\t${R}]${UC}\u${EMR}@${EMY}\H${W}\w\[\033[m\]\$(prompt_rvm)${EMB}\$(__git_ps1 ' (%s)')${R}\n└${EMG}\\$ "
}

bash_prompt_powerline() {
    local GREY="\[\e[48;5;240m\]\[\e[38;5;250m\]"
    local GREY_END="\[\e[48;5;2m\]\[\e[38;5;240m\]"

    local GREEN="\[\e[48;5;2m\]\[\e[38;5;255m\]"
    local GREEN_END="\[\e[48;5;27m\]\[\e[38;5;2m\]"

    local ORANGE="\[\e[48;5;208m\]\[\e[38;5;255m\]"
    local ORANGE_END="\[\e[48;5;236m\]\[\e[38;5;208m\]"

    local BLUE="\[\e[48;5;27m\]\[\e[38;5;255m\]"
    local BLUE_END="\[\e[48;5;208m\]\[\e[38;5;27m\]"           # when next segment is git
    local BLUE_END_EMPTY="\[\e[0m\]\[\e[38;5;27m\]"            # when next segment is none

    local PROMPT="\[\e[48;5;236m\]\[\e[38;5;255m\]"
    local PROMPT_END="\[\e[0m\]\[\e[38;5;236m\]\[\e[0m\] "

    local ORANGE_TEXT="\[\e[38;5;208m\]"
    local NONE="\[\e[0m\]"

    if [ ! -w "$PWD" ]; then
        # Current directory is not writable
        BLUE_END="\[\e[48;5;160m\]\[\e[38;5;27m\]\[\e[38;5;255m\]  \[\e[48;5;208m\]\[\e[38;5;160m\]"
    fi

    PS1="$GREY \t $GREY_END$GREEN \u@\h $GREEN_END$BLUE \w $BLUE_END_EMPTY $ORANGE_TEXT\$(__git_ps1 ' (%s)')\n$NONE\\$ "
}

#------------------------------------------////
# System Information:
#------------------------------------------////
# clear
# echo -e "${LIGHTGRAY}";figlet "Terminal Fu";
# echo -ne "${red}Today is:\t\t${cyan}" `date`; echo ""
# echo -e "${red}Kernel Information: \t${cyan}" `uname -smr`
# echo -ne "${cyan}";upinfo;echo ""
# echo -e "${cyan}"; cal -3
