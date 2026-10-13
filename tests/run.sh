#!/usr/bin/env bash
# Local regression tests for this dotfiles repository's Bash configuration.
#
# Scope: tests/ only. These tests never source the live user's startup files,
# never run install.sh, never touch the network, and never mutate anything
# outside a private mktemp tree.
#
# The Bash cases below are the whole of this file's scope. tests/*.test.mjs
# holds the opencode plugin tests; those need Node's test runner and are driven
# by scripts/check.sh, which is why nothing here mentions them.
#
# Usage:  bash tests/run.sh
#
# Exit codes:
#   0  all cases passed
#   1  at least one case failed (identifiable case name on stderr)
#   2  blocked: unsupported environment or missing prerequisite (apt suggestion)
#
# Target environment: Ubuntu 26.04, Bash >= 5.2. No ShellCheck, Bats, or npm
# dependency; standard coreutils plus tar/xz/gzip/git are required.

# Case callbacks are invoked through run_case's "$@"; cleanup is an EXIT trap.
# shellcheck disable=SC2329
#
# SC2317 ("command appears to be unreachable") is a false positive here for the
# same reason. ShellCheck 0.9.0, which ubuntu-latest ships, cannot see that
# die/assert_* are reached from case_* callbacks passed to run_case, nor that
# cleanup runs via `trap cleanup EXIT`. ShellCheck 0.10+ tightened the
# reachability analysis and stopped reporting it, so this fires on the runner and
# not on a newer local install. Every function it names is genuinely called:
# die() from 24 call sites, assert_eq() from 14, cleanup() from the EXIT trap.
# Kept as a file-wide disable so the suite lints identically on any ShellCheck.
# shellcheck disable=SC2317
set -u

# --- blocking prerequisite checks --------------------------------------------
blocked() { printf 'BLOCKED: %s\n' "$*" >&2; exit 2; }

need_cmd() {
    local cmd=$1 pkg=${2:-$1}
    if ! command -v "$cmd" >/dev/null 2>&1 || ! type -P "$cmd" >/dev/null; then
        blocked "missing executable '$cmd'; install with: sudo apt install $pkg"
    fi
}

if (( BASH_VERSINFO[0] < 5 || (BASH_VERSINFO[0] == 5 && BASH_VERSINFO[1] < 2) )); then
    blocked "Bash >= 5.2 required (found ${BASH_VERSION}); install with: sudo apt install bash"
fi

need_cmd mktemp coreutils
need_cmd env coreutils
need_cmd readlink coreutils
need_cmd dirname coreutils
need_cmd timeout coreutils
need_cmd mkdir coreutils
need_cmd rm coreutils
need_cmd chmod coreutils
need_cmd head coreutils
need_cmd tail coreutils
need_cmd awk mawk
need_cmd ls coreutils
need_cmd tar tar
need_cmd xz xz-utils
need_cmd gzip gzip
need_cmd cp coreutils
need_cmd date coreutils
need_cmd ln coreutils
need_cmd sed sed
need_cmd grep grep
need_cmd cat coreutils
need_cmd sort coreutils
need_cmd wc coreutils
need_cmd tr coreutils
need_cmd uname coreutils
need_cmd git git
need_cmd bash bash

# Resolve paths only after verifying the commands needed to do so.
script_path=$(readlink -f -- "${BASH_SOURCE[0]}") || blocked "cannot resolve test script"
tests_dir=$(CDPATH='' builtin cd -- "${script_path%/*}" && builtin pwd -P) || blocked "cannot resolve tests directory"
repo_root=$(CDPATH='' builtin cd -- "$tests_dir/.." && builtin pwd -P) || blocked "cannot resolve repository"

# System bash-completion and a Git prompt provider are required for the
# integration cases; their absence blocks (rather than fails) the suite. The
# marker below is the exact provider path bashrc sources.
[ -r /usr/share/bash-completion/bash_completion ] \
    || blocked "bash-completion marker '/usr/share/bash-completion/bash_completion' not readable; install with: sudo apt install bash-completion"

git_prompt=''
for f in /usr/lib/git-core/git-sh-prompt \
         /usr/share/git-core/contrib/completion/git-prompt.sh \
         "$repo_root/bash/git-prompt.sh"; do
    if [ -r "$f" ]; then git_prompt=$f; break; fi
done
[ -n "$git_prompt" ] \
    || blocked "Git prompt script not readable; install with: sudo apt install git"

bash_bin=$(type -P bash)

# --- private temp tree, owned by this run ------------------------------------
tmp_parent=${TMPDIR:-/tmp}
tmp_parent=$(CDPATH='' builtin cd -- "$tmp_parent" && builtin pwd -P) || blocked "temporary parent is inaccessible"
tmp_root=''
cleanup() {
    if [ -n "$tmp_root" ] && [ -d "$tmp_root" ] && [ -O "$tmp_root" ] \
        && [[ $tmp_root == "$tmp_parent"/dotfiles-bash-tests.* ]]; then
        rm -rf -- "$tmp_root"
    fi
}
trap cleanup EXIT
trap 'exit 130' INT TERM

tmp_root="$(mktemp -d "$tmp_parent/dotfiles-bash-tests.XXXXXXXX")" \
    || blocked "cannot create a temp directory under $tmp_parent"
tmp_root="$(cd -P -- "$tmp_root" && pwd)"

test_home="$tmp_root/bash home"
mkdir -p -- "$test_home/.config" "$test_home/.local/share" "$test_home/.local/state" \
    "$test_home/.cache" "$test_home/.local/bin" || blocked "cannot create isolated HOME"
ln -s -- "$repo_root/bash" "$test_home/.bash" || blocked "cannot link isolated Bash modules"

