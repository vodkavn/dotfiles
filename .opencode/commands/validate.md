---
description: Run the local validation suite (scripts/check.sh) and report the result
agent: plan
---

Run this repository's local validation suite and report the outcome.

!`bash scripts/check.sh 2>&1 | tail -n 60`

Interpret the output:

- `PASS: all selected checks` means syntax, isolated regression tests, ShellCheck,
  Git whitespace, and the JSON config group all passed.
- `FAIL:` lines name the failing check group. Report the first cause, not every
  symptom.
- `BLOCKED:` means a prerequisite is missing (usually ShellCheck or jq). Report
  the exact `sudo apt install` suggestion from the output and do not claim that
  validation passed.
- Exit code `2` is incomplete validation, not success.

Then summarize which groups passed, which failed, and what the next concrete
step is. Do not edit anything to make a check pass; report first.
