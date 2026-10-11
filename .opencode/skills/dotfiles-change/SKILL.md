---
name: Dotfiles Change
description: Use when editing, adding, or reviewing any file in this dotfiles repository, so Bash startup, vendored code, and validation conventions are respected
---

This repository is a Bash, tmux, and Vim dotfiles workspace, not an
application. Changes are small, targeted, and must not disturb shell startup.

## Layout

- `bashrc`, `bash_profile`, `bash_logout` — startup. `bashrc` returns
  immediately for non-interactive shells.
- `bash/setup.bash` — terminal environment, toolchains, `PATH`. Sourced before
  the modules because those modules gate on the binaries it initializes.
- `bash/aliases/enable/`, `bash/completion/enable/`, `bash/plugins/enable/` —
  modules loaded in that order, then each module type's `custom.*` overrides.
- `install.sh` — clones, backs up, symlinks, copies fonts, installs Vim plugins.
  Never run it without explicit approval.
- `scripts/` — read-only diagnostics. `tests/` — isolated Bash validation.
- `doc/`, `README.md` — usage notes.

## Rules

1. `.editorconfig` governs: four spaces, LF, final newline, no trailing
   whitespace.
2. Never edit `tmux/plugins/`, `vim/autoload/pathogen.vim`, or the `.gitmodules`
   submodules. These are third-party.
3. Never commit credentials, generated plugin files, or agent session and
   worktree state.
4. Do not source the live shell startup files or reload the user's running
   tmux or Vim configuration as an automatic check. Use `tests/run.sh`, which
   runs against an isolated `HOME` and a controlled `PATH`.
5. Suggest, never install. Do not run `sudo`, package installation, or remote
   install scripts. Print the command and stop.
6. Verify a tool with `command -v <tool>` before using it. An interactive alias
   does not make an executable available to an agent — after `sudo apt install
   fd-find` the binary is `fdfind`, not `fd`.

## Working on Bash modules

- Anything shelling out to an optional tool gates on `command -v` and stays
  silent when the tool is absent.
- Modules open with `cite 'about-alias'` plus an `about-*` line so `composure`
  can describe them, matching their neighbours.
- Check the new name does not already exist in `custom.aliases.bash` or another
  `enable/` module before defining an alias.
- Prefer `--` before user-supplied paths and quote expansions.

## Working on validation scripts

`scripts/check.sh` exit codes are contractual: `0` passed, `1` failed, `2`
incomplete or invalid usage. A missing ShellCheck blocks full validation rather
than passing silently. `--no-lint` is an explicit exclusion that must be
reported as one.

## Before reporting done

1. `bash -n` on each changed Bash file.
2. `shellcheck -s bash` on changed files under `scripts/` and `tests/`.
3. `bash scripts/check.sh` for the full suite.
4. `git diff --check`, then read the final diff.

Report exactly which checks ran and any that were skipped. Do not claim a clean
lint for legacy config or vendored code that only received a syntax check.