# Controlled PATH: symlinks to verified required tools only. Optional CLI
# completion generators (npm, kubectl, helm, aws_completer, docker, terraform)
# are deliberately absent so startup cannot execute them.
bin_dir="$tmp_root/bin"
mkdir -p -- "$bin_dir"
whitelist=(bash sh env uname git tar xz gzip mktemp sort wc head tail cat sed
    grep awk cp ln mkdir rm date chmod id dirname basename tr cut expr
    readlink realpath stat which find ls ps sleep locale tput stty df kill dd
    tee seq od getconf)
for tool in "${whitelist[@]}"; do
    src_path=$(type -P "$tool") || continue
    [[ $src_path == /* ]] || continue
    ln -s -- "$src_path" "$bin_dir/$tool"
done

# Mock bin used only to prove completion generator gates when tools "exist".
mock_bin="$tmp_root/mockbin"
mkdir -p -- "$mock_bin"

# --- assertions (fail fast with an identifiable case name) -------------------
total_count=0
pass_count=0
fail_count=0
current_case=''

die() { printf 'FAIL [%s] %s\n' "$current_case" "$*" >&2; exit 1; }

assert_eq() {
    local got=$1 want=$2 label=${3:-}
    [[ $got == "$want" ]] || die "expected [$want] got [$got]${label:+ ($label)}"
}
assert_contains() {
    [[ $1 == *"$2"* ]] || die "expected to contain [$2]${3:+ ($3)}; actual [$1]"
}
assert_not_contains() {
    [[ $1 != *"$2"* ]] || die "expected NOT to contain [$2]${3:+ ($3)}; actual [$1]"
}
assert_absent() { [[ ! -e $1 ]] || die "expected file to be absent: $1"; }
assert_exists() { [[ -e $1 ]] || die "expected file to exist: $1"; }

# --- child execution helpers -------------------------------------------------
filter_harness_stderr() {
    grep -v -e '^bash: cannot set terminal process group ([0-9][0-9]*): Inappropriate ioctl for device$' \
            -e '^bash: no job control in this shell$' || true
}

# run_child <home> <term> <path> <interactive 0|1> <script-file>
run_child() {
    local home=$1 term=$2 path=$3 inter=$4 script=$5
    local -a args=(--noprofile --norc)
    if [ "$inter" = 1 ]; then
        # Expand CHILD_SCRIPT in the isolated child, not the parent process.
        # shellcheck disable=SC2016
        args+=(-i +m -c 'source "$CHILD_SCRIPT"')
    else
        args+=("$script")
    fi
    timeout 20s env -i \
        PATH="$path" \
        HOME="$home" \
        XDG_CONFIG_HOME="$home/.config" \
        XDG_DATA_HOME="$home/.local/share" \
        XDG_CACHE_HOME="$home/.cache" \
        XDG_STATE_HOME="$home/.local/state" \
        TERM="$term" \
        SHELL=/bin/bash \
        LANG=C.UTF-8 \
        REPO="$repo_root" \
        CHILD_SCRIPT="$script" \
        CASE_DIR="${CASE_DIR:-}" \
        MOCK_LOG="${MOCK_LOG:-}" \
        "$bash_bin" "${args[@]}"
}

# run_case <name> <function>  (function runs in a subshell; die exits 1)
run_case() {
    local name=$1; shift
    current_case=$name
    total_count=$(( total_count + 1 ))
    local CASE_DIR="$tmp_root/case-$name"
    local cdir="$CASE_DIR"
    export CASE_DIR
    mkdir -p -- "$cdir"
    local rc
    if ( "$@" ) \
            >"$cdir/stdout" 2>"$cdir/stderr"; then
        pass_count=$(( pass_count + 1 ))
        printf 'PASS: %s\n' "$name"
    else
        rc=$?
        fail_count=$(( fail_count + 1 ))
        printf 'FAIL: %s (exit %d)\n' "$name" "$rc" >&2
        if [ -s "$cdir/stdout" ]; then sed 's/^/    out: /' "$cdir/stdout" >&2; fi
        if [ -s "$cdir/stderr" ]; then sed 's/^/    err: /' "$cdir/stderr" >&2; fi
    fi
}

# =============================================================================
# Cases
# =============================================================================

case_startup_reload_spaced_home() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
PROMPT_COMMAND=(": original_hook")
source "$REPO/bashrc" >"$HOME/startup.out" 2>"$HOME/startup.err"
printf 'startup_rc=%s\n' "$?"
printf 'startup_out=%s\n' "$(wc -c <"$HOME/startup.out")"
printf 'startup_err=%s\n' "$(wc -c <"$HOME/startup.err")"
printf 'term=%s\n' "$TERM"
printf 'grep_colors=%s\n' "$GREP_COLORS"
printf 'untracked=[%s]\n' "$GIT_PS1_SHOWUNTRACKEDFILES"
printf 'pnpm_home=%s\n' "$PNPM_HOME"
case ":$PATH:" in *":$PNPM_HOME/bin:"*) printf 'pnpm_bin=yes\n';; *) printf 'pnpm_bin=no\n';; esac
case ":$PATH:" in *":$HOME/.local/bin:"*) printf 'local_bin=yes\n';; *) printf 'local_bin=no\n';; esac
printf 'pc0=%s\n' "${PROMPT_COMMAND[0]}"
printf 'pc1=%s\n' "${PROMPT_COMMAND[1]}"
printf 'pc_len=%s\n' "${#PROMPT_COMMAND[@]}"
first_path=$PATH
source "$REPO/bashrc" >"$HOME/reload.out" 2>"$HOME/reload.err"
printf 'reload_out=%s\n' "$(wc -c <"$HOME/reload.out")"
printf 'reload_err=%s\n' "$(wc -c <"$HOME/reload.err")"
[[ $PATH == "$first_path" ]] && printf 'path_stable=yes\n' || printf 'path_stable=no\n'
printf 'pc_len2=%s\n' "${#PROMPT_COMMAND[@]}"
[[ -z ${FILES+x} && -z ${subdirectory+x} && -z ${config_file+x} ]] \
    && printf 'leak=no\n' || printf 'leak=yes\n'
declare -F _completion_loader >/dev/null && printf 'provider=yes\n' || printf 'provider=no\n'
declare -F __git_ps1 >/dev/null && printf 'git_prompt=yes\n' || printf 'git_prompt=no\n'
COLUMNS=90
bash_prompt_powerline
case $PS1 in *__git_ps1*) printf 'ps1_git=yes\n';; *) printf 'ps1_git=no\n';; esac
EOS
    local out har
    out=$(run_child "$test_home" tmux-256color "$bin_dir" 1 "$CASE_DIR/child.sh" \
        2>"$CASE_DIR/harness.err") || die "child exited nonzero (see harness.err)"
    assert_contains "$out" 'startup_rc=0'
    assert_contains "$out" 'startup_out=0'
    assert_contains "$out" 'startup_err=0'
    assert_contains "$out" 'term=tmux-256color'
    assert_contains "$out" 'grep_colors=mt=1;35;40'
    assert_contains "$out" 'untracked=[]'
    assert_contains "$out" "pnpm_home=$test_home/.local/share/pnpm"
    assert_contains "$out" 'pnpm_bin=yes'
    assert_contains "$out" 'local_bin=yes'
    assert_contains "$out" 'pc0=: original_hook'
    assert_contains "$out" 'pc1=bash_prompt_powerline'
    assert_contains "$out" 'pc_len=2'
    assert_contains "$out" 'reload_out=0'
    assert_contains "$out" 'reload_err=0'
    assert_contains "$out" 'path_stable=yes'
    assert_contains "$out" 'pc_len2=2'
    assert_contains "$out" 'leak=no'
    assert_contains "$out" 'provider=yes'
    assert_contains "$out" 'git_prompt=yes'
    assert_contains "$out" 'ps1_git=yes'
    har=$(filter_harness_stderr < "$CASE_DIR/harness.err")
    assert_eq "$har" "" "unexpected interactive stderr"
    return 0
}

case_startup_dumb_terminal() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bashrc" >"$HOME/dumb.out" 2>"$HOME/dumb.err"
printf 'dumb_out=%s\n' "$(wc -c <"$HOME/dumb.out")"
printf 'dumb_err=%s\n' "$(wc -c <"$HOME/dumb.err")"
printf 'term=%s\n' "$TERM"
bash_prompt_powerline
case $PS1 in *'[0m'*) printf 'color=yes\n';; *) printf 'color=no\n';; esac
case $PS1 in *__git_ps1*) printf 'git=yes\n';; *) printf 'git=no\n';; esac
EOS
    local out har
    out=$(run_child "$test_home" dumb "$bin_dir" 1 "$CASE_DIR/child.sh" \
        2>"$CASE_DIR/harness.err") || die "child exited nonzero (see harness.err)"
    assert_contains "$out" 'dumb_out=0'
    assert_contains "$out" 'dumb_err=0'
    assert_contains "$out" 'term=dumb'
    assert_contains "$out" 'color=no'
    assert_contains "$out" 'git=no'
    har=$(filter_harness_stderr < "$CASE_DIR/harness.err")
    assert_eq "$har" "" "unexpected interactive stderr"
    return 0
}

case_startup_noninteractive_silent() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
PS1=custom
source "$REPO/bashrc" >"$HOME/nonint.out" 2>"$HOME/nonint.err"
printf 'nonint_out=%s\n' "$(wc -c <"$HOME/nonint.out")"
printf 'nonint_err=%s\n' "$(wc -c <"$HOME/nonint.err")"
[[ -z ${PNPM_HOME+x} ]] && printf 'pnpm=unset\n' || printf 'pnpm=set\n'
[[ -z ${PROMPT_COMMAND+x} ]] && printf 'pc=unset\n' || printf 'pc=set\n'
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'nonint_out=0'
    assert_contains "$out" 'nonint_err=0'
    assert_contains "$out" 'pnpm=unset'
    assert_contains "$out" 'pc=unset'
    return 0
}

case_loader_order_fixtures() {
    local lhome="$CASE_DIR/home"
    mkdir -p -- "$lhome/.bash/lib" "$lhome/.bash/aliases/enable" \
        "$lhome/.bash/completion/enable" "$lhome/.bash/plugins/enable" \
        "$lhome/.config" "$lhome/.local/share" "$lhome/.local/state" "$lhome/.cache"
    ln -s -- "$repo_root/bash/bash_functions.bash" "$lhome/.bash/bash_functions.bash"
    ln -s -- "$repo_root/bash/lib/composure.bash" "$lhome/.bash/lib/composure.bash"
    cat > "$lhome/.bash/aliases/enable/10-fixture.bash" <<'EOS'
printf 'aliases\n' >> "$HOME/order.log"
EOS
    cat > "$lhome/.bash/completion/enable/20-fixture.bash" <<'EOS'
printf 'completion\n' >> "$HOME/order.log"
EOS
    cat > "$lhome/.bash/plugins/enable/30-fixture.bash" <<'EOS'
printf 'plugins\n' >> "$HOME/order.log"
EOS
    cat > "$lhome/.bash/aliases/custom.aliases.bash" <<'EOS'
printf 'custom-aliases\n' >> "$HOME/order.log"
EOS
    cat > "$lhome/.bash/completion/custom.completion.bash" <<'EOS'
printf 'custom-completion\n' >> "$HOME/order.log"
EOS
    cat > "$lhome/.bash/plugins/custom.plugins.bash" <<'EOS'
printf 'custom-plugins\n' >> "$HOME/order.log"
EOS
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bashrc" >"$HOME/boot.out" 2>"$HOME/boot.err"
printf 'boot_out=%s\n' "$(wc -c <"$HOME/boot.out")"
printf 'boot_err=%s\n' "$(wc -c <"$HOME/boot.err")"
printf 'order=%s\n' "$(tr '\n' ',' < "$HOME/order.log" 2>/dev/null)"
EOS
    local out har
    out=$(run_child "$lhome" dumb "$bin_dir" 1 "$CASE_DIR/child.sh" \
        2>"$CASE_DIR/harness.err") || die "child exited nonzero (see harness.err)"
    assert_contains "$out" 'boot_out=0'
    assert_contains "$out" 'boot_err=0'
    assert_contains "$out" 'order=aliases,completion,plugins,custom-aliases,custom-completion,custom-plugins,'
    har=$(filter_harness_stderr < "$CASE_DIR/harness.err")
    assert_eq "$har" "" "unexpected interactive stderr"
    return 0
}

case_pathmunge_regex_chars() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/bash_functions.bash"
d="/tmp/we[1]*?name$RANDOM"
PATH=/usr/bin:/bin
export PATH
pathmunge "$d"
printf 'first=%s\n' "$PATH"
p1=$PATH
pathmunge "$d"
[[ $PATH == "$p1" ]] && printf 'idempotent=yes\n' || printf 'idempotent=no\n'
case ":$PATH:" in *":$d:"*) printf 'literal=yes\n';; *) printf 'literal=no\n';; esac
d2="/tmp/append[2]dir$RANDOM"
pathmunge "$d2" after
case "$PATH" in *":$d2") printf 'after=yes\n';; *) printf 'after=no\n';; esac
before=$PATH
pathmunge ""
rc=$?
[[ $PATH == "$before" && $rc -eq 0 ]] && printf 'empty=ok\n' || printf 'empty=bad\n'
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'first=/tmp/we[1]*?name'
    assert_contains "$out" 'idempotent=yes'
    assert_contains "$out" 'literal=yes'
    assert_contains "$out" 'after=yes'
    assert_contains "$out" 'empty=ok'
    return 0
}

case_fd_bat_guards() {
    local mocks_a="$CASE_DIR/mocksA"
    mkdir -p -- "$mocks_a"
    printf '#!/bin/sh\nexit 0\n' > "$mocks_a/fdfind"
    printf '#!/bin/sh\nexit 0\n' > "$mocks_a/batcat"
    chmod +x "$mocks_a/fdfind" "$mocks_a/batcat"
    local mocks_b="$CASE_DIR/mocksB"
    mkdir -p -- "$mocks_b"
    printf '#!/bin/sh\nexit 0\n' > "$mocks_b/fd"
    printf '#!/bin/sh\nexit 0\n' > "$mocks_b/bat"
    chmod +x "$mocks_b/fd" "$mocks_b/bat"

    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/aliases/custom.aliases.bash"
printf 'fd=[%s]\n' "$(alias fd 2>/dev/null)"
printf 'bat=[%s]\n' "$(alias bat 2>/dev/null)"
EOS

    local out_a out_b
    out_a=$(run_child "$test_home" dumb "$bin_dir:$mocks_a" 0 "$CASE_DIR/child.sh") \
        || die "child (fdfind/batcat) exited nonzero"
    assert_contains "$out_a" "fd=[alias fd='fdfind']"
    assert_contains "$out_a" "bat=[alias bat='batcat']"

    out_b=$(run_child "$test_home" dumb "$bin_dir:$mocks_b" 0 "$CASE_DIR/child.sh") \
        || die "child (fd/bat) exited nonzero"
    assert_contains "$out_b" 'fd=[]'
    assert_contains "$out_b" 'bat=[]'
    return 0
}

case_alias_completion_quoting() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
_capture() { saved_words=("${COMP_WORDS[@]}"); saved_line=$COMP_LINE; }
complete -F _capture git
alias gtest='git log --pretty="%h %s"'
    alias danger='git "$(printf x >"$HOME/DANGER_MARKER")"'
    alias bticks='git `printf x >"$HOME/BTICK_MARKER"`'
alias pipe_test='git status | cat'
alias broken="git 'unterminated"
source "$REPO/bash/plugins/enable/alias-completion.plugin.bash"
[[ $- != *f* ]] && printf 'noglob=off\n' || printf 'noglob=on\n'
complete -p gtest >/dev/null 2>&1 && printf 'gtest_complete=yes\n' || printf 'gtest_complete=no\n'
complete -p danger >/dev/null 2>&1 && printf 'danger_complete=yes\n' || printf 'danger_complete=no\n'
complete -p pipe_test >/dev/null 2>&1 && printf 'pipe_complete=yes\n' || printf 'pipe_complete=no\n'
complete -p broken >/dev/null 2>&1 && printf 'broken_complete=yes\n' || printf 'broken_complete=no\n'
[[ -e $HOME/DANGER_MARKER ]] && printf 'danger_marker=yes\n' || printf 'danger_marker=no\n'
[[ -e $HOME/BTICK_MARKER ]] && printf 'btick_marker=yes\n' || printf 'btick_marker=no\n'
COMP_WORDS=(gtest "two words" "")
COMP_CWORD=2
COMP_LINE="gtest 'two words' "
COMP_POINT=${#COMP_LINE}
_alias_completion::gtest
printf 'w0=[%s]\n' "${saved_words[0]}"
printf 'w1=[%s]\n' "${saved_words[1]}"
printf 'w2=[%s]\n' "${saved_words[2]}"
printf 'w3=[%s]\n' "${saved_words[3]}"
printf 'w4=[%s]\n' "${saved_words[4]}"
printf 'cword=%s\n' "$COMP_CWORD"
printf 'line=%s\n' "$saved_line"
set -f
source "$REPO/bash/plugins/enable/alias-completion.plugin.bash"
[[ $- == *f* ]] && printf 'noglob_kept=yes\n' || printf 'noglob_kept=no\n'
set +f
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'noglob=off'
    assert_contains "$out" 'gtest_complete=yes'
    assert_contains "$out" 'danger_complete=no'
    assert_contains "$out" 'pipe_complete=no'
    assert_contains "$out" 'broken_complete=no'
    assert_contains "$out" 'danger_marker=no'
    assert_contains "$out" 'btick_marker=no'
    assert_contains "$out" 'w0=[git]'
    assert_contains "$out" 'w1=[log]'
    assert_contains "$out" 'w2=[--pretty=%h %s]'
    assert_contains "$out" 'w3=[two words]'
    assert_contains "$out" 'w4=[]'
    assert_contains "$out" 'cword=4'
    assert_contains "$out" "line=git log --pretty=\"%h %s\" 'two words' "
    assert_contains "$out" 'noglob_kept=yes'
    return 0
}

case_optional_generator_gates() {
    local log="$CASE_DIR/mock.log"
    : > "$log"
    export MOCK_LOG="$log"

    cat > "$mock_bin/npm" <<'EOS'
#!/bin/sh
printf 'npm %s\n' "$*" >> "$MOCK_LOG"
printf 'complete -F _npm_mock npm\n'
EOS
    cat > "$mock_bin/kubectl" <<'EOS'
#!/bin/sh
printf 'kubectl %s\n' "$*" >> "$MOCK_LOG"
printf 'complete -F _kubectl_mock kubectl\n'
EOS
    cat > "$mock_bin/helm" <<'EOS'
#!/bin/sh
printf 'helm %s\n' "$*" >> "$MOCK_LOG"
printf 'complete -F _helm_mock helm\n'
EOS
    cat > "$mock_bin/aws_completer" <<'EOS'
#!/bin/sh
printf 'aws_completer %s\n' "$*" >> "$MOCK_LOG"
exit 0
EOS
    chmod +x "$mock_bin/npm" "$mock_bin/kubectl" "$mock_bin/helm" "$mock_bin/aws_completer"

    local agent
    for agent in npm kubectl helm aws_completer docker terraform; do
        assert_absent "$bin_dir/$agent"
    done

    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/completion/enable/npm.completion.bash"
source "$REPO/bash/completion/enable/kubectl.completion.bash"
source "$REPO/bash/completion/enable/helm.completion.bash"
source "$REPO/bash/completion/enable/awscli.completion.bash"
complete -p npm >/dev/null 2>&1 && printf 'npm=yes\n' || printf 'npm=no\n'
complete -p kubectl >/dev/null 2>&1 && printf 'kubectl=yes\n' || printf 'kubectl=no\n'
complete -p helm >/dev/null 2>&1 && printf 'helm=yes\n' || printf 'helm=no\n'
complete -p aws >/dev/null 2>&1 && printf 'aws=yes\n' || printf 'aws=no\n'
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir:$mock_bin" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'npm=yes'
    assert_contains "$out" 'kubectl=yes'
    assert_contains "$out" 'helm=yes'
    assert_contains "$out" 'aws=yes'

    local mock_log
    mock_log=$(cat "$log")
    assert_contains "$mock_log" 'npm completion'
    assert_contains "$mock_log" 'kubectl completion'
    assert_contains "$mock_log" 'helm completion'
    assert_not_contains "$mock_log" 'aws_completer'
    return 0
}

case_curl_network_mocked() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/plugins/enable/base.plugin.bash"
curl() {
    case "$*" in
        *api.ipify.org*) printf 'not an ip\n';;
        *checkip.amazonaws.com*) printf '203.0.113.7\n';;
        *) printf 'unknown\n';;
    esac
}
printf 'myip=%s\n' "$(myip)"
myip >/dev/null 2>&1
printf 'myip_rc=%s\n' "$?"
curl() { printf 'still not an ip\n'; }
out=$(myip 2>&1)
rc=$?
printf 'fail_rc=%s\n' "$rc"
printf 'fail_msg=%s\n' "$out"
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'myip=Your public IP is: 203.0.113.7'
    assert_contains "$out" 'myip_rc=0'
    assert_contains "$out" 'fail_rc=1'
    assert_contains "$out" 'fail_msg=Could not determine your public IP address.'
    return 0
}

case_passgen_fixture_dict() {
    # passgen guards on the absolute path /usr/share/dict/words. Bash cannot
    # redefine the `[` builtin, so that guard cannot be stubbed from the child:
    # a `'['() { ... }` definition is a syntax error, not a stub. Source a copy
    # with the path rewritten to an isolated fixture instead. The real passgen
    # code still runs, and the host dictionary is never read.
    sed "s|/usr/share/dict/words|$CASE_DIR/words.txt|g" \
        "$repo_root/bash/plugins/enable/base.plugin.bash" > "$CASE_DIR/base.sh"
    if grep -q '/usr/share/dict/words' "$CASE_DIR/base.sh"; then
        die "fixture rewrite did not replace the host dictionary path"
    fi
    printf 'alpha\nbeta\ngamma\ndelta\nepsilon\n' > "$CASE_DIR/words.txt"

    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$CASE_DIR/base.sh"

passgen 0 >/dev/null 2>&1; printf 'zero=%s\n' "$?"
passgen abc >/dev/null 2>&1; printf 'abc=%s\n' "$?"
passgen -3 >/dev/null 2>&1; printf 'neg=%s\n' "$?"

# Deterministic word order via a pickfrom stub, so the assertions never depend
# on the host dictionary or on RANDOM.
PICK_COUNT="$HOME/pick.count"
: > "$PICK_COUNT"
pickfrom() {
    local n
    n=$(cat "$PICK_COUNT" 2>/dev/null || printf 0)
    n=$(( n + 1 ))
    printf '%s\n' "$n" > "$PICK_COUNT"
    sed -n "${n}p" "$CASE_DIR/words.txt"
}

out=$(passgen 3)
printf 'passgen_rc=%s\n' "$?"
printf 'line1=%s\n' "${out%%$'\n'*}"
printf 'line2=%s\n' "${out##*$'\n'}"
printf 'lines=%s\n' "$(printf '%s\n' "$out" | wc -l)"
out2=$(passgen 2)
printf 'line2b=%s\n' "${out2##*$'\n'}"
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'zero=1'
    assert_contains "$out" 'abc=1'
    assert_contains "$out" 'neg=1'
    assert_contains "$out" 'passgen_rc=0'
    assert_contains "$out" 'line1=With spaces (easier to memorize): alpha beta gamma'
    assert_contains "$out" 'line2=Without (use this as the password): alphabetagamma'
    assert_contains "$out" 'lines=2'
    assert_contains "$out" 'line2b=Without (use this as the password): deltaepsilon'
    return 0
}

case_extract_archives() {
    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/plugins/enable/base.plugin.bash"
source "$REPO/bash/plugins/enable/extract.plugin.bash"
work="$HOME/work"
mkdir -p -- "$work"
cd -- "$work" || exit 1
printf 'archive payload\n' > fixture.txt
tar -cJf good.tar.xz fixture.txt
tar -cJf good.txz fixture.txt
tar -czf good.tar.gz fixture.txt
rm -f fixture.txt

extract good.tar.xz
printf 'xz_rc=%s\n' "$?"
printf 'xz_content=%s\n' "$(cat fixture.txt 2>/dev/null)"
rm -f fixture.txt
extract good.txz
printf 'txz_rc=%s\n' "$?"
printf 'txz_content=%s\n' "$(cat fixture.txt 2>/dev/null)"
rm -f fixture.txt
extract good.tar.gz
printf 'gz_rc=%s\n' "$?"
printf 'gz_content=%s\n' "$(cat fixture.txt 2>/dev/null)"
rm -f fixture.txt

extract missing.tar.xz >/dev/null 2>&1
printf 'missing_rc=%s\n' "$?"
printf 'x\n' > note.txt
extract note.txt >/dev/null 2>&1
printf 'unsupported_rc=%s\n' "$?"
extract >/dev/null 2>&1
printf 'usage_rc=%s\n' "$?"

printf 'r\n' > thing.rar
err=$(extract thing.rar 2>&1)
printf 'notool_rc=%s\n' "$?"
case $err in *"is required"*) printf 'notool_msg=yes\n';; *) printf 'notool_msg=no\n';; esac

printf 'not a gzip archive\n' > corrupt.tar.gz
extract corrupt.tar.gz >/dev/null 2>&1
printf 'toolfail_rc=%s\n' "$?"

extract good.tar.xz missing.tar.xz corrupt.tar.gz >/dev/null 2>&1
printf 'agg_rc=%s\n' "$?"
printf 'agg_content=%s\n' "$(cat fixture.txt 2>/dev/null)"

printf 'backup me\n' > note2.txt
buf note2.txt
backups=(note2.txt_*)
printf 'buf_count=%s\n' "${#backups[@]}"
printf 'buf_content=%s\n' "$(cat "${backups[0]}" 2>/dev/null)"
EOS
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child exited nonzero"
    assert_contains "$out" 'xz_rc=0'
    assert_contains "$out" 'xz_content=archive payload'
    assert_contains "$out" 'txz_rc=0'
    assert_contains "$out" 'txz_content=archive payload'
    assert_contains "$out" 'gz_rc=0'
    assert_contains "$out" 'gz_content=archive payload'
    assert_contains "$out" 'missing_rc=1'
    assert_contains "$out" 'unsupported_rc=1'
    assert_contains "$out" 'usage_rc=1'
    assert_contains "$out" 'notool_rc=1'
    assert_contains "$out" 'notool_msg=yes'
    assert_contains "$out" 'toolfail_rc=1'
    assert_contains "$out" 'agg_rc=1'
    assert_contains "$out" 'agg_content=archive payload'
    assert_contains "$out" 'buf_count=1'
    assert_contains "$out" 'buf_content=backup me'
    return 0
}

# The AI alias module gates every tool on command -v and must emit nothing when
# none of them exist, because it is sourced on every interactive shell startup.
case_ai_alias_gates() {
    local mocks_a="$CASE_DIR/mocksA"
    mkdir -p -- "$mocks_a"
    for tool in opencode gh glab ast-grep difft shfmt; do
        printf '#!/bin/sh\nexit 0\n' > "$mocks_a/$tool"
    done
    chmod +x "$mocks_a"/*

    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/aliases/enable/ai.aliases.bash"
printf 'ai=[%s]\n' "$(alias ai 2>/dev/null)"
printf 'air=[%s]\n' "$(alias air 2>/dev/null)"
printf 'ghp=[%s]\n' "$(alias ghp 2>/dev/null)"
printf 'ghrun=[%s]\n' "$(alias ghrun 2>/dev/null)"
printf 'gtop=[%s]\n' "$(alias gtop 2>/dev/null)"
printf 'asg=[%s]\n' "$(alias asg 2>/dev/null)"
printf 'shfmtv=[%s]\n' "$(alias shfmtv 2>/dev/null)"
EOS

    # No AI tools on PATH: every alias stays undefined and the module is silent.
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child (no AI tools) exited nonzero"
    assert_eq "$out" "$(printf 'ai=[]\nair=[]\nghp=[]\nghrun=[]\ngtop=[]\nasg=[]\nshfmtv=[]')" \
        "module must define nothing and print nothing"

    # Tools present: aliases are defined, and the GitHub CLI ones bypass the
    # pre-existing `gh` git-root alias from git.aliases.bash.
    out=$(run_child "$test_home" dumb "$bin_dir:$mocks_a" 0 "$CASE_DIR/child.sh") \
        || die "child (mocked AI tools) exited nonzero"
    assert_contains "$out" "ai=[alias ai='opencode']"
    assert_contains "$out" "air=[alias air='opencode run']"
    assert_contains "$out" "ghp=[alias ghp='command gh pr']"
    assert_contains "$out" "ghrun=[alias ghrun='command gh run']"
    assert_contains "$out" "gtop=[alias gtop='cd \"\$(git rev-parse --show-toplevel)\"']"
    assert_contains "$out" "asg=[alias asg='ast-grep']"
    assert_contains "$out" "shfmtv=[alias shfmtv='shfmt -d']"

    # The pre-existing `gh` git-root alias must survive the AI module.
    cat > "$CASE_DIR/child2.sh" <<'EOS'
source "$REPO/bash/lib/composure.bash"
source "$REPO/bash/aliases/enable/git.aliases.bash"
source "$REPO/bash/aliases/enable/ai.aliases.bash"
printf 'gh=[%s]\n' "$(alias gh 2>/dev/null)"
printf 'gl=[%s]\n' "$(alias gl 2>/dev/null)"
EOS
    out=$(run_child "$test_home" dumb "$bin_dir:$mocks_a" 0 "$CASE_DIR/child2.sh") \
        || die "child (git aliases + AI aliases) exited nonzero"
    assert_contains "$out" "gh=[alias gh='cd"
    assert_contains "$out" "git rev-parse --show-toplevel"
    assert_contains "$out" "gl=[alias gl='git log']"
    return 0
}

# opencode completion must be absent without the binary, and must be generated
# once and then served from the XDG cache on subsequent shells.
case_opencode_completion_gate() {
    local log="$CASE_DIR/mock.log"
    : > "$log"
    export MOCK_LOG="$log"

    local mocks_a="$CASE_DIR/mocksA"
    mkdir -p -- "$mocks_a"
    cat > "$mocks_a/opencode" <<'EOS'
#!/bin/sh
printf 'invoked\n' >> "$MOCK_LOG"
printf '_mock_opencode() { COMPREPLY=(); }\n'
printf 'complete -F _mock_opencode opencode\n'
EOS
    chmod +x "$mocks_a/opencode"

    cat > "$CASE_DIR/child.sh" <<'EOS'
source "$REPO/bash/completion/enable/opencode.completion.bash"
complete -p opencode >/dev/null 2>&1 && printf 'registered=yes\n' || printf 'registered=no\n'
EOS

    # Without the binary the module returns early and registers nothing.
    local out
    out=$(run_child "$test_home" dumb "$bin_dir" 0 "$CASE_DIR/child.sh") \
        || die "child (no opencode) exited nonzero"
    assert_eq "$out" 'registered=no' "completion must not register without opencode"

    # First shell generates and caches the completion.
    out=$(run_child "$test_home" dumb "$bin_dir:$mocks_a" 0 "$CASE_DIR/child.sh") \
        || die "child (first opencode shell) exited nonzero"
    assert_contains "$out" 'registered=yes'
    assert_eq "$(cat "$log")" 'invoked' "generator must run exactly once"
    assert_exists "$test_home/.cache/opencode/completions.bash"

    # Second shell reuses the cache instead of running the generator again.
    out=$(run_child "$test_home" dumb "$bin_dir:$mocks_a" 0 "$CASE_DIR/child.sh") \
        || die "child (cached opencode shell) exited nonzero"
    assert_contains "$out" 'registered=yes'
    assert_eq "$(cat "$log")" 'invoked' "cached completion must be reused"
    return 0
}

# The global opencode config install must discover its link list from
# config/opencode/ instead of a hardcoded array, so a new plugin, agent, command,
# or skill is picked up on the next run with no edit to install.sh.
#
# install.sh is not executed here: it clones, writes to $HOME, and runs Vim. This
# exercises the discovery pipeline it uses, against a synthetic tree, so the rule
# is pinned without the blast radius.
case_ai_config_link_discovery() {
    local tree="$CASE_DIR/config/opencode"
    mkdir -p -- "$tree/plugins/alpha" "$tree/plugins/beta" "$tree/agents" \
        "$tree/commands" "$tree/skills/doc-guide"

    # Shaped like the real tree: one config file, several plugins, and the
    # directory kinds the global layer may grow later.
    printf '{}\n' > "$tree/opencode.json"
    : > "$tree/plugins/alpha/index.ts"
    : > "$tree/plugins/beta/index.ts"

    discover() (
        cd "$tree" 2>/dev/null || exit 0
        {
            find . -mindepth 1 -maxdepth 1 -type f -name '*.json' -printf '%P\n'
            find . -mindepth 2 -maxdepth 2 -type d -path './plugins/*' -printf '%P\n'
            find . -mindepth 1 -maxdepth 1 -type d ! -name plugins -printf '%P\n'
        } | LC_ALL=C sort
    )

    # Baseline: the config file, every plugin individually, and the other
    # top-level directories linked whole.
    local out
    out=$(discover)
    assert_eq "$out" "$(printf 'agents\ncommands\nopencode.json\nplugins/alpha\nplugins/beta\nskills')" \
        "discovery must list config, each plugin, and other top-level directories"

    # A plugin must never be emitted as plugins/ itself: linking that directory
    # wholesale would merge it into ~/.config/opencode/plugins/, where community
    # plugins installed by `opencode plugin add` already live as real dirs.
    assert_eq "$(printf '%s\n' "$out" | grep -cx 'plugins')" '0' \
        "plugins/ must be expanded, never linked wholesale"

    # The point of the change: a plugin added later needs no edit anywhere.
    mkdir -p -- "$tree/plugins/gamma"
    : > "$tree/plugins/gamma/index.ts"
    out=$(discover)
    assert_contains "$out" 'plugins/gamma'
    assert_eq "$(printf '%s\n' "$out" | grep -cx 'plugins/[a-z]*')" '3' \
        "a newly added plugin must be discovered automatically"

    # Nested files inside a plugin must not be emitted; only the plugin dir is.
    mkdir -p -- "$tree/plugins/gamma/src"
    : > "$tree/plugins/gamma/src/index.ts"
    out=$(discover)
    assert_eq "$(printf '%s\n' "$out" | grep -c 'gamma')" '1' \
        "only the plugin directory is linked, not its contents"

    # Non-JSON top-level files are not config and must be ignored.
    printf 'x\n' > "$tree/README.md"
    out=$(discover)
    assert_eq "$(printf '%s\n' "$out" | grep -cx 'README.md')" '0' \
        "non-JSON top-level files must not be linked"

    # A missing source directory yields an empty list rather than an error, so
    # install.sh reports "nothing to do" instead of failing under set -e.
    local missing="$CASE_DIR/absent"
    local out_missing
    out_missing=$(
        cd "$missing" 2>/dev/null || exit 0
        {
            find . -mindepth 1 -maxdepth 1 -type f -name '*.json' -printf '%P\n'
            find . -mindepth 2 -maxdepth 2 -type d -path './plugins/*' -printf '%P\n'
            find . -mindepth 1 -maxdepth 1 -type d ! -name plugins -printf '%P\n'
        } | LC_ALL=C sort
    )
    assert_eq "$out_missing" '' "a missing source directory must produce an empty list"

    # The real repository tree must still discover the three shipped plugins and
    # every other shipped top-level entry, so a rename cannot silently drop one.
    # config/opencode/commands/ holds the global /new-ai command and
    # config/opencode/skills/ the working-method skills.
    local real
    real=$(
        cd "$repo_root/config/opencode" 2>/dev/null || exit 0
        {
            find . -mindepth 1 -maxdepth 1 -type f -name '*.json' -printf '%P\n'
            find . -mindepth 2 -maxdepth 2 -type d -path './plugins/*' -printf '%P\n'
            find . -mindepth 1 -maxdepth 1 -type d ! -name plugins -printf '%P\n'
        } | LC_ALL=C sort
    )
    assert_eq "$real" "$(printf 'commands\nopencode.json\nplugins/compaction-memory\nplugins/inspector\nplugins/shell-guard\nplugins/tool-guard\nskills')" \
        "the shipped global config must discover its four plugins, commands, and skills"
    return 0
}

# Deleting a plugin from config/opencode/ must not leave a dangling symlink
# behind in ~/.config/opencode/plugins/, which opencode still scans at startup.
# install.sh only visits paths in its link list, so it needed an explicit prune
# of links pointing back into this checkout whose source is gone.
#
# install.sh is not executed here for the same reason as above. This replays
# the prune loop against a synthetic tree so the rule is pinned without any
# blast radius, and so the "leave community plugins alone" half is pinned too:
# `opencode plugin add` installs real directories in the same place.
case_ai_stale_link_prune() {
    local src="$CASE_DIR/dotfiles/config/opencode"
    local global="$CASE_DIR/home/.config/opencode"
    mkdir -p -- "$src/plugins/alpha" "$src/plugins/beta" \
        "$global/plugins/community" "$global/commands"
    : > "$src/plugins/alpha/index.ts"
    : > "$src/plugins/beta/index.ts"
    : > "$global/plugins/community/index.ts"

    link() { ln -s -- "$src/$1" "$global/$2"; }
    link plugins/alpha plugins/alpha
    link plugins/beta plugins/beta
    link plugins/alpha commands/alpha-link
    # The deleted plugin: its link points into the checkout, but the source
    # directory is gone, so the link dangles.
    link plugins/tokens plugins/tokens

    assert_absent "$src/plugins/tokens"
    assert_eq "$(find "$global" -xtype l | wc -l)" '1' "fixture must have exactly one dangling link"

    # The loop, as install.sh runs it.
    local ai_src=$src ai_global=$global ai_link_list existing target relative
    ai_link_list=$(
        cd "$ai_src" 2>/dev/null || exit 0
        {
            find . -mindepth 1 -maxdepth 1 -type f -name '*.json' -printf '%P\n'
            find . -mindepth 2 -maxdepth 2 -type d -path './plugins/*' -printf '%P\n'
            find . -mindepth 1 -maxdepth 1 -type d ! -name plugins -printf '%P\n'
        } | LC_ALL=C sort
    )
    while IFS= read -r existing; do
        [ -n "$existing" ] || continue
        target=$(readlink "$existing")
        case "$target" in
            "$ai_src"/*) ;;
            *) continue ;;
        esac
        relative=${target#"$ai_src"/}
        if ! printf '%s\n' "$ai_link_list" | grep -qxF -- "$relative"; then
            rm -f "$existing"
        fi
    done < <(find "$ai_global" -type l 2>/dev/null)

    # The dangling link is gone.
    assert_absent "$global/plugins/tokens"
    assert_eq "$(find "$global" -xtype l | wc -l)" '0' "prune must leave no dangling link"
    # Everything with a live source is untouched.
    assert_exists "$global/plugins/alpha"
    assert_exists "$global/plugins/beta"
    assert_exists "$global/commands/alpha-link"
    # A real directory from `opencode plugin add` is never a link, so the prune
    # cannot see it and must not touch it.
    assert_exists "$global/plugins/community"
    [ -L "$global/plugins/community" ] && die "community plugin was replaced by a symlink"
    return 0
}

# =============================================================================
# Run
# =============================================================================

run_case ai_config_link_discovery case_ai_config_link_discovery
run_case ai_stale_link_prune case_ai_stale_link_prune
run_case ai_alias_gates case_ai_alias_gates
run_case opencode_completion_gate case_opencode_completion_gate
run_case startup_reload_spaced_home case_startup_reload_spaced_home
run_case startup_dumb_terminal case_startup_dumb_terminal
run_case startup_noninteractive_silent case_startup_noninteractive_silent
run_case loader_order_fixtures case_loader_order_fixtures
run_case pathmunge_regex_chars case_pathmunge_regex_chars
run_case fd_bat_guards case_fd_bat_guards
run_case alias_completion_quoting case_alias_completion_quoting
run_case optional_generator_gates case_optional_generator_gates
run_case curl_network_mocked case_curl_network_mocked
run_case passgen_fixture_dict case_passgen_fixture_dict
run_case extract_archives case_extract_archives

printf '\n%d passed, %d failed, %d total\n' "$pass_count" "$fail_count" "$total_count"
if (( fail_count > 0 )); then
    exit 1
fi
exit 0
