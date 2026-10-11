---
name: Deliverable Trace
description: Audit a deliverable against its sources and back every finding with evidence. Use when reviewing documents, plans, audits, or any list of findings before delivery.
---

An unverified finding is not a finding. It is a guess with a confident tone,
and it costs the reader more time to disprove than it saves to state.

## The evidence line

Every claim carries one line of the form:

    verification: <command> → <output>

For a claim about a file, the path and line: `docs/design/foo.md:41`.
For a claim about behaviour, the command that demonstrates it and what it
returned.

A finding you cannot verify is not reported. Delete it, or mark it explicitly
as unverified and say what would settle it. Do not launder a guess through
confident prose.

## Counts come from reading, not estimating

When you say "three places are affected", re-read and count. Never infer a
count from a diffstat, a file listing, or a grep hit count — those count lines,
files, and occurrences, which are not the same as affected places. Getting this
wrong is the most common way an otherwise good audit loses the reader's trust,
and once it happens they discount the rest.

If the number cannot be established, say "at least N" and explain the bound.

## Conflicts are surfaced, not resolved

When two sources disagree, report both sides with their anchors and stop. Do
not pick the more plausible one and proceed.

A conflict resolved silently is a decision nobody made. Where a source of truth
is already defined in the project, follow it and still record that a conflict
existed — the fact that it needed resolving is itself worth knowing.

Prefer the source the project designates as authoritative over the most
recent-looking document. Newer is not more correct, and that assumption is how
requirements get lost.

## Separate regressions from pre-existing problems

A review covers the change in front of it. Problems that predate the change
belong in a separate list, clearly marked, because mixing them makes the
author responsible for code they did not write and trains readers to discount
the report.

## Say nothing when there is nothing

If the change is clean, say so plainly. Manufacturing filler findings to look
thorough trains people to skim the next one.

State what you checked and what you did not. A review that claims coverage it
did not perform is worse than a narrow one that is honest about its edges.

## Do not edit while auditing

An audit that fixes what it finds cannot tell the author what changed, and the
change itself may be the defect. Report first; fix after the author decides
what is real.

When the task is explicitly to fix, then fix — but keep the findings list
visible so each change is traceable to a reported item.
