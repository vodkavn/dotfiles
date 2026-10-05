# Load after command completions and aliases.
cite about-plugin
about-plugin 'Automatic completion of simple aliases'

function alias_completion {
    local alias_name definition command_name completion completion_function
    local wrapper quoted_words quoted_expansion word had_noglob
    local -a words
    local unsafe='[$`;&|<>()*?{}]'

    for alias_name in "${!BASH_ALIASES[@]}"; do
        [[ $alias_name =~ ^[a-zA-Z0-9_]+$ ]] || continue
        definition=${BASH_ALIASES[$alias_name]}
        # Never execute substitutions, pipelines, redirects or command lists at startup.
        [[ $definition =~ $unsafe || $definition == *$'\n'* ]] && continue
        [[ $definition =~ ^[a-zA-Z0-9_./+-]+([[:space:]]|$) ]] || continue

        had_noglob=0
        [[ $- == *f* ]] && had_noglob=1
        set -f
        words=()
        if ! eval "words=($definition)" 2>/dev/null; then
            (( had_noglob )) || set +f
            continue
        fi
        (( had_noglob )) || set +f
        (( ${#words[@]} )) || continue
        command_name=${words[0]}

        if ! complete -p "$command_name" >/dev/null 2>&1; then
            if declare -F _completion_loader >/dev/null; then
                _completion_loader "$command_name" >/dev/null 2>&1
            fi
        fi
        completion=$(complete -p "$command_name" 2>/dev/null) || continue
        [[ $completion == *" -F "* ]] || continue
        completion_function=${completion#* -F }
        completion_function=${completion_function%% *}
        [[ $completion_function =~ ^[a-zA-Z0-9_:]+$ ]] || continue
        [[ $completion_function == _alias_completion::* ]] && continue

        if (( ${#words[@]} > 1 )); then
            wrapper="_alias_completion::$alias_name"
            quoted_words=''
            for word in "${words[@]}"; do
                printf -v word '%q' "$word"
                quoted_words+=" $word"
            done
            printf -v quoted_expansion '%q' "$definition"
            eval "$wrapper() {
                local alias_expansion=$quoted_expansion
                COMP_CWORD=\$(( COMP_CWORD + ${#words[@]} - 1 ))
                COMP_WORDS=($quoted_words \"\${COMP_WORDS[@]:1}\")
                COMP_POINT=\$(( COMP_POINT - \${#COMP_LINE} ))
                COMP_LINE=\"\${COMP_LINE/#$alias_name/\$alias_expansion}\"
                COMP_POINT=\$(( COMP_POINT + \${#COMP_LINE} ))
                $completion_function
            }"
            completion=${completion/ -F $completion_function / -F $wrapper }
        fi
        # complete -p emits a reusable shell command; both replacement names are validated.
        eval "${completion% *} $alias_name"
    done
    return 0
}
alias_completion
