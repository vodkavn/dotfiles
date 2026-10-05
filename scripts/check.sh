#!/usr/bin/env bash
set -uo pipefail

mode=full
case "${1:-}" in
    '') ;;
    --syntax-only) mode=syntax ;;
    --no-lint) mode=no-lint ;;
    --help|-h)
        printf 'Usage: bash scripts/check.sh [--syntax-only|--no-lint]\n'
        printf 'Default: Bash syntax, isolated regression tests, validation-script lint, Git whitespace.\n'
        printf 'Exit codes: 0 = selected checks passed; 1 = failure; 2 = missing prerequisite or invalid usage.\n'
        exit 0
        ;;
    *) printf 'Unknown option: %s\n' "$1" >&2; exit 2 ;;
esac
if (( $# > 1 )); then
    printf 'Use at most one option; see --help.\n' >&2
    exit 2
fi

for tool in bash git; do
    if ! command -v "$tool" >/dev/null 2>&1 || ! type -P "$tool" >/dev/null; then
        printf 'BLOCKED: missing executable %s. Ubuntu: sudo apt install %s\n' "$tool" "$tool" >&2
        exit 2
    fi
done
bash_bin=$(type -P bash)
git_bin=$(type -P git)
script_dir=${BASH_SOURCE[0]%/*}
[[ $script_dir != "${BASH_SOURCE[0]}" ]] || script_dir=.
root=$(CDPATH='' builtin cd -- "$script_dir/.." && builtin pwd -P) || exit 1

shopt -s globstar nullglob
files=("$root/bashrc" "$root/bash_profile" "$root/bash_logout" "$root/install.sh"
    "$root"/bash/**/*.bash "$root"/bash/*.sh "$root"/.kilo/*.sh
    "$root"/scripts/**/*.sh "$root"/tests/**/*.sh)
lint_files=("$root"/scripts/**/*.sh "$root"/tests/**/*.sh)
failures=0
blocked=0
syntax_errors=0
checked=()

printf 'Local checks: %s\nScope: %s\n' "$root" "$mode"
for file in "${files[@]}"; do
    relative=${file#"$root/"}
    if "$git_bin" -C "$root" check-ignore -q -- "$relative"; then
        continue
    fi
    checked+=("$file")
    if [[ ! -r $file ]] || ! "$bash_bin" -n "$file"; then
        printf 'FAIL: syntax/readability: %s\n' "$relative" >&2
        syntax_errors=$((syntax_errors + 1))
    fi
done
if (( syntax_errors )); then
    failures=$((failures + 1))
else
    printf 'PASS: Bash syntax (%s files; installer parsed, never executed)\n' "${#checked[@]}"
fi

if [[ $mode != syntax ]]; then
    if (( syntax_errors )); then
        printf 'SKIP: runtime tests because syntax checks failed.\n'
    elif [[ ! -r $root/tests/run.sh ]]; then
        printf 'FAIL: tests/run.sh is missing.\n' >&2
        failures=$((failures + 1))
    else
        "$bash_bin" "$root/tests/run.sh"
        status=$?
        if (( status == 2 )); then
            blocked=$((blocked + 1))
        elif (( status )); then
            failures=$((failures + 1))
        fi
    fi

    if [[ $mode == no-lint ]]; then
        printf 'EXCLUDED: ShellCheck (--no-lint was explicitly requested).\n'
    elif command -v shellcheck >/dev/null 2>&1 && shellcheck_bin=$(type -P shellcheck); then
        if "$shellcheck_bin" -s bash "${lint_files[@]}"; then
            printf 'PASS: ShellCheck (scripts/ and tests/ only; legacy config lint is not included)\n'
        else
            failures=$((failures + 1))
        fi
    else
        printf 'BLOCKED: ShellCheck unavailable. Ubuntu: sudo apt install shellcheck\n' >&2
        blocked=$((blocked + 1))
    fi

    whitespace_errors=0
    if ! "$git_bin" -C "$root" diff HEAD --check; then
        whitespace_errors=$((whitespace_errors + 1))
    fi
    # Git diff does not see new untracked scripts, so check those separately.
    for file in "${checked[@]}"; do
        relative=${file#"$root/"}
        if ! "$git_bin" -C "$root" ls-files --error-unmatch -- "$relative" >/dev/null 2>&1; then
            "$git_bin" diff --no-index --check /dev/null "$file"
            status=$?
            # --no-index implies --exit-code: 1 means a clean new-file diff.
            if (( status != 0 && status != 1 )); then
                whitespace_errors=$((whitespace_errors + 1))
            fi
        fi
    done
    if (( whitespace_errors )); then
        failures=$((failures + 1))
    else
        printf 'PASS: Git whitespace (staged, unstaged, and new scoped Bash files)\n'
    fi
fi

if (( failures )); then
    printf '\nFAIL: %s check group(s) failed; %s blocked.\n' "$failures" "$blocked" >&2
    exit 1
elif (( blocked )); then
    printf '\nINCOMPLETE: %s check group(s) blocked; full validation did not pass.\n' "$blocked" >&2
    exit 2
fi
printf '\nPASS: all selected checks (%s).\n' "$mode"
