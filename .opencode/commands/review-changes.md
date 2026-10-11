---
description: Review this repository's uncommitted changes against AGENTS.md and editorconfig
agent: reviewer
subagent: true
---

Review the current uncommitted changes in this dotfiles repository. The diff is
injected below; you cannot run commands yourself.

## Staged changes

!`git diff --cached`

## Unstaged changes

!`git diff`

## Untracked files

!`git ls-files --others --exclude-standard`

Review against the rules in `AGENTS.md` and `.editorconfig`:

- Four-space indentation, LF endings, trailing newline, no trailing whitespace.
- `tmux/plugins/`, `vim/autoload/pathogen.vim`, and the `.gitmodules`
  submodules are third-party code. Any incidental edit there is a finding.
- `gitconfig` personal identity settings must not be replaced without a request.
- `install.sh` must not gain automatic execution from any sourced file.
- Bash changes must keep `set -uo pipefail`-clean quoting: prefer `--` before
  user-supplied paths and quote expansions.
- Exit code `2` must keep meaning "incomplete validation", distinct from `1`.

Report findings in severity order with file and line references. Distinguish a
regression introduced by this diff from a pre-existing problem. Say explicitly
when you find nothing.
