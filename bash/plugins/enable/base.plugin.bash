cite about-plugin
about-plugin 'miscellaneous tools'

function ips ()
{
    about 'display all ip addresses for this host'
    group 'base'
    if command -v ifconfig &>/dev/null
    then
        ifconfig | awk '/inet /{ gsub(/addr:/, ""); print $2 }'
    elif command -v ip &>/dev/null
    then
        ip -o addr show | awk '/inet /{ sub(/\/.*/, "", $4); print $4 }'
    else
        echo "You don't have ifconfig or ip command installed!"
    fi
}

function down4me ()
{
    about 'checks whether a website is down for you, or everybody'
    param '1: website url'
    example '$ down4me http://www.google.com'
    group 'base'
    if ! command -v curl &>/dev/null; then
        echo "You don't have the curl command installed!" >&2
        return 1
    fi
    curl -Ls "http://downforeveryoneorjustme.com/$1" | sed '/just you/!d;s/<[^>]*>//g'
}

function myip ()
{
    about 'displays your ip address, as seen by the Internet'
    group 'base'
    if ! command -v curl &>/dev/null; then
        echo "You don't have the curl command installed!" >&2
        return 1
    fi
    local res=''
    local url
    for url in "https://api.ipify.org" "https://checkip.amazonaws.com"
    do
        res=$(curl -fsSL --max-time 10 "$url") && [[ $res =~ ^[0-9]+\.[0-9]+\.[0-9]+\.[0-9]+$ ]] && break
        res=''
    done
    if [ -n "$res" ]; then
        echo "Your public IP is: ${res}"
    else
        echo "Could not determine your public IP address." >&2
        return 1
    fi
}

function pickfrom ()
{
    about 'picks random line from file'
    param '1: filename'
    example '$ pickfrom /usr/share/dict/words'
    group 'base'
    local file=$1
    [ -z "$file" ] && reference $FUNCNAME && return
    [ -r "$file" ] || { echo "pickfrom: cannot read '$file'" >&2; return 1; }
    local length n
    length=$(wc -l < "$file")
    (( length > 0 )) || return 1
    n=$(( RANDOM * length / 32768 + 1 ))
    head -n "$n" -- "$file" | tail -1
}

function passgen ()
{
    about 'generates random password from dictionary words'
    param 'optional integer length'
    param 'if unset, defaults to 4'
    example '$ passgen'
    example '$ passgen 6'
    group 'base'
    local i pass='' word length=${1:-4}
    [[ $length =~ ^[1-9][0-9]*$ ]] || { echo "passgen: length must be a positive integer" >&2; return 1; }
    [ -r /usr/share/dict/words ] || { echo "passgen: /usr/share/dict/words not found" >&2; return 1; }
    for (( i=0; i<length; i++ )); do
        word=$(pickfrom /usr/share/dict/words) || return 1
        pass+="${pass:+ }$word"
    done
    echo "With spaces (easier to memorize): $pass"
    echo "Without (use this as the password): ${pass// /}"
}

function pmdown ()
{
    about 'preview markdown file in a browser'
    param '1: markdown file'
    example '$ pmdown README.md'
    group 'base'
    if command -v markdown &>/dev/null
    then
      if command -v browser &>/dev/null; then
          markdown "$1" | browser
      else
          echo "You don't have a browser command installed!" >&2
          return 1
      fi
    else
      echo "You don't have a markdown command installed!" >&2
      return 1
    fi
}

function mkcd ()
{
    about 'make one or more directories and cd into the last one'
    param 'one or more directories to create'
    example '$ mkcd foo'
    example '$ mkcd /tmp/img/photos/large'
    example '$ mkcd foo foo1 foo2 fooN'
    example '$ mkcd /tmp/img/photos/large /tmp/img/photos/self /tmp/img/photos/Beijing'
    group 'base'
    mkdir -p -- "$@" && eval cd -- "\"\$$#\""
}

function lsgrep ()
{
    about 'search through directory contents with grep'
    group 'base'
    ls | grep -- "$*"
}

function quiet ()
{
    about 'what *does* this do?'
    group 'base'
    "$@" &> /dev/null &
}

function banish-cookies ()
{
    about 'redirect .adobe and .macromedia files to /dev/null'
    group 'base'
    rm -r ~/.macromedia ~/.adobe
    ln -s /dev/null ~/.adobe
    ln -s /dev/null ~/.macromedia
}

function usage ()
{
    about 'disk usage per directory, in Mac OS X and Linux'
    param '1: directory name'
    group 'base'
    if [ "$(uname)" = "Darwin" ]; then
        if [ -n "$1" ]; then
            du -hd 1 "$1"
        else
            du -hd 1
        fi

    elif [ "$(uname)" = "Linux" ]; then
        if [ -n "$1" ]; then
            du -h --max-depth=1 "$1"
        else
            du -h --max-depth=1
        fi
    fi
}

function command_exists ()
{
    about 'checks for existence of a command'
    param '1: command to check'
    example '$ command_exists ls && echo exists'
    group 'base'
    type "$1" &> /dev/null ;
}

mkiso ()
{
    about 'creates iso from current dir in the parent dir (unless defined)'
    param '1: ISO name'
    param '2: dest/path'
    param '3: src/path'
    example 'mkiso'
    example 'mkiso ISO-Name dest/path src/path'
    group 'base'

    if command -v mkisofs >/dev/null; then
        local isoname destpath srcpath
        [ -z "${1+x}" ] && isoname=${PWD##*/} || isoname=$1
        [ -z "${2+x}" ] && destpath=../ || destpath=$2
        [ -z "${3+x}" ] && srcpath=${PWD} || srcpath=$3

        if [ ! -f "${destpath}${isoname}.iso" ]; then
            echo "writing ${isoname}.iso to ${destpath} from ${srcpath}"
            mkisofs -V "${isoname}" -iso-level 3 -r -o "${destpath}${isoname}.iso" "${srcpath}"
        else
            echo "${destpath}${isoname}.iso already exists"
        fi
    else
        echo "mkisofs cmd does not exist, please install cdrtools" >&2
        return 1
    fi
}

# useful for administrators and configs
function buf ()
{
    about 'back up file with timestamp'
    param 'filename'
    group 'base'
    local filename=$1
    [ -n "$filename" ] || { echo "buf: missing filename" >&2; return 1; }
    local filetime
    filetime=$(date +%Y%m%d_%H%M%S)
    cp -a -- "${filename}" "${filename}_${filetime}"
}

function del() {
    about 'move files to hidden folder in tmp, that gets cleared on each reboot'
    param 'file or folder to be deleted'
    example 'del ./file.txt'
    group 'base'
    mkdir -p /tmp/.trash && mv -- "$@" /tmp/.trash;
}
