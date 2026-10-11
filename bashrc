# Keep non-interactive shells (including scp) silent.
[[ $- == *i* ]] || return

# Source the first readable candidate. Defined here, rather than in
# bash_functions.bash, because the blocks below use it to load that file too.
source_first_readable() {
    local candidate
    for candidate in "$@"; do
        if [ -r "$candidate" ]; then
            source "$candidate"
            return 0
        fi
    done
    return 1
}

# Terminal environment, toolchains, and PATH. Sourced before the modules below,
# which gate on the binaries it initializes (npm, rvm_path, $HOME/.local/bin).
source_first_readable "$HOME/.bash/setup.bash"

# Load .bash_functions, then composure, so modules can cite function metadata.
source_first_readable "$HOME/.bash/bash_functions.bash"
source_first_readable "$HOME/.bash/lib/composure.bash"

# Load in the git branch prompt script. __git_ps1 must exist before
# bash_prompt_powerline renders the prompt.
export GIT_PS1_SHOWSTASHSTATE=1
export GIT_PS1_SHOWDIRTYSTATE=1
export GIT_PS1_SHOWCOLORHINTS=1
export GIT_PS1_SHOWUNTRACKEDFILES=""
source_first_readable /usr/lib/git-core/git-sh-prompt \
    /usr/share/git-core/contrib/completion/git-prompt.sh "$HOME/.bash/git-prompt.sh"

# Ubuntu's maintained completions must load before local completion modules.
if ! declare -F _completion_loader >/dev/null; then
    source_first_readable /usr/share/bash-completion/bash_completion
fi

# Load enabled aliases, completion, plugins, then the custom overrides of each.
if declare -F cite >/dev/null; then
    bash_module_types=(aliases completion plugins)
    if declare -F load_bash_files >/dev/null; then
        for file_type in "${bash_module_types[@]}"; do
            load_bash_files "$file_type"
        done
    fi
    for file_type in "${bash_module_types[@]}"; do
        source_first_readable "$HOME/.bash/$file_type/custom.$file_type.bash"
    done
    unset bash_module_types file_type
fi

if declare -F bash_prompt_powerline >/dev/null && [[ " ${PROMPT_COMMAND[*]} " != *" bash_prompt_powerline "* ]]; then
    PROMPT_COMMAND+=(bash_prompt_powerline)
fi