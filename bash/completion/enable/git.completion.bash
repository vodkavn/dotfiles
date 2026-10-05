#!/usr/bin/env bash

# git completion
#
# Prefer the maintained system bash-completion provider, which lazy-loads
# completion files on demand (including Ubuntu 24.04's 2.11 package). The
# large vendored upstream copy was removed in favour of that provider.
#
# Requires bash-completion to be loaded first (see system.completion.bash).

command -v git >/dev/null 2>&1 || return 0
complete -p git >/dev/null 2>&1 && return 0

if declare -F _completion_loader >/dev/null 2>&1; then
    _completion_loader git >/dev/null 2>&1
elif declare -F _comp_load >/dev/null 2>&1; then
    _comp_load -- git >/dev/null 2>&1
fi
