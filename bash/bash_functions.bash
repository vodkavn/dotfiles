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

function load_colors_16() {
    for fgbg in 38 48 ; do # Foreground / Background
        for color in {0..15} ; do # Colors
            # Display the color
            printf "\e[${fgbg};5;%sm  %3s  \e[0m" $color $color
            # Display 8 colors per lines
            if [ $((($color + 1) % 8)) == 0 ] ; then
                echo # New line
            fi
        done
        echo # New line
    done
}

function load_colors_256() {
    for fgbg in 38 48 ; do # Foreground / Background
        for color in {0..255} ; do # Colors
            # Display the color
            printf "\e[${fgbg};5;%sm  %3s  \e[0m" $color $color
            # Display 6 colors per lines
            if [ $((($color + 1) % 6)) == 4 ] ; then
                echo # New line
            fi
        done
        echo # New line
    done
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

function bash_prompt() {
    case $TERM in
        xterm*|rxvt*)
            local TITLEBAR='\[\033]0;\u@\h:$PWD\007\]'
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
    PS1="$TITLEBAR${R}[${C}\t${R}]${UC}\u${EMR}@${EMY}\H${W}\w\[\033[m\]\$(prompt_rvm)${EMB}\$(__git_ps1 ' (%s)')\n${EMG}\$ "
}

function bash_prompt_powerline() {
    case $TERM in
        xterm*|rxvt*)
            local TITLEBAR='\[\033]0;\u@\h:$PWD\007\]'
            ;;
        *)
            local TITLEBAR=""
            ;;
    esac

    local TIME_COLOR="141m"
    local INFO_COLOR="61m"
    local DIRECTORY_COLOR="59m"
    local GIT_COLOR="117m"
    local LOCK_COLOR="203m"
    local PROMPT_COLOR="84m"
    local TEXT_COLOR="231m"
    local FOREGROUND_COLOR="231m"
    local BACKGROUND_COLOR="17m"

    local NONE="\[\e[0m\]"
    local GIT_TEXT="\[\e[38;5;$GIT_COLOR\]"
    local NORMAL_TEXT="\[\e[38;5;$TEXT_COLOR\]"

    local TIME_START="\[\e[48;5;$TIME_COLOR\]\[\e[38;5;$BACKGROUND_COLOR\]"
    local TIME_END_INFO="\[\e[48;5;$INFO_COLOR\]\[\e[38;5;$TIME_COLOR\]"
    local TIME_END_DIRECTORY="\[\e[48;5;$DIRECTORY_COLOR\]\[\e[38;5;$TIME_COLOR\]"

    local INFO_START="\[\e[48;5;$INFO_COLOR\]\[\e[38;5;$FOREGROUND_COLOR\]"
    local INFO_END="\[\e[48;5;$DIRECTORY_COLOR\]\[\e[38;5;$INFO_COLOR\]"

    local DIRECTORY_START="\[\e[48;5;$DIRECTORY_COLOR\]\[\e[38;5;$FOREGROUND_COLOR\]"
    local DIRECTORY_END="$NONE\[\e[38;5;$DIRECTORY_COLOR\]"            # when next segment is none

    if [ ! -w "$PWD" ]; then
        # Current directory is not writable
        DIRECTORY_END="\[\e[48;5;$LOCK_COLOR\]\[\e[38;5;$DIRECTORY_COLOR\]\[\e[38;5;$FOREGROUND_COLOR\]  $NONE\[\e[38;5;$LOCK_COLOR\]"
    fi

    PS1="$GIT_TEXT\$(__git_ps1 ' (%s)')\n\[\e[38;5;$PROMPT_COLOR\]\$ $NORMAL_TEXT"
    if [[ `tput cols` -lt 50 ]]; then
        PS1="$DIRECTORY_START\W$DIRECTORY_END $PS1"
    else
        PS1="$DIRECTORY_START\w$DIRECTORY_END $PS1"
        if [[ `tput cols` -lt 80 ]]; then
            PS1="$TIME_START \t $TIME_END_DIRECTORY$PS1"
        else
            PS1="$TIME_START \t $TIME_END_INFO$INFO_START \u@\h $INFO_END$PS1"
        fi
    fi
    PS1="$TITLEBAR$PS1"
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
