#!/usr/bin/env bash
set -uo pipefail

script_dir=${BASH_SOURCE[0]%/*}
[[ $script_dir != "${BASH_SOURCE[0]}" ]] || script_dir=.
root=$(CDPATH='' builtin cd -- "$script_dir/.." && builtin pwd -P) || exit 1
blocked=0
packages=()

printf 'Dotfiles doctor (read-only)\nRepository: %s\nBash: %s\n' "$root" "$BASH_VERSION"
if [[ -r /etc/os-release ]]; then
    # shellcheck source=/dev/null
    . /etc/os-release
    printf 'OS: %s\n' "${PRETTY_NAME:-unknown}"
    if [[ ${ID:-} != ubuntu || ${VERSION_ID:-} != 26.* ]]; then
        printf 'WARN: the supported validation target is Ubuntu 26.x.\n'
    fi
else
    printf 'WARN: /etc/os-release is unavailable.\n'
fi

report_tool() {
    local tool=$1 package=$2 requirement=$3 executable
    if command -v "$tool" >/dev/null 2>&1 && executable=$(type -P "$tool"); then
        printf 'OK: %-12s %s\n' "$tool" "$executable"
    elif [[ $requirement == required ]]; then
        printf 'BLOCKED: %-12s missing executable (package: %s)\n' "$tool" "$package"
        blocked=$((blocked + 1))
        if [[ " ${packages[*]} " != *" $package "* ]]; then
            packages+=("$package")
        fi
    else
        printf 'OPTIONAL: %-12s not found (Ubuntu package: %s)\n' "$tool" "$package"
    fi
}

printf '\nFull-check prerequisites (actual executables, not shell aliases):\n'
for entry in bash:bash git:git shellcheck:shellcheck env:coreutils mktemp:coreutils \
    ln:coreutils mkdir:coreutils rm:coreutils cp:coreutils chmod:coreutils \
    head:coreutils tail:coreutils wc:coreutils date:coreutils readlink:coreutils \
    dirname:coreutils timeout:coreutils cat:coreutils sort:coreutils tr:coreutils uname:coreutils ls:coreutils \
    grep:grep sed:sed awk:mawk tar:tar xz:xz-utils gzip:gzip; do
    report_tool "${entry%%:*}" "${entry#*:}" required
done
if [[ ! -r /usr/share/bash-completion/bash_completion ]]; then
    printf 'BLOCKED: system bash-completion provider unavailable.\n'
    blocked=$((blocked + 1))
    packages+=(bash-completion)
else
    printf 'OK: bash-completion provider\n'
fi

printf '\nOptional workstation tools (absence does not fail doctor):\n'
for entry in rg:ripgrep fdfind:fd-find batcat:bat jq:jq vim:vim tmux:tmux curl:curl; do
    report_tool "${entry%%:*}" "${entry#*:}" optional
done
for tool in fd bat; do
    if executable=$(type -P "$tool"); then
        printf 'OK: %-12s %s\n' "$tool" "$executable"
    else
        printf 'INFO: %s is not an executable on PATH; interactive aliases do not make it available to agents.\n' "$tool"
    fi
done

printf '\nManaged shell paths (no files changed or sourced):\n'
for entry in bash:.bash bashrc:.bashrc bash_profile:.bash_profile bash_logout:.bash_logout; do
    source_path="$root/${entry%%:*}"
    target="$HOME/${entry#*:}"
    if [[ -L $target && $target -ef $source_path ]]; then
        printf 'OK: %s points to this repository\n' "$target"
    else
        printf 'INFO: %s is not a symlink to this repository; isolated tests do not require installation.\n' "$target"
    fi
done

if (( blocked )); then
    printf '\nSuggested command only (never executed):\n  sudo apt install'
    printf ' %s' "${packages[@]}"
    printf '\nINCOMPLETE: %s full-check prerequisite(s) missing.\n' "$blocked"
    exit 2
fi
printf '\nOK: full-check prerequisites available. Run bash scripts/check.sh to validate behavior.\n'
