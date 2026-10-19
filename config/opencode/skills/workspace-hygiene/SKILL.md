---
name: workspace-hygiene
description: Keep a repository clean and its documentation current-state. Use when a note's placement is unclear, when a file looks unnecessary, or when documentation states what used to be true.
---

Three rules that keep a repository navigable after months of work: no trash
files, no documents about your own work, and no historical content in
documentation.

## No trash files

Do not create any of these unless explicitly asked:

- Scratch scripts (`scratch.*`, `tmp.*`, `debug-*`, `playground.*`)
- One-off output files (`output.json`, `result.txt`, stray `notes.md` at root)
- Backup copies (`*.bak`, `*.old`, `*.copy`, `* 2.ts`)
- Generated artifacts committed by accident (build output, coverage, screenshots)
- Status / summary / changelog Markdown documenting your own work session
- Documents overlapping ones that already exist

If something is needed only to verify behaviour, run it inline rather than
writing it to a file. If a temporary file is unavoidable, delete it before
reporting completion.

**Extend an existing document rather than creating a parallel one.** Before
adding a new file, search for the one that already covers the topic.

## No documentation of your own work

Do not create Markdown files summarizing what you changed. A short reply in
the conversation is sufficient; a file is not.

Put information where it belongs instead:

- **Open questions** → the open-questions section of the relevant document
- **A decision and its rationale** → inline in the document that contains the
  decision
- **Task status** → whatever tracker the project already uses

When tidying documentation, extend or condense the existing canonical files.
Never create archive, cleanup, or snapshot files beside them.

## No historical content

Documentation, comments, and design files describe the **current** state of
the system. Do not narrate past → present change in any prose, comment, header,
or section title.

A comment describes what the code _does_, never the work item that produced
it. No phase or gate labels, finding IDs, remediation plan names, or ticket
narration.

Forbidden patterns:

- "previously", "used to", "no longer", "is now", "after the refactor", "post-fix"
- "merges the old X", "old layout", "old 4 sections"
- Section titles like "Change history", "Changelog", "Migration notes", "What changed"
- Comments describing what a function _used to do_ or _was refactored from_

Rewrite declaratively: state the rule, not the transition. "This section does
X", not "This section now does X (was Y before)". Git owns the history.

**Summary fields in generated output are current-state descriptions, not
changelogs.** Do not append dated entries narrating what changed in a past run.
Readers see these fields as a description of current behaviour.

Historical context belongs in an open-questions section, or in git history —
which is the most authoritative record of when something changed and why.

## Placement

Before creating a file, match where equivalent files already live. Put a file
where a reader would look for it, not where it was easiest to write.

Never edit immutable inputs — customer-provided requirements, source records, or
anything designated as an original. If one needs a correction, say so rather
than editing it.
