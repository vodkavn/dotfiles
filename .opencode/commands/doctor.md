---
description: Run read-only prerequisite and path diagnostics (scripts/doctor.sh)
agent: plan
---

Run the read-only environment diagnostics for this dotfiles repository.

!`bash scripts/doctor.sh 2>&1 | tail -n 60`

Report:

- Any `BLOCKED:` prerequisite, quoted verbatim with the `sudo apt install`
  suggestion it prints. Never run the install yourself; the user reviews it.
- Any `OPTIONAL:` tool that is absent, especially the `fd` and `bat` lines that
  explain why an interactive alias does not make those executables available to
  agents.
- Any managed shell path that is not a symlink into this repository.

`doctor.sh` is read-only. Do not install, configure, or source anything in
response to its output; surface the suggestion and stop.
