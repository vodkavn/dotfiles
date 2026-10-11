# AI coding cheatsheet

This repository ships agent configuration for [opencode](https://opencode.ai).
Everything lives under `.opencode/`, mirroring how `.kilo/` holds Kilo-specific
configuration, so `AGENTS.md` stays tool-neutral.

## Layout

    .opencode/opencode.json              project config: permissions, MCP, watcher
    .opencode/commands/*.md              slash commands
    .opencode/agents/reviewer.md         read-only review subagent
    .opencode/skills/dotfiles-change/    repo conventions as a loadable skill
    .opencode/worktrees -> ../.lane/trees (gitignored)

Configuration is strict JSON, not JSONC, so `scripts/check.sh` can validate it
with `jq`. The `$schema` key still gives editors validation and autocomplete.

## Slash commands

Type these in the opencode TUI:

    /validate      run scripts/check.sh and report the result
    /doctor        run scripts/doctor.sh (read-only diagnostics)
    /review        review uncommitted changes via the reviewer subagent
    /new-module    plan a new alias/completion/plugin module

`/validate` and `/doctor` use shell blocks, which run when the command is
evaluated rather than through the agent's permission flow. They only ever run
this repository's own scripts.

## Permissions

The broad `allow` rules come first in `opencode.json`; exceptions come after
them, because the last matching rule wins. The denies encode rules that would
otherwise only be prose in `AGENTS.md`:

- never run `sudo`, `curl`, or `wget` from an agent
- never run `install.sh`
- never edit `tmux/plugins/`, `vim/bundle/`, or `vim/autoload/pathogen.vim`
- never write `.env` files
- `git push` asks first

## Parallel work

`worktree.directory` is `.lane/trees`, so `opencode` worktrees land inside the
checkout and are gitignored rather than scattering under the server's data
directory. Start one with `/worktree`.

## tmux

`M-o` opens opencode in a popup on the current directory. The binding is guarded,
so it reports that opencode is missing rather than opening a dead pane.

## Aliases

Defined in `bash/aliases/enable/ai.aliases.bash`, all gated on the executable
actually existing:

    ai / aim / aic / ais     opencode, mini, continue, service status
    air                      opencode run (one-shot)
    ghp ghpv ghpc ghd        GitHub CLI pull requests
    ghi ghiv                 GitHub CLI issues
    ghrun ghrwl ghrw         GitHub CLI actions runs
    ghsr                     GitHub CLI search
    glmr glmrv glmrd         GitLab CLI merge requests
    asg                      ast-grep
    difftc                   difftastic
    shfmtv shfmtw            shfmt diff / write
    dcheck dcheckfast        scripts/check.sh
    ddoctor                  scripts/doctor.sh

### The `gh` collision

`bash/aliases/enable/git.aliases.bash` has always defined `gh` as "cd to the Git
root". Bash expands aliases only in the first word, so `gh pr list` would expand
to `cd "$(git rev-parse --show-toplevel)" pr list` and fail.

The existing alias is left alone to preserve muscle memory, and every GitHub CLI
alias routes through `command gh` instead. The Git-root behaviour is also
available as `gtop`. To flip this the other way round, move `gh` to the CLI and
rename the Git-root alias to `gtop`.

`gl` is taken by `git log`, so `glab` keeps its full name.

## Optional tools

`.kilo/suggest-tools.sh` prints, without installing anything, what the AI
toolchain is missing: `ripgrep`, `fd-find`, `bat`, `jq`, `shellcheck`, `gh`,
`git-delta`, `shfmt`, plus upstream install links for `glab` and `difftastic`,
and `npm install -g @ast-grep/cli`.

Run it any time:

    bash .kilo/suggest-tools.sh

## Gotchas

- An interactive alias is not an executable. After `sudo apt install fd-find`
  the binary is `fdfind`, not `fd`. `scripts/doctor.sh` reports this.
- Verify `ast-grep`, not `sg`. On Ubuntu `sg` can be an unrelated system
  command, so the alias is `asg`.
- `instructions` in an opencode config file is accepted but not loaded. Use
  `AGENTS.md` for instructions.

## Validation

Agent-facing config is covered by the same suite as the Bash:

    bash scripts/check.sh      # includes a JSON group for .opencode/.kilo/.vscode
    bash scripts/check.sh --syntax-only
