# AI coding cheatsheet

This repository ships agent configuration for [opencode](https://opencode.ai).
Project-scoped files live under `.opencode/`, mirroring how `.kilo/` holds
Kilo-specific configuration, so `AGENTS.md` stays tool-neutral. Files that must
apply to every project live under `config/` and are linked into `$HOME` by
`install.sh`.

## Layout

    config/opencode/opencode.json          global: shell, formatter, compaction,
                                           websearch, update, agents, references,
                                           MCP servers
    config/opencode/plugins/inspector/     sidebar inspector (CLI plugin)
    config/opencode/plugins/tokens/        token/speed panel (CLI plugin)
    config/opencode/plugins/shell-guard/   deny privileged commands (server plugin)
    config/opencode/plugins/compaction-memory/  keep intent across compaction
    .opencode/opencode.json                 project: permissions, watcher, worktree
    .opencode/commands/*.md                 slash commands
    .opencode/agents/reviewer.md            read-only review subagent
    .opencode/skills/opencode-plugin-dev/   opencode v2 plugin development guide
    .opencode/skills/dotfiles-change/       repo conventions as a loadable skill

`config/` follows the same rule as the rest of the repository: a path is named
after the `$HOME` dotfile it becomes. So `config/opencode/opencode.json` is
literally `~/.config/opencode/opencode.json`, the same way `vim/` is `~/.vim`
and `gitconfig` is `~/.gitconfig`.

Configuration is strict JSON, not JSONC, so `scripts/check.sh` can validate it
with `jq`. The `$schema` key still gives editors validation and autocomplete.

## What `install.sh` links

`install.sh` discovers the global layer from the filesystem rather than from a
list. Under `config/opencode/` it links:

- each top-level `*.json` file — currently just `opencode.json`
- each directory inside `plugins/`, **individually**
- every other top-level directory, linked whole — `agents/`, `commands/`,
  `skills/` today, and anything added later

Plugins are expanded one by one on purpose. Linking `plugins/` as a single
directory would merge this repository's plugins into
`~/.config/opencode/plugins/` wholesale, which is the same place
`opencode plugin add` installs community packages as real directories. Linking
each plugin separately leaves those alone, and the existing check — skip when the
destination is already a symlink pointing into this checkout — never matches a
community plugin.

The practical consequence: **adding a plugin, agent, command, or skill under
`config/opencode/` needs no edit to `install.sh`.** Drop the file in and re-run
the installer. `case_ai_config_link_discovery` in `tests/run.sh` pins both the
discovery rule and the current set of shipped plugins, so a rename that silently
drops one fails the suite.

## The two layers

`install.sh` links `config/opencode/opencode.json` to
`~/.config/opencode/opencode.json`. opencode loads, in increasing precedence:

1. `~/.config/opencode/opencode.json` — global
2. `~/.config/opencode/` — global agents, commands, skills
3. `.opencode/opencode.json` — project
4. `.opencode/` — project agents, commands, skills

`permissions` arrays concatenate across the layers, global rules first, and the
last matching rule wins. A global deny therefore still applies here unless a
later project rule overrides it.

**Global layer** is CLI-wide settings, MCP servers, references, agents, and the
plugins: `shell`, `formatter`, `compaction`, `websearch`, `update`, the
`agents` and `references` blocks, the `mcp.servers` block, and the four
`config/opencode/plugins/` directories.

**Project layer** keeps commands, skills, and every permission rule, because all
of those encode what this repository cares about.

Two traps:

- `~/.opencode` is opencode's own **data** directory (it holds `bin/`), not its
  config directory. Never symlink this repository's `.opencode` there, or it
  shadows the binary and injects `/validate` and `/doctor` into every project.
  `install.sh` links into `~/.config/opencode/` for this reason.
- opencode caches configuration when its service starts. After adding or moving
  a config file, restart opencode or the change is ignored.

## Slash commands

Type these in the opencode TUI:

    /validate         run scripts/check.sh and report the result
    /doctor           run scripts/doctor.sh (read-only diagnostics)
    /review-changes   review uncommitted changes via the reviewer subagent
    /new-module       plan a new alias/completion/plugin module

opencode ships a builtin `/review` that accepts `[commit|branch|pr]`. The
repository command is deliberately named `/review-changes` so both remain
available instead of one replacing the other.

`/validate` and `/doctor` use shell blocks, which run when the command is
evaluated rather than through the agent's permission flow. They only ever run
this repository's own scripts.

## Permissions

Permissions are project-scoped, in `.opencode/opencode.json`. The broad `allow`
rules come first; exceptions come after them, because the last matching rule
wins. The denies encode rules that would otherwise only be prose in `AGENTS.md`:

- never run `sudo`, `curl`, or `wget` from an agent
- never run `install.sh`
- never edit `tmux/plugins/`, `vim/bundle/`, or `vim/autoload/pathogen.vim`
- never write `.env` files
- `git push` asks first

Because these live in the project layer, they apply here and nowhere else. The
`sudo`/`curl`/`wget` rules are repo-agnostic, and the global **shell-guard**
plugin (below) now enforces them in every project, so the duplicated entries
here are defence in depth rather than the only line of defence.

## Global settings

These live in `config/opencode/opencode.json` and therefore apply in every
project on any machine this repository is installed on.

### `agents`

One global primary agent, `doc-writer`, aimed at documentation work. Its system
prompt encodes the two rules that matter most when a model is writing docs
rather than code: match the voice and frontmatter of the document being edited,
and **verify every command, flag, and path before writing it down**. A
plausible command that does not exist is the worst output this agent can
produce. It is `mode: primary` so it can be selected with `/agent doc-writer`,
but it does not override the default agent for ordinary coding sessions.

### `references`

`references` gives opencode named access to directories outside the current
project and advertises each one to the agent through its `description`, so the
agent knows *when* to reach for it rather than having to be told. Attach one in
the client, then ask for what is needed:

    /reference runbook
    Summarise the rollback procedure in runbook/database.md.

| Alias | Path | Use |
| --- | --- | --- |
| `runbook` | `~/work/docs/runbooks` | procedures, on-call, deployment steps |
| `standards` | `~/work/docs/standards` | team coding and documentation standards |

**Both paths are placeholders.** Edit them to wherever the document corpus
actually lives on the machine in question — this repository cannot know that, and
a reference pointing at a directory that does not exist is silently useless
rather than an error. Local references resolve `~`, relative, and absolute
paths; a bare `docs` with no prefix is read as a *Git repository*, so write
`./docs`, `~/docs`, or an absolute path.

### `websearch` and `update`

`websearch.provider` is `random`, which picks an available provider
automatically instead of leaving search unconfigured. `update` is `notify`, the
default, stated explicitly so a work machine does not silently auto-install a new
release.

### `compaction`

    "compaction": {
        "auto": true,
        "keep": { "tokens": 15000 },
        "buffer": 20000
    }

`keep.tokens` is the recent tail preserved verbatim when a summary happens. This
is the counterpart to the **compaction-memory** plugin below: that plugin
protects the *original ask* across compaction, and this keeps the *recent
detail*. Raise `keep.tokens` for long documentation sessions where the recent
back-and-forth matters more than the summary being short.

### `formatter`

`formatter` is enabled globally, with the built-in `prettier` entry overridden to
run through `npx`:

    "formatter": {
        "prettier": {
            "command": ["npx", "-y", "prettier", "--write", "$FILE"],
            "extensions": [".md", ".mdx"]
        }
    }

This is what normalises the Markdown tables language models get wrong. The
built-in `prettier` definition normally requires a `prettier` entry in the
target project's `package.json`, which a documentation repository often does not
have; overriding `command` and narrowing `extensions` to `.md`/`.mdx` runs it
everywhere without adding a Node dependency to any project.

A community plugin doing this job, `opencode-md-table-formatter`, is **v1 only**
— it hooks `experimental.text.complete`, which does not exist in v2 — so it would
load and do nothing. This is the supported replacement.

## Plugins

Four plugins live in `config/opencode/plugins/`, all global. Two are CLI
plugins that draw (`inspector`, `tokens`); two are server plugins that only
change behaviour (`shell-guard`, `compaction-memory`).

Community packages are a separate mechanism. `opencode plugin add <pkg>`
installs into the same `~/.config/opencode/plugins/` directory as real
directories that opencode manages, and the installer deliberately leaves them
alone — see [What `install.sh` links](#what-installsh-links). Pin the version
(`opencode plugin add <pkg>@1.2.0`) so a work machine and a laptop do not drift.

Discovery is by **flat sibling filenames**, not a `package.json` manifest: a
directory holding only `index.ts` loads fine as a server-only plugin, while one
with `index.ts` plus `tui.tsx` also gets a terminal half. Restart opencode after
adding or removing a plugin — the service caches config at startup.

### `shell-guard` (server)

Denies `sudo`, `doas`, `su`, `curl`, `wget`, and `apt*` before the shell runs
them, in every project, via the v2 `shell.hook("create.before")` hook. This
replaces re-spelling `sudo *` as a permission rule in each project config, and it
rejects with a reason the model reads instead of a silent permission prompt.

It matches **command position**, not substrings, by tokenising the command and
testing each command's first word. `grep -r curl src/` and `echo 'use curl
later'` are allowed; `echo hi && sudo rm -rf /` is not.

It is a guardrail, not a sandbox. `bash -c 'sudo ls'`, `xargs sudo`, and
`node -e 'child_process…'` all bypass it, because it matches strings rather than
intercepting execution. To tighten or loosen it, edit the `BLOCKED` map at the
top of `index.ts`.

### `compaction-memory` (server)

Keeps a small per-session note — the original task and any files the user
attached — and re-injects it as system context on every compaction, so the reason
a session started survives summarisation. Captured on the first prompt only and
never rewritten, so a summary claiming the goal changed cannot overwrite the
original ask. State lives in durable plugin storage keyed by session and is
pruned lazily after 14 days.

### `inspector` and `tokens` (CLI)

`inspector` renders what opencode actually loaded at the current location into
`sidebar.content`: the agents, slash commands, and skills, each as a section that
starts collapsed and expands or collapses on **mouse click**. MCP servers are
deliberately absent — opencode already shows those itself.

`tokens` shows per-model throughput and cache rate: one live line in
`prompt.footer.status` plus a collapsible panel in `sidebar.content`.

`.opencode/skills/opencode-plugin-dev/` is the opencode v2 plugin development
guide, including which builtin plugins already exist. It stays project-scoped
with the rest of this repository's opencode configuration.

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
nvm/Node.js LTS when `npx` is absent, and `npm install -g @ast-grep/cli`.

`npx` is a hard prerequisite for the `sequential-thinking` MCP server, which is
in the global layer and therefore started in every project. Ubuntu's archive
ships an outdated Node.js, so use nvm and `nvm install --lts` rather than apt,
and never `sudo npm install -g`.

Run it any time:

    bash .kilo/suggest-tools.sh

## Gotchas

- An interactive alias is not an executable. After `sudo apt install fd-find`
  the binary is `fdfind`, not `fd`. `scripts/doctor.sh` reports this.
- Verify `ast-grep`, not `sg`. On Ubuntu `sg` can be an unrelated system
  command, so the alias is `asg`.
- `instructions` in an opencode config file is accepted but not loaded. Use
  `AGENTS.md` for instructions.
- Do not mix the two MCP config shapes. Under `mcp`, the servers object is
  either `{ "servers": { ... } }` or a flat `{ "name": { ... } }`; if any flat
  key is present the nested `servers` object is silently ignored. This
  repository uses `servers`, which is what opencode v2.0.26 loads.
- A plugin that fails to load can print nothing at all. Check positively with
  `opencode api get /api/plugin`, which lists every plugin with its source and
  `active` status. Note it resolves against the service's location, which is
  not necessarily the directory you launched from.

## Validation

Agent-facing config is covered by the same suite as the Bash:

    bash scripts/check.sh      # includes a JSON group for .opencode/.kilo/.vscode/config
    bash scripts/check.sh --syntax-only
