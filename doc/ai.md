# AI coding cheatsheet

Agent configuration for [opencode](https://opencode.ai). Project-scoped files
live under `.opencode/`, mirroring `.kilo/` for Kilo, so `AGENTS.md` stays
tool-neutral. Files that must apply to every project live under `config/` and
are linked into `$HOME` by `install.sh`.

## Layout

    config/opencode/opencode.json          global: shell, formatter, compaction,
                                           websearch, update, references, lsp,
                                           tool_output, MCP servers
    config/opencode/AGENTS.md               global: the machine-wide rules, read
                                           in every project
    config/opencode/commands/new-ai.md     global: /new-ai scaffolder
    config/opencode/commands/shortcut-debt.md
                                           global: /shortcut-debt deferral ledger
    config/opencode/skills/                global: requirement-doc, design-review,
                                           test-scenario, deliverable-trace,
                                           release-rollback, workspace-hygiene,
                                           tech-doc, minimal-change,
                                           change-review
    config/opencode/plugins/               global: inspector, subagent-watch,
                                           provider-usage, tui-shortcuts (TUI);
                                           shell-guard, tool-guard,
                                           compaction-memory (server)
    package.json, tsconfig.json            the npm tree and the settings that
                                           type-check the plugins
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
settings, MCP servers, the `/new-ai` command, the working-method skills, the
global rules file, and the plugins. The project layer keeps this repository's
own commands and every permission rule.

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

## The global rules file

`config/opencode/AGENTS.md` is linked to `~/.config/opencode/AGENTS.md`, and
opencode reads that file in **every** session, in every project. It is the one
mechanism the host provides for machine-wide instructions: `AGENTS.md` is read
from the project, so without it the rules that hold on this machine are
invisible from a project that has no rules file of its own.

The global file is read **before** the project's own `AGENTS.md`, so a project
overrides it where the two disagree. It carries the portable half of this
repository's rules — the working method, the tool policy, and the reporting
discipline — and nothing that assumes a particular directory layout.

The `instructions` key in an opencode config file is the other candidate
mechanism, and it does not work: the key is accepted and nothing is loaded
from it. `AGENTS.md` is the mechanism that works.

## What `install.sh` links

The global layer is discovered from the filesystem rather than a list. Under
`config/opencode/` it links each top-level `*.json` file, the top-level
`AGENTS.md`, each directory inside `plugins/` **individually**, and every other
top-level directory whole (`commands/`, `skills/`, and anything added later).

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
    /shortcut-debt                  list deferred work as a ledger, and flag the
                                    deferrals that have no trigger to revisit them

`/new-ai` creates **project-level** files relative to the directory you are
standing in, because an agent scoped to one codebase does not belong in the
global layer. It writes a skeleton with valid frontmatter, then plans the real
content before filling it in.

`/shortcut-debt` reads and reports; it changes nothing. It greps the working
tree for `shortcut:` markers and the usual `TODO`/`FIXME`/`HACK`/`XXX` ones,
reads each hit to find the limit it names and the trigger that should retire
it, and reports one row per marker. A marker that names a limit but no trigger
is tagged `no-trigger` and sorted to the top: that is the deferral that
quietly becomes permanent. The `shortcut:` convention itself is written by the
`minimal-change` skill.

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

## Skills

Nine global working-method skills in `config/opencode/skills/`, one directory
each: `requirement-doc`, `design-review`, `test-scenario`, `deliverable-trace`,
`release-rollback`, `workspace-hygiene`, `tech-doc`, `minimal-change`, and
`change-review`.

A skill is advertised to the model through its `description` and loaded on
relevance, so a method that only matters for some tasks costs nothing on the
others. It applies to whichever agent is already running.

A skill's frontmatter `name` is its **id**, and the id is the directory name:
`deliverable-trace`, not `Deliverable Trace`. The Agent Skills spec requires
the name to match the directory and to be lowercase-hyphenated, and opencode
also reads `~/.claude/skills/` and `~/.agents/skills/`, where other tools
validate it strictly. The id is what the model passes to the skill tool.

Two skills that could claim the same document are divided by an explicit
boundary rather than by a description that happens to differ. An **architecture
decision record** is `design-review`'s, because the alternatives and the
consequences are the point of recording it; a README, a runbook, and a how-to
guide are `tech-doc`'s.

`tech-doc` carries the documentation method: match the voice and frontmatter
of the document being edited, and verify every command, flag, and path before
writing it down. A plausible command that does not exist is the worst output
this can produce.

`minimal-change` and `change-review` are the two halves of one method.
`minimal-change` is the decision procedure: read the code the change touches,
then stop at the first rung of the ladder that fully works — does it need to
exist, is it already in this codebase, does the standard library do it, is it
an installed dependency, is it one line, otherwise the minimum that works. It
also names what is never cut, and the `shortcut:` marker for a deliberate
shortcut with a known limit. `change-review` is the same method turned
backwards: read the code a change touches rather than only the diff, find the
load the project actually has, and report the findings ranked, each with the
case that proves it.

They are separate skills because they apply at different moments — one before
the change, one after — and a skill is loaded on relevance, so a session that
is only writing code never pays for the review method.

**Documentation method is a skill rather than an agent.** An agent is a named
profile a session switches to — its own system prompt, model, and permissions
— and selecting one is a manual `/agent` step. That is the wrong shape for
editorial method: the content needs no identity, no separate model, and no
permissions of its own, and it is worth more applied to the session that
already holds the code being documented than re-explained in a fresh one.

A **subagent** is the other option, and it is not much better. A subagent runs
in a child session with fresh context, so the documentation task has to be
handed over with everything it needs spelled out, and the result handed back.
For a method that is mostly *how to phrase a sentence in the file already
open*, that is a worse fit than a skill, which is loaded into the session doing
the work.

## Global settings

These live in `config/opencode/opencode.json` and apply in every project on any
machine this repository is installed on.

### `references`

`references` gives opencode named access to directories outside the current
project and advertises each through its `description`, so the agent knows _when_
to reach for it. Attach one in the client, then ask for what is needed.

The global block carries one reference — this repository:

```jsonc
{
    "$schema": "https://opencode.ai/config.json",
    "references": {
        "dotfiles": {
            "path": "~/.dotfiles",
            "description": "The global layer of this machine's dotfiles: AGENTS.md holds the rules that apply in every project, doc/ai.md the opencode configuration, and config/opencode the global plugins.",
        },
    },
}
```

It is there because a reference is something the agent reaches for, and the
rules that apply on every machine used to be invisible from a project that is
not this repository. The global `AGENTS.md` now carries the portable rules
into every project by itself; the reference is what carries the parts that
only this repository has — the layout, the validation commands, the gotchas
that are specific to these files.

A document corpus is a per-project fact — the right path for a requirements repo
is not the right path for a code repo — so a corpus belongs in the project that
owns it:

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

### `lsp`

`lsp` is `true`, which enables opencode's built-in language servers. **The key is
accepted but nothing runs behind it in v2.0.32.** The release carries the
configuration schema and the `lsp.updated` event, but no server manager: no
language server starts, and nothing is downloaded. The documentation for the
feature describes auto-installing a server on first use and feeding its
diagnostics back to the agent — behaviour that belongs to a release that has not
shipped, and 2.0.32 is the newest v2 tag.

The setting stays because it is inert, because it is the key a release with the
runtime would read, and because the servers it would start are chosen per
project rather than by this file. When it does take effect, a missing server is
downloaded on first use — `OPENCODE_DISABLE_LSP_DOWNLOAD=true` stops that.

For the same reason `AGENTS.md` remains the place where the agent is told how
to check its work: `bash -n` and `shellcheck -s bash` for Bash, and the
`tsc --noEmit` group for the plugins. Those run as ordinary tool calls, which
is what opencode's own documentation recommends over a language server.

### `tool_output`

`tool_output` caps how much of a tool's output reaches the model. The defaults
are 2000 lines and 51200 bytes; this repository lowers them to 1000 and 16384.

A 50 KB tool result is roughly twelve thousand tokens, and the compaction
settings keep fifteen thousand tokens of context — so one large read can fill
the budget on its own. Truncated output is saved to disk rather than dropped,
so the agent can still read the rest of it.

    "tool_output": {
        "max_lines": 1000,
        "max_bytes": 16384
    }

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

Seven plugins in `config/opencode/plugins/`, all global. `inspector`,
`subagent-watch`, `provider-usage` and `tui-shortcuts` are CLI plugins that
draw; `shell-guard`, `tool-guard` and `compaction-memory` are server plugins that
only change behaviour. The CLI ones still ship a server entry: discovery needs
`index.ts` beside `tui.tsx`, and it is what carries the plugin id into the storage
namespace.

Community packages are a separate mechanism: `opencode plugin add <pkg>`
installs into the same directory as real directories the installer leaves alone
(see [What `install.sh` links](#what-installsh-links)). Pin the version
(`opencode plugin add <pkg>@1.2.0`) so machines do not drift.

Discovery is by **flat sibling filenames**, not a `package.json` manifest: a
directory holding only `index.ts` loads fine as a server-only plugin, while one
with `index.ts` plus `tui.tsx` also gets a terminal half.

### `shell-guard` (server)

Denies `sudo`, `doas`, `su`, `curl`, `wget`, `apt`, `apt-get`, and `aptitude`
before the shell runs them, in every project, via the v2
`shell.hook("create.before")` hook. This replaces re-spelling `sudo *` as a
permission rule in each project config and rejects with a reason the model reads
instead of a silent permission prompt.

It matches **command position**, not substrings, by tokenising the command and
testing each command's command word. `grep -r curl src/` and `echo 'use curl
later'` are allowed; `echo hi && sudo rm -rf /` is not. Only the three package
entry points above are blocked, so `apt-cache`, `apt-mark` and `dpkg` still run —
reading package state is not the same act as changing the system.

It resolves rather than pattern-matches the ways a blocked word is normally
hidden, borrowing the approach from [cc-safety-net](https://github.com/kenryu42/cc-safety-net)
without adopting its shell parser. Peeling transparent wrappers (`env`, `nohup`,
`time`, `nice`, `timeout`, …) reaches the real command; shell keywords
and brace groups (`for …; do`, `if …; then`, `{ …; }`) are skipped; command
substitution (`` `sudo id` ``, `"$(sudo id)"`) and a shell's own script
(`bash -c 'sudo id'`) or `find -exec` predicate are recursed into. A heredoc body
is read as data, so writing a note that *mentions* `sudo` still works.

A substitution **in command position** is the command itself — the shell
substitutes before it resolves the command — so `$(echo sudo) id` runs `sudo`.
The word a substitution prints is therefore read and checked as a command word
of its own. Only the bodies whose output can be told off the text are read:
`echo`, `printf`, and `which`. `$(basename /usr/bin/sudo) id` is not, because
reading it would mean running it.

`xargs` is the wrapper that breaks the pattern: its operand is substituted rather
than named, so `xargs sudo id` is caught but **`xargs -I {} sudo id` is not** —
`{}` is read as the command and the real one is never reached. The same applies
to `xargs -I {} sh -c '…'`. This is the plugin's own stated limit, not an
oversight, but it is the case most likely to come up in practice.

It remains a guardrail, not a sandbox, because it reads text rather than
intercepting execution. `eval "$CMD"`, a wrapper it cannot resolve, a blocked
word held in a variable (`S=sudo; $S id`), and a substitution whose output
cannot be told (`$(basename /usr/bin/sudo) id`) all pass. Nesting stops at
depth 4. Treat a pass as "no obvious foot-gun", never as "proven safe". To
tighten or loosen the list, edit the `BLOCKED` map at the top of `index.ts`.

### `compaction-memory` (server)

Keeps a small per-session note — the original task and any files the user
attached — and re-injects it as system context on every compaction, so the
reason a session started survives summarisation. The **task** is captured on the
first prompt only and never rewritten, so a summary claiming the goal changed
cannot overwrite the original ask; the **file list** accumulates across prompts
instead, deduplicated and capped. State lives in durable plugin storage keyed by
session and is pruned lazily after 14 days. Because that storage is durable and
shared across plugin versions, the note is re-validated on read rather than
trusted: a `files` that is not an array is replaced with an empty list and a note
with no task is dropped, so a note written by an older version is rendered
degraded rather than throwing mid-compaction.

`event.result` is left unset, so this is not a custom summariser — opencode
performs the compaction and this plugin only shapes what the summariser reads.

It also warns the agent **once per compaction, after the fact**. The trigger is
the count of `compaction` markers already in `event.messages` — a fact — rather
than a token estimate, which would be a guess about a number the hook is not
given. Once a transcript has demonstrably been summarised, the agent is told
that anything it decided but did not write down is gone, and to write decisions
into the transcript as it goes. The warning map is capped at 16 sessions.

### `subagent-watch` (CLI)

A **Subagents** section in `sidebar.content`: one row per *running* subagent of
the session on screen, and clicking a row focuses that subagent.

opencode's own subagent list lives in the composer, behind a keybind, and
disappears the moment you act on it. Delegated work is the one thing the
transcript cannot show — a subagent runs as a session of its own, so its
messages never appear in the one on screen and a long-running one looks exactly
like a hang. This puts the list in permanent chrome instead.

**Only running subagents are listed.** A finished one is history, already readable
in the session list; keeping it here pushed the live rows down the sidebar and
left the section full of rows that never changed again. The section therefore
shrinks back to nothing as the work it reports completes. Newest is on top, so the
one just delegated is the one you have not read.

The filter is applied to the rows, not to the walk: a running subagent whose
parent has finished is still listed, because dropping the subtree under a stopped
parent would hide work that is genuinely in flight.

Each row is **two lines**: the head carries a spinner frame, the agent and the age
(`⠸ general 5m`), and the body carries the task one step in, under the agent name.
Split rather than truncated into one line because a single line spends its budget
on the title, which is the one field you do not scan for. A row with no title is
one line.

The spinner turns because the plugin repaints on a 120 ms tick while a row is on
screen: a running subagent can be quiet for minutes, and no store change would
otherwise arrive to advance the glyph. The frame is derived from the clock rather
than counted, so a coalesced repaint skips a frame instead of desyncing from real
time. Depth 1 draws flush with the section header's marker, so the spinner reads
as that row's bullet and nesting is what adds indentation.

Line width is the one place this plugin depends on a host constant. The sidebar
is a fixed 42-column box with 2 columns of padding either side, and the box that
carries the `sidebar.content` slot adds one more on the right, so a line gets 37.
That is not exposed to the slot — its input carries only `sessionID` — so
`panel.ts` holds it as `WIDTH`, and a test pins the arithmetic. It is a
preference rather than a correctness requirement because the text elements are
given `wrapMode="none"`: a stale constant costs the ellipsis, where wrapping
would turn every two-line row into three and push the section off the bottom.

What is listed is the subtree *below* the session on screen, linked on
`parentID`. opencode's own list is `family(sessionID)` minus the session, which
only holds while the session is the root of its family — once you have clicked
into a subagent, the same subtraction reports the *parent* as a child. Linking
instead stays correct at any depth. It therefore draws nothing inside a subagent
that has none, which is also why there is no sibling view to hop back out with.

Things the implementation is explicit about:

- **Nothing is drawn when there are no subagents.** A permanent `Subagents (0)`
  row teaches the eye to skip the section, which is the opposite of what it is
  for — the same reasoning the inspector's Config block uses.
- **`session.status()` returns a status *name*** (`"running"` / `"idle"`), not
  the status object the server's `session.status` event carries. Reading `.type`
  off a string yields `undefined`, indistinguishable from "no status", so both
  shapes are accepted. An absent status yields `""` rather than throwing: a
  `TypeError` raised in this read is thrown from inside the render loop and takes
  the whole sidebar down, not just this section.
- **The sync window is bounded at 64 keys**, evicting oldest-first. A set that
  only grew would hold one key per session ever opened; a single-slot cache would
  re-sync on every switch. A key is removed on rejection, so a failed sync is
  retried by a later render rather than costing that session its list for the
  life of the TUI.
- **Two mechanisms populate the family map**, and only one is this plugin's job.
  The store re-families on its own when a session is created under another, which
  is how a subagent delegated after this plugin looked still appears;
  `sync(id, { children: true })` pulls the children of a session the store has not
  otherwise fetched, which is the cold-start case. The second argument is not in
  the published docs and is verified against v2.0.28 — if a future host ignores
  it, the failure is a thinner list rather than an empty one.
- **The caller does not read the store inside the sort comparator.** The walk is
  one pass to link `parentID`, one to read each sort key, one to describe each
  row; a comparator calling `session.get()` would add ~2n·log2(n) reads per
  repaint. A test counts the reads rather than timing them, so it pins the
  property instead of the machine.

Clicking calls `context.ui.router.navigate({ type: "session", sessionID })`,
which is what opencode's own subagent row calls and what its tab layer calls
under the hood, so it both switches session and focuses the tab when session tabs
are enabled. The action is on `onMouseUp` and `onMouseDown` only stops
propagation; the release counts only when it lands on the row that was pressed,
so a press-and-drag-away cancels instead of opening a session you did not click.


### `tool-guard` (server)

Notices when the agent is repeating a failing tool call, and says so once in the
system context of the next model call. A tool that fails does not end a run: the
model sees the error, retries, sees it again. That loop fills the transcript with
near-identical errors while nothing raises, so it is invisible from outside.

It fires only on a *streak*: the same tool, the same normalised error (digits
collapsed, so a changing exit code or line number is still one error), three
times running with no success of that tool in between. Three different errors is
exploration, and is left alone. A success from the same tool clears the streak.

It never blocks. Blocking a tool the agent is retrying would remove the very
signal that would let it recover. The nudge is announced once per distinct loop,
and again only if that loop grows by another three.

**Its state is bounded, which is the whole design constraint.** The removed
`tokens` plugin leaked a per-session map fed by global server events. This one
tracks at most 16 sessions (least recently used evicted) and at most 8 failures
each, and a read never creates an entry — otherwise every model call for a
session it has nothing to say about would grow the map. A test asserts the
retained count under a flood of 5,000 sessions.

What it does not detect: a loop where every call succeeds but makes no progress,
and a stall with no tool calls at all. Both need a progress signal the agent does
not currently emit.

### `inspector` (CLI)

Renders what opencode actually loaded at the current location into
`sidebar.content`: agents, slash commands, and skills, each a section that
starts collapsed and toggles on **mouse click**. MCP servers are deliberately
absent — opencode already shows those itself.

The location is resolved per render from the session on screen, and `sync()` is
issued when it changes, so switching project or worktree repoints the panel
rather than leaving it listing whatever was loaded at startup.

It also renders a **Config** block at the top of the panel, and only when
something is actually wrong, for two failures that are otherwise silent:

- a plugin symlink whose target no longer exists — opencode still walks the
  directory it lives in, so a plugin deleted from this repository left a dangling
  `~/.config/opencode/plugins/<name>` behind until install.sh learned to prune it
- a plugin directory with no sibling `index.ts` or `tui.tsx`, which the
  discovery rule skips *without a message*

The scan reads the filesystem (`inspector/drift.ts`) rather than
`ctx.client.plugin.list()`, because the reported list says what loaded, not what
was meant to — a silently-skipped plugin is invisible in it. It is cached per
project directory, so it does not re-walk on every repaint. A symlink's target
is resolved against the directory the link sits in, so a relative link is
judged by the file it actually points at.

Plugin-authoring constraints worth knowing before editing the TUI plugin: no
comment may sit inside a JSX expression (opencode's transform compiles one into
a text node and OpenTUI rejects the region with `Orphan text error`), and click
targets act on pointer release rather than pointer press.

### `provider-usage` (CLI)

A **Usage** section in `sidebar.content` showing what is left of each provider
plan this machine is connected to, as a percentage per quota window with the
reset countdown beside it — or, for a pay-as-you-go account, a money balance —
refetched on a timer and on a click of the **⟳ refresh** row. It reads the key
from opencode's own credential store (`client.credential.list()`), so there is
no second copy on disk.

**Only connected providers are shown.** The adapter registry is a superset;
the drawn set is its intersection with opencode's connected accounts, so a
provider with no active key is left out rather than drawn as "not connected".

Provider knowledge is isolated in `provider-usage/providers.ts`, the only file
that names a provider — adding one is an edit there alone. Each adapter declares
a path, a parser, and the **hosts it may be called on**, not a full URL: the
path is appended to a host the adapter vouches for, so a region variant
(`api.minimax.io` vs `api.minimaxi.com`) needs no second declaration. Two
response shapes are supported — `windows` (percent per window) and `credit` (a
money balance):

- **MiniMax Coding Plan** — `GET {origin}/v1/token_plan/remains`, which reports
  the percent *remaining* and answers HTTP 200 even for a rejected key, so
  `base_resp.status_code` is the real success signal
- **OpenCode Go** — `GET {origin}/zen/go/v1/usage`, whose `zen/` path is URL
  namespacing for the Go ("lite") plan; it reports the percent *used*, so the
  panel subtracts it
- **DeepSeek** — `GET {origin}/user/balance`, a prepaid balance rather than a
  window

**The host is not taken on trust from opencode.** The panel sends the
provider's *raw* credential to whatever host it ends up calling, and
`settings.baseURL` is project configuration: a repository's own `opencode.json`
can set it, and a repository is not trusted the way a provider is. A base URL
whose host is not on the adapter's list is refused, the request falls back to
the adapter's own origin, and the row shows the failure — the key is never
handed to a host nobody checked. Plain `http` is refused for the same reason.

There is **no universal usage endpoint** in opencode or models.dev to pull from:
those carry models, pricing, and context limits, not per-provider billing, and
each provider's quota API is its own. Only the credential store and the base
URL are inherited; the path, the hosts, and the parser are declared per
provider.

Every route is first-party but not stable API surface, so each field is read
defensively and a window that does not decode is skipped rather than allowed to
fail the panel; a connected provider whose fetch fails is drawn with the reason.
The presentation and freshness policy live in `provider-usage/panel.ts`, so
`tests/plugin-usage.test.mjs` exercises them without a live service.

A provider's answer is read with a cap and drawn through a sanitiser: the body
is abandoned past a megabyte, and control characters are stripped from the text
that reaches the sidebar, because a response is not trusted the way a provider
is.

`.opencode/skills/opencode-plugin-dev/` is the opencode v2 plugin development
guide, including which builtin plugins already exist. It stays project-scoped
with the rest of this repository's opencode configuration.

### `tui-shortcuts` (CLI)

Clickable shortcuts in the prompt footer: the agent opens the agent dialog, the
model opens the model dialog. Named for the surface rather than for the two things
it currently carries, so the next shortcut belongs here instead of in a new plugin.

opencode draws those names itself and a plugin cannot make host-rendered text
clickable — it can only fill the regions it is given. So the footer gains two
shortcuts of its own beside those readouts, rather than the existing names becoming
buttons, and each names **the action it performs** — `◆ switch agent` and
`◇ switch model` — instead of repeating a value the host already draws. Both are
registered on `prompt.footer.status`.

The placement is **`after`, not `append`**. The host's child inside that region is
a box with `flexGrow: 1`, and while a turn runs it draws a second one holding the
spinner and the interrupt hint; appending lands inside that boundary, after the
greedy child, so a shortcut there collapses to zero width for the whole of a turn
and only returns once idle. `after` makes it a sibling of the status box, where
the greedy child cannot reach it.

Each shortcut **dispatches opencode's own command** — `agent.list` and
`model.list`, the `<leader>a` and `<leader>m` commands — instead of opening a
picker built here. A local picker would have to reproduce search, favourites,
variants, and provider grouping, and would drift from them the first time the host
changed. Dispatch is also what opencode's own clickable footer rows do.

They are **two separate contributions, not one row of two boxes**: the verified
layout finding here is that a clickable row has to be one box holding one text,
and a second box beside it either stacks or needs a nesting level that stops the
region painting. The host composes that footer from several contributions already,
so two contributions is the shape it handles. Registration order is display order,
so the agent is registered first.

Each shortcut is **muted at rest and lights up under the pointer** (`onMouseOver` /
`onMouseOut`), the pair opencode's own secondary action uses: muted so the footer
still reads as chrome, the body colour on hover so the label reads as a target.

Naming the action rather than the value is the design, not a limitation worked
around. The model *could* be read the way the host reads it —
`context.ui.model.current()` — but the agent could not, and a footer where one
shortcut tracks and the other goes stale is worse than one where neither claims to.
The plugin context exposes `ui.model` and **no `ui.agent`** (the context's own keys
are `sessionTabs`, `model`, `slot`, `dialog`, `toast` and `format`, verified against
v2.0.32), the live selection lives in the host's local store, and the
`session.agent.selected` event arrives when opencode *applies* a switch rather than
when you cycle one. A caption that cannot be wrong is worth more than a second copy
of a name that can.

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

The opencode plugins are TypeScript, and node's type stripping erases types
without checking them, so the suite also type-checks them against the host's
own published types:

    npm ci                     # the repository-local tree the type check needs
    bash scripts/check.sh      # includes the tsc --noEmit group

`check.sh` skips that group when `node_modules/` is absent and says so; CI
installs the tree, so a skip there means a genuine gap. `package.json` holds
the tree and `tsconfig.json` the settings — `strict`, `noEmit`, and the host's
JSX runtime — and the lockfile is committed so CI and a local run resolve the
same dependency set.

See `AGENTS.md` for exit codes and prerequisites.