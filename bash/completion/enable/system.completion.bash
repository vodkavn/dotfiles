#!/usr/bin/env bash

# Load the system bash-completion provider and, when present, Homebrew's copy.
#
# Idempotent: skips loading when bash-completion is already active so an
# equivalent load from bashrc does not run twice. On Ubuntu/Debian the provider
# lives at /usr/share/bash-completion/bash_completion and /etc/bash_completion
# sources it.

if ! declare -F _completion_loader >/dev/null 2>&1; then
    if [ -r /etc/bash_completion ]; then
        . /etc/bash_completion
    elif [ -r /usr/share/bash-completion/bash_completion ]; then
        . /usr/share/bash-completion/bash_completion
    fi

    # Distribution/profile script; also picks up XDG user completions. It is a
    # no-op when bash-completion has already been sourced.
    if [ -r /etc/profile.d/bash_completion.sh ]; then
        . /etc/profile.d/bash_completion.sh
    fi
fi

if [ "$(uname)" = "Darwin" ] && command -v brew >/dev/null 2>&1; then
    BREW_PREFIX=$(brew --prefix)

    # homebrew/versions/bash-completion2 installs to share/bash-completion
    for fn in "$BREW_PREFIX/etc/bash_completion" \
              "$BREW_PREFIX/share/bash-completion/bash_completion"; do
        if [ -r "$fn" ]; then
            . "$fn"
        fi
    done
fi
