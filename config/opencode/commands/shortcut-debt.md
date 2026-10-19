---
description: List deferred work in this repository as a ledger, and flag the deferrals that have no trigger to revisit them
---

List every deferral marker in the current repository as a ledger, so "later"
does not quietly become "never".

## Scan

Grep the working tree for comment markers, skipping `.git` and everything the
ignore files exclude:

    git grep --no-index --exclude-standard -nE '(#|//|/\*|<!--) ?(shortcut|TODO|FIXME|HACK|XXX):?' -- . ':!*.min.*'

`shortcut:` is the marker the `minimal-change` skill writes, and the form it
uses is:

    shortcut: <the limit>, <when to upgrade>

The other markers are the usual ones. Adjust the pattern to the comment
syntax the files actually use — a shell script comments with `#`, a
TypeScript file with `//` or `/* */`, a Markdown file with `<!-- -->`.

If the user names their own marker word, grep for that word instead.

Each hit is one ledger row. Skip the ones that are not deferrals: a note
about a keyboard shortcut, a `TODO` in prose rather than a comment, a `TODO`
inside a block of copied third-party code.

## Read the ledger

The marker is only half the row. Open each hit and answer three questions:

- **What was simplified** — one line.
- **Ceiling** — the limit it names, or "unstated" when the comment does not
  say.
- **Trigger** — the condition that should make someone revisit it, or
  "unstated" when the comment does not say.

A ceiling without a trigger is the rot risk: nobody will ever come back to
it, because nothing marks the moment it has to be revisited. Tag those rows
`no-trigger`, and keep them at the top of the report.

## Output

One row per marker, grouped by file:

    <file>:<line>, <what was simplified>. ceiling: <ceiling>. upgrade: <trigger>.

End with the count and the number without a trigger:

    <N> markers, <M> with no trigger.

Nothing found: `No deferral debt. Clean ledger.`

## Boundaries

This reads and reports; it changes nothing. It is a report the user asked
for, so give it in full rather than a sample. If the user wants it kept,
write it to a file they name — a ledger in the repository is a document, and
`tech-doc` applies to it.
