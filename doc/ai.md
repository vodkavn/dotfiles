# AI coding cheatsheet

Agent configuration for [opencode](https://opencode.ai). Project-scoped files
live under `.opencode/`, mirroring `.kilo/` for Kilo, so `AGENTS.md` stays
tool-neutral. Files that must apply to every project live under `config/` and
are linked into `$HOME` by `install.sh`.

## Layout

    config/opencode/opencode.json          global: shell, formatter, compaction,
                                           websearch, update, agents, references,
                                           MCP servers
    config/opencode/commands/new-ai.md     global: /new-ai scaffolder
    config/opencode/skills/                global: requirement-doc, design-review,
                                           test-scenario, deliverable-trace,
                                           release-rollback, workspace-hygiene
    config/opencode/plugins/               global: inspector (TUI)
                                           shell-guard, compaction-memory (server)
    .opencode/opencode.json                 project: permissions, watcher, worktree
    .opencode/commands/*.md                 slash commands
    .opencode/agents/reviewer.md            read-only review subagent
    .opencode/skills/                       project: opencode-plugin-dev,
                                           dotfiles-change

`config/` follows the repository-wide rule that a path is named after the
`$HOME` dotfile it becomes, so `config/opencode/opencode.json` is
`~/.config/opencode/opencode.json`, as `vim/` is `~/.vim` and `gitconfig` is
`~/.gitconfig`.

Configuration is strict JSON so `scripts/check.sh` can validate it with `jq`.
The `$schema` key still gives editors validation and autocomplete.

## Two layers

`install.sh` links the global layer into `~/.config/opencode/`. opencode loads,
in increasing precedence:

1. `~/.config/opencode/opencode.json` — global
2. `~/.config/opencode/` — global agents, commands, skills
3. `.opencode/opencode.json` — project
4. `.opencode/` — project agents, commands, skills

Agents, skills, and commands **replace** global ones by ID, so a project
overrides one global entry without disturbing the others. Permission arrays are
the exception: they **concatenate**, global first, last match wins.

The dividing line is reuse, not tool. The global layer carries CLI-wide
settings, MCP servers, agents, the `/new-ai` command, the working-method
skills, and the plugins. The project layer keeps this repository's own commands
and every permission rule.

Method is portable only when it carries no project-specific assumptions. A
global skill must survive being read in a repository that shares nothing with
the one it was written in, so any reference to a particular directory layout,
tracker, framework, or issue system means it belongs in that project. When
adapting existing material, rewrite the reasoning and strip the source
project's paths and identifiers; keep the judgement calls, which transfer.

Because permission rules concatenate, a global `deny` is a floor a project can
override but not escape — so the global layer defines no permission rules at
all.

Two traps:

- `~/.opencode` is opencode's own **data** directory (it holds `bin/`), not its
  config directory. Never link this repository's `.opencode` there, or it
  shadows the binary and injects `/validate` and `/doctor` into every project.
- opencode caches configuration when its service starts. After adding or moving
  a config file, restart opencode or the change is ignored.

## What `install.sh` links

The global layer is discovered from the filesystem rather than a list. Under
`config/opencode/` it links each top-level `*.json` file, each directory inside
`plugins/` **individually**, and every other top-level directory whole
(`commands/`, `skills/`, and anything added later).

Plugins are expanded one by one on purpose. Linking `plugins/` wholesale would
merge this repository's plugins into `~/.config/opencode/plugins/`, the same
place `opencode plugin add` installs community packages as real directories.
Linking each separately leaves those alone, and the existing check — skip when
the destination is already a symlink pointing into this checkout — never
matches a community plugin.

The practical consequence: **adding a plugin, agent, command, or skill under
`config/opencode/` needs no edit to `install.sh`.** Drop the file in and re-run
the installer. `case_ai_config_link_discovery` in `tests/run.sh` pins both the
discovery rule and the current set of shipped plugins.

## Slash commands

Global, available in every project:

    /new-ai <agent|skill|command>   scaffold one in the current project's .opencode/

`/new-ai` creates **project-level** files relative to the directory you are
standing in, because an agent scoped to one codebase does not belong in the
global layer. It writes a skeleton with valid frontmatter, then plans the real
content before filling it in.

Project commands, typed in the opencode TUI:

    /validate         run scripts/check.sh and report the result
    /doctor           run scripts/doctor.sh (read-only diagnostics)
    /review-changes   review uncommitted changes via the reviewer subagent
    /new-module       plan a new alias/completion/plugin module

`/validate` and `/doctor` use shell blocks, which run when the command is
evaluated rather than through the agent's permission flow. They only ever run
this repository's own scripts.

The repository command is named `/review-changes` because opencode ships a
builtin `/review` accepting `[commit|branch|pr]`, so both stay available.

## Permissions

Project-scoped, in `.opencode/opencode.json`. Broad `allow` rules come first
because the last matching rule wins. The denies encode rules that would
otherwise only be prose in `AGENTS.md`:

- never run `sudo`, `curl`, or `wget` from an agent
- never run `install.sh`
- never edit `tmux/plugins/`, `vim/bundle/`, or `vim/autoload/pathogen.vim`
- never write `.env` files
- `git push` asks first

The `sudo`/`curl`/`wget` rules are repo-agnostic and the global **shell-guard**
plugin enforces them in every project, so these entries are defence in depth.

## Global settings

These live in `config/opencode/opencode.json` and apply in every project on any
machine this repository is installed on.

### `agents`

One global primary agent, `doc-writer`, for documentation work. Its system
prompt encodes the rules that matter most when a model writes docs rather than
code: match the voice and frontmatter of the document being edited, and verify
every command, flag, and path before writing it down. A plausible command that
does not exist is the worst output this agent can produce. It is `mode: primary`
so it can be selected with `/agent doc-writer`, but it does not override the
default agent for coding sessions.

### `references`

`references` gives opencode named access to directories outside the current
project and advertises each through its `description`, so the agent knows _when_
to reach for it. Attach one in the client, then ask for what is needed.

**This block is empty.** A document corpus is a per-project fact — the right path
for a requirements repo is not the right path for a code repo — and a global
reference wrong for most projects is worse than none. Declare references in the
project that owns them:

```jsonc
{
    "$schema": "https://opencode.ai/config.json",
    "references": {
        "specs": {
            "path": "./02_docs",
            "description": "Business knowledge base, glossary, and solution docs.",
        },
    },
}
```

Write a relative path as `./docs`, not `docs` — a bare value with no prefix is
read as a _Git repository_. An unresolvable reference is ignored without
warning, so confirm the path exists.

### `websearch`, `update`, `compaction`

`websearch.provider` is `random`, picking an available provider automatically
instead of leaving search unconfigured. `update` is `notify`, the default, stated
explicitly so a work machine does not silently auto-install a new release.

    "compaction": {
        "auto": true,
        "keep": { "tokens": 15000 },
        "buffer": 20000
    }

`keep.tokens` is the recent tail preserved verbatim when a summary happens; this
keeps the _recent detail_, while the **compaction-memory** plugin protects the
_original ask_. Raise it for long documentation sessions.

### `formatter`

Enabled globally, with the built-in `prettier` entry overridden to run through
`npx`. It applies to **`.mdx` only**:

    "formatter": {
        "prettier": {
            "command": ["npx", "-y", "prettier", "--write", "$FILE"],
            "extensions": [".mdx"]
        }
    }

Overriding `command` and setting `extensions` explicitly is what makes this run
without a `package.json` in the target project, which a documentation or
requirements repository usually does not have.

**`.md` is deliberately excluded.** Prettier normalises Markdown tables
unconditionally and no flag turns it off: `--prose-wrap preserve`,
`--print-width 1`, and `--no-config` each left 88 lines changed in one test
table, while a project-local `.prettierignore` left 0. Requirement tables often
align columns with non-breaking spaces, which prettier converts to ordinary
spaces and reflows, so a customer-facing document comes back looking corrupted.
Because the formatter runs after every `write`/`edit`, an agent asked to fix one
typo in a table would silently restyle the whole file. A global config cannot
reach a project-local ignore file, which is why `.md` is dropped rather than
configured more narrowly.

Enable it per project where table normalisation is actually wanted, with
`"extensions": [".md"]`.

## Plugins

Three plugins in `config/opencode/plugins/`, all global. `inspector` is a CLI
plugin that draws; `shell-guard` and `compaction-memory` are server plugins that
only change behaviour.

Community packages are a separate mechanism: `opencode plugin add <pkg>`
installs into the same directory as real directories the installer leaves alone
(see [What `install.sh` links](#what-installsh-links)). Pin the version
(`opencode plugin add <pkg>@1.2.0`) so machines do not drift.

Discovery is by **flat sibling filenames**, not a `package.json` manifest: a
directory holding only `index.ts` loads fine as a server-only plugin, while one
with `index.ts` plus `tui.tsx` also gets a terminal half.

### `shell-guard` (server)

Denies `sudo`, `doas`, `su`, `curl`, `wget`, and `apt*` before the shell runs
them, in every project, via the v2 `shell.hook("create.before")` hook. This
replaces re-spelling `sudo *` as a permission rule in each project config and
rejects with a reason the model reads instead of a silent permission prompt.

It matches **command position**, not substrings, by tokenising the command and
testing each command's command word. `grep -r curl src/` and `echo 'use curl
later'` are allowed; `echo hi && sudo rm -rf /` is not.

It resolves rather than pattern-matches the ways a blocked word is normally
hidden, borrowing the approach from [cc-safety-net](https://github.com/kenryu42/cc-safety-net)
without adopting its shell parser. Peeling transparent wrappers (`env`, `nohup`,
`time`, `nice`, `timeout`, `xargs`, …) reaches the real command; shell keywords
and brace groups (`for …; do`, `if …; then`, `{ …; }`) are skipped; command
substitution (`` `sudo id` ``, `"$(sudo id)"`) and a shell's own script
(`bash -c 'sudo id'`) or `find -exec` predicate are recursed into. A heredoc body
is read as data, so writing a note that *mentions* `sudo` still works.

It remains a guardrail, not a sandbox, because it reads text rather than
intercepting execution. `eval "$CMD"`, a wrapper it cannot resolve, and a
blocked word held in a variable (`S=sudo; $S id`) all pass. Nesting stops at
depth 4. Treat a pass as "no obvious foot-gun", never as "proven safe". To
tighten or loosen the list, edit the `BLOCKED` map at the top of `index.ts`.

### `compaction-memory` (server)

Keeps a small per-session note — the original task and any files the user
attached — and re-injects it as system context on every compaction, so the
reason a session started survives summarisation. It is captured on the first
prompt only and never rewritten, so a summary claiming the goal changed cannot
overwrite the original ask. State lives in durable plugin storage keyed by
session and is pruned lazily after 14 days. Because that storage is durable and
shared across plugin versions, the note is re-validated on read rather than
trusted: a note whose `files` is not an array is dropped, not rendered.

`event.result` is left unset, so this is not a custom summariser — opencode
performs the compaction and this plugin only shapes what the summariser reads.

### `inspector` (CLI)

Renders what opencode actually loaded at the current location into
`sidebar.content`: agents, slash commands, and skills, each a section that
starts collapsed and toggles on **mouse click**. MCP servers are deliberately
absent — opencode already shows those itself.

The location is resolved per render from the session on screen, and `sync()` is
issued when it changes, so switching project or worktree repoints the panel
rather than leaving it listing whatever was loaded at startup.

Plugin-authoring constraints worth knowing before editing the TUI plugin: no
comment may sit inside a JSX expression (opencode's transform compiles one into
a text node and OpenTUI rejects the region with `Orphan text error`), and click
targets act on pointer release rather than pointer press.

`.opencode/skills/opencode-plugin-dev/` is the opencode v2 plugin development
guide, including which builtin plugins already exist. It stays project-scoped
with the rest of this repository's opencode configuration.

## Shell integration

`worktree.directory` is `.lane/trees`, so `opencode` worktrees land inside the
checkout and are gitignored. Start one with `/worktree`.

In tmux, `M-o` opens opencode in a popup on the current directory. The binding
is guarded, so it reports that opencode is missing rather than opening a dead
pane.

Aliases in `bash/aliases/enable/ai.aliases.bash`, all gated on the executable
existing:

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

`bash/aliases/enable/git.aliases.bash` defines `gh` as "cd to the Git root", and
bash expands aliases only in the first word, so `gh pr list` would expand to
`cd "$(git rev-parse --show-toplevel)" pr list` and fail. That alias is kept for
muscle memory and every GitHub CLI alias routes through `command gh`; the
Git-root behaviour is also `gtop`. `gl` is taken by `git log`, so `glab` keeps
its full name.

## Optional tools

`.kilo/suggest-tools.sh` prints, without installing anything, what the AI
toolchain is missing, with upstream install links for `glab`, difftastic, nvm
(Node.js LTS when `npx` is absent), and `npm install -g @ast-grep/cli`:

    bash .kilo/suggest-tools.sh

`npx` is a hard prerequisite for the `sequential-thinking` MCP server, which is
global and therefore started in every project. See `AGENTS.md` for the toolchain
policy — verify before using, suggest but never install, and never
`sudo npm install -g`.

## Gotchas

- An interactive alias is not an executable. After `sudo apt install fd-find`
  the binary is `fdfind`, not `fd`. `scripts/doctor.sh` reports this. Same for
  `bat`/`batcat`.
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
  `active` status. It resolves against the service's location, which is not
  necessarily the directory you launched from.

## Validation

Agent-facing config is covered by the same suite as the Bash:

    bash scripts/check.sh      # includes a JSON group for .opencode/.kilo/.vscode/config
    bash scripts/check.sh --syntax-only

See `AGENTS.md` for exit codes and prerequisites.