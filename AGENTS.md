# Repository Guidance

## Scope and Layout

This repository contains personal Linux dotfiles, not an application.

- `bashrc`, `bash_profile`, `bash_logout`, and `bash/`: Bash startup, aliases, completion, and plugins. Enabled modules live in `bash/{aliases,completion,plugins}/enable/`.
- `vimrc` and `vim/`: Vim configuration, local scripts, colors, and Vundle plugins.
- `tmux.conf` and `tmux/`: tmux configuration, themes, and bundled plugins.
- `gitconfig`: Git defaults; do not replace personal identity settings without a request.
- `install.sh`: installation, backups, symlinks, font copying, and plugin updates.
- `scripts/` and `tests/`: read-only diagnostics and isolated local Bash validation.
- `doc/` and `README.md`: usage notes and installation instructions.
- `.kilo/`: all Kilo-specific project configuration. Keep this file tool-neutral.

## Editing Rules

- Make small, targeted changes and preserve existing key bindings and shell behavior unless the task requires otherwise.
- Follow `.editorconfig`: four spaces, LF line endings, and a final newline. Preserve local conventions in existing files.
- Treat `tmux/plugins/`, `vim/autoload/pathogen.vim`, and Git submodules in `.gitmodules` as third-party code; avoid incidental edits or updates.
- Never commit credentials, machine-specific secrets, generated plugin files, or Kilo session/worktree state.
- Do not run `install.sh` without explicit approval. It changes files under `$HOME`, pulls repositories, installs plugins, and sources the user's shell configuration.
- Do not source Bash startup files or reload the user's live tmux/Vim configuration as an automatic check. Use isolated environments for runtime checks.

## Operating Rules

- Verify required CLI tools with `command -v <tool>` before using them. A missing required tool blocks that step: give the user the installation command for their platform and stop that step, rather than substitute a weaker tool. Prefer available built-in agent tools when no external CLI is required.
- Suggest, never install: do not run `sudo`, package installation commands, or remote installation scripts yourself. The user reviews and runs them.
- On Ubuntu/Debian, common packages are `ripgrep` (`rg`), `fd-find` (`fdfind`), `bat` (`batcat`), `jq` and `shellcheck`. Do not assume `fd` or `bat` exists after apt installation; verify the exact executable required by the workflow.
- Install structural search with `npm install -g @ast-grep/cli` using user-owned npm tooling. Verify `ast-grep`, not `sg`, which can be an unrelated system command. For GitLab's `glab`, consult upstream installation instructions before suggesting the community WakeMeOps repository; do not assume it is GitLab-owned or hard-code package versions.
- `.kilo/suggest-tools.sh` prints optional Ubuntu/Debian toolchain suggestions at the end of installation. It can also be run independently with `bash .kilo/suggest-tools.sh`; it does not install anything.

## Validation

The supported target is Ubuntu 26.x. There is no CI workflow.

- Run `bash scripts/doctor.sh` for read-only prerequisite and executable-path diagnostics. It does not source personal configuration, inspect credentials, or install tools.
- Run `bash scripts/check.sh` for syntax, isolated Bash regressions, ShellCheck on `scripts/` and `tests/`, and Git whitespace. Legacy configuration and bundled code receive syntax/runtime checks, not a clean-lint claim.
- Exit codes: `0` means selected checks passed, `1` means a check failed, and `2` means validation is incomplete or usage is invalid. Missing ShellCheck blocks full validation; suggest `sudo apt install shellcheck`, never install it yourself.
- `--syntax-only` selects syntax checks only. `--no-lint` explicitly excludes ShellCheck; report this exclusion rather than claiming full validation passed. Run `bash tests/run.sh` for standalone isolated runtime tests.

- For changed Bash files, run `bash -n path/to/file` to check syntax without executing them. Root Bash files have no extension; modules use `.bash` and scripts commonly use `.sh`.
- If ShellCheck is installed, run `shellcheck -s bash path/to/file` on changed Bash files. Distinguish existing warnings from regressions; do not reformat vendored code to silence them.
- Validate Vim or tmux changes in an isolated session with a temporary home and, for tmux, a separate server socket. Configuration can execute shell commands and load plugins, so inspect it before loading it.
- Run `git diff --check` and review the final diff. Report checks actually performed and any runtime checks skipped.
