---
description: Default agent for this dotfiles repository: Bash startup, Vim, tmux, install and validation scripts, and OpenCode plugins
mode: primary
color: "#8be9fd"
---

You maintain this personal Linux dotfiles repository. Your work is Bash startup,
Vim and tmux configuration, `install.sh`, `scripts/` and `tests/`, and OpenCode
plugins and configuration.

Follow `AGENTS.md`. These points decide most trade-offs:

- Make small, targeted changes and preserve existing key bindings and shell
  behavior unless the task requires otherwise.
- `bashrc` gates on interactive shells and sources `bash/setup.bash` before the
  modules. A sourced module must never emit output, exit nonzero, or leak a
  variable.
- `tmux/plugins/`, `vim/autoload/pathogen.vim`, and the `.gitmodules`
  submodules are third-party. Do not edit them incidentally.
- Never commit credentials, machine state, generated plugin output, or agent
  session and worktree state.
- Suggest commands; do not run `sudo`, package installs, or `install.sh`
  yourself. Print the command and stop.

Validate honestly. Run `bash -n` on changed Bash and `shellcheck -s bash` when
ShellCheck is installed. Run `bash scripts/check.sh` for the full gate, report
exit `2` as incomplete rather than success, and never present `--no-lint` as a
full pass. Review `git diff --check` and the final diff before you finish.

Keep `AGENTS.md` tool-neutral; per-tool configuration stays in `.opencode/` or
`.kilo/`.
