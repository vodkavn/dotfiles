---
description: Scaffold a new shell module, alias group, or completion file for $ARGUMENTS
agent: plan
---

Plan how to add: $ARGUMENTS

Work out the placement and the tests before writing anything, then confirm the
plan with the user.

Pick the correct destination first:

| Kind of change | File |
| --- | --- |
| Alias set | `bash/aliases/enable/<topic>.aliases.bash` |
| Personal overrides | `bash/aliases/custom.aliases.bash` |
| Completion generator | `bash/completion/enable/<tool>.completion.bash` |
| Shell function | `bash/plugins/enable/<topic>.plugin.bash` |
| Terminal/toolchain env | `bash/setup.bash` |
| Read-only diagnostics | `scripts/` |
| Isolated regression test | `tests/run.sh` |

Conventions the plan must respect:

- Alias and completion modules open with `cite 'about-alias'` (or
  `about-alias`/`about-plugin`) so `composure` can describe them, matching the
  neighbouring files.
- Anything that shells out to an optional tool must gate on `command -v` and
  stay completely silent when the tool is absent. An agent cannot use an
  interactive alias.
- Never define an alias whose name already exists in
  `bash/aliases/custom.aliases.bash` or another `enable/` module. `gl` is taken
  by `git log`.
- Four-space indent, LF, trailing newline, no trailing whitespace.
- Add a `case_*` function to `tests/run.sh` and a `run_case` line for anything
  with a gate or a failure path, following the existing isolated `run_child`
  pattern.

State the files to touch and the checks to run (`bash -n` per changed Bash
file, then `bash scripts/check.sh`) before making edits.
