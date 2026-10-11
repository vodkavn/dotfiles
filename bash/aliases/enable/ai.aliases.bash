cite 'about-alias'
about-alias 'AI coding tool and code review abbreviations'

# Every block below gates on the executable existing and stays silent when it
# does not. Interactive aliases are not available to agents: only a real binary
# on PATH is. See scripts/doctor.sh for the fd/bat version of this distinction.

# --- opencode ---------------------------------------------------------------
if command -v opencode >/dev/null 2>&1; then
    alias ai='opencode'
    # One-shot, non-interactive run; the agent form of "ask and exit".
    alias air='opencode run'
    alias aim='opencode mini'
    alias aic='opencode --continue'
    # Restart a wedged background service without hunting for the subcommand.
    alias ais='opencode service status'
fi

# --- GitHub CLI (gh) --------------------------------------------------------
# bash/aliases/enable/git.aliases.bash already defines `gh` as "cd to the Git
# root". Alias expansion only rewrites the first word, so `gh pr list` would
# expand to `cd "$(git rev-parse --show-toplevel)" pr list` and fail. The `gh`
# alias is kept for existing muscle memory, so every GitHub CLI alias below
# goes through `command gh` to bypass it.
if command -v gh >/dev/null 2>&1; then
    alias gtop='cd "$(git rev-parse --show-toplevel)"'
    alias ghp='command gh pr'
    alias ghpv='command gh pr view'
    alias ghpc='command gh pr checkout'
    alias ghd='command gh pr diff'
    alias ghi='command gh issue'
    alias ghiv='command gh issue view'
    alias ghrun='command gh run'
    alias ghrwl='command gh run list --watch'
    alias ghrw='command gh run watch'
    alias ghsr='command gh search'
fi

# --- GitLab CLI (glab) ------------------------------------------------------
# `gl` is taken by `git log`, so the CLI keeps its full name here.
if command -v glab >/dev/null 2>&1; then
    alias glmr='command glab mr'
    alias glmrv='command glab mr view'
    alias glmrd='command glab mr diff'
    alias glci='command glab ci'
fi

# --- Structural search ------------------------------------------------------
# `sg` is deliberately not used: on Ubuntu it can be an unrelated system
# command. ast-grep installs as `ast-grep`.
if command -v ast-grep >/dev/null 2>&1; then
    alias asg='ast-grep'
fi

# --- Diff review ------------------------------------------------------------
# git-delta is normally wired through gitconfig's core.pager, not an alias.
if command -v difft >/dev/null 2>&1; then
    alias difftc='difft --color=always'
fi

# --- Shell formatting -------------------------------------------------------
# shfmt matches the repository's four-space, LF, editorconfig-checked style.
if command -v shfmt >/dev/null 2>&1; then
    # -d prints a diff and exits nonzero when reformatting is needed.
    alias shfmtv='shfmt -d'
    alias shfmtw='shfmt -w'
fi

# --- Repository validation --------------------------------------------------
# These run against $HOME/.dotfiles only when the caller is inside the repo;
# elsewhere they fall back to the installed checkout. Neither script mutates
# anything, so they are safe to alias directly.
if [ -r "$HOME/.dotfiles/scripts/check.sh" ]; then
    alias dcheck='bash "$HOME/.dotfiles/scripts/check.sh"'
    alias dcheckfast='bash "$HOME/.dotfiles/scripts/check.sh" --syntax-only'
fi
if [ -r "$HOME/.dotfiles/scripts/doctor.sh" ]; then
    alias ddoctor='bash "$HOME/.dotfiles/scripts/doctor.sh"'
fi
