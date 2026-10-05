#!/usr/bin/env bash

# docker completion
#
# Prefer the maintained system bash-completion provider. Fall back to sourcing a
# completion file directly for layouts the provider does not cover (for example
# Docker Desktop on macOS).

command -v docker >/dev/null 2>&1 || return 0
complete -p docker >/dev/null 2>&1 && return 0

if declare -F _completion_loader >/dev/null 2>&1; then
    _completion_loader docker >/dev/null 2>&1
elif declare -F _comp_load >/dev/null 2>&1; then
    _comp_load -- docker >/dev/null 2>&1
fi
complete -p docker >/dev/null 2>&1 && return 0

_docker_bash_completion_paths=(
    # macOS Docker Desktop
    '/Applications/Docker.app/Contents/Resources/etc/docker.bash-completion'
    # Linux
    '/usr/share/bash-completion/completions/docker'
)

for fn in "${_docker_bash_completion_paths[@]}" ; do
    if [ -r "$fn" ] ; then
        source "$fn"
        break
    fi
done
