---
description: Scaffold a project-level opencode agent, skill, or command
---

Create an opencode agent, skill, or command for the current project:
$ARGUMENTS

This command is global — it ships from the global layer and is available in
every project — but everything it writes is **project-level**. The agent,
skill, or command belongs to the project you are standing in, not to the
machine.

## Decide the kind first

Pick the kind from `$ARGUMENTS` before writing anything.

| Kind    | Path                               | ID        |
| ------- | ---------------------------------- | --------- |
| Agent   | `.opencode/agents/<name>.md`       | `<name>`  |
| Skill   | `.opencode/skills/<name>/SKILL.md` | `<name>`  |
| Command | `.opencode/commands/<name>.md`     | `/<name>` |

If `$ARGUMENTS` is ambiguous between two kinds, ask which one is meant before
creating a file. A wrong-kind file is worse than no file, because it is picked
up immediately and silently replaces the behaviour you were expecting.

`$ARGUMENTS` describes _what_ to create. It rarely supplies a usable name, so
derive one yourself.

## Choose the name

Lowercase kebab-case, 1–64 characters, matching `^[a-z0-9]+(-[a-z0-9]+)*$`.
Keep the directory name and the skill ID aligned; the ID comes from the path,
not from anything in the file.

Use a nested path when the project clearly groups things by team or domain:
`.opencode/agents/team/reviewer.md` becomes `team/reviewer`, and
`.opencode/commands/team/review.md` becomes `/team/review`. Do not nest just
because a category is imaginable — a single `reviewer.md` is better than a
`misc/reviewer.md`.

Check the target directory first and do not overwrite an existing file. If the
name is taken, say so and propose an alternative.

## Write the skeleton, then plan the content

Create the file with valid frontmatter and nothing more. Then describe what
the real content should be and confirm before filling it in. Do not invent a
full prompt from a one-line request; the description field is where the value
lives, and a wrong `description` misroutes every future agent that considers
loading it.

Every one of these three kinds is advertised to the model through its
`description`. A missing `description` hides the file instead of failing loudly,
so it is the one field that is never optional.

### Agent

    ---
    description: <what it does and when the model should reach for it>
    mode: subagent
    ---

    <role, constraints, what to report>

`mode` is the decision to make explicitly. Omitting it on a new custom agent
defaults to `primary`. Use `subagent` for work delegated from another agent
(reviewers, researchers, narrow specialists), `primary` for an assistant meant
to be selected directly, and `all` only when both are genuinely wanted.

For a read-only agent, deny `edit` and `shell` in frontmatter rather than only
asking the model to behave:

    permissions:
      - action: edit
        resource: "*"
        effect: deny

### Skill

    ---
    name: <Display Name>
    description: <what it covers and when to reach for it>
    ---

    ## Workflow

    1. <step>

`name` is a display label only. The ID is the path. Add `metadata` with
`opencode/autoinvoke: false` when the skill should load only by explicit
request. Put supporting scripts and references beside `SKILL.md`; paths written
inside the skill resolve relative to that directory.

### Command

    ---
    description: <what it does, as shown in the command list>
    ---

    <the prompt template>

The body _is_ the template — do not add a `template` field to frontmatter. Use
`$ARGUMENTS` for the whole argument string, `$1`, `$2` for positions. Add
`agent:` only to pin a different agent than the session already has. Wrap a
shell command in `` !`...` `` to inject its output before the prompt is
submitted; keep untrusted arguments out of shell blocks.

Only `.md` files are discovered, so do not scaffold a command as anything else.

## Confirm the result

Report the path, the ID or command name it will be invoked by, and the
proposed `description` verbatim. State the next concrete step — the content to
write, or the checks to run — and wait.

Commands reload automatically when the file is saved. Agents and skills are
registered at startup, so a newly created one may need opencode restarted
before it appears.
