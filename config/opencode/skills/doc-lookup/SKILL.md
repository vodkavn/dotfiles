---
name: doc-lookup
description: Locate the document that answers a question, confirm it is the current one, and answer from it with citations. Use when the answer lives in a document -- a spec, a README, an ADR, a runbook, a wiki page -- or when a repository has a docs index.
---

In a repository with hundreds of documents, the wrong one is cheap to find
and expensive to quote. A changelog entry from three releases ago describes
the system as it was, confidently and in the present tense, and nothing in
the file says so. The cost is not the wrong answer; it is the confident
wrong answer, which the reader has to disprove before they can use the
right one.

## Start at the index

A repository with hundreds of documents usually has a map: `docs/README.md`,
an index, or a section in `AGENTS.md` that says which document answers
what. Read it first. It replaces a search with a lookup, and it is the only
place that knows which of three versions of a document is the live one.

Where the repository has no index, search as below and say in the answer
that it has no map -- the user may want one built.
`reference/index-template.md` is a starting point for that.

## Search, but exclude the history

Changelogs, release notes, migration guides, and anything under an archive
directory describe the past. They are the most likely place to find a
confident, present-tense, wrong statement.

    git grep --no-index --exclude-standard -n -i "<term>" -- . \
        ':!CHANGELOG*' ':!HISTORY*' ':!docs/archive/*' ':!*.min.*'

Adjust the exclusions to what the repository actually has. An archive
directory is a signal to exclude; a `docs/decisions/` directory is not, and
excluding it would throw away exactly the records a question about *why it
is like this* needs.

## Confirm the document is current

Before quoting, check that the document says so. A `Status:` line, a
`Superseded by:` pointer, or a header naming the version answers it. Where
the document points at its replacement, read that instead.

When the document has no status, the index is the authority. Where there is
no index either, prefer the document the project designates over the most
recent-looking one. Newer is not more correct, and that assumption is how a
requirement gets lost.

When two current documents disagree, report both, with their locations, and
stop. `deliverable-trace` owns that rule in full, and its evidence line is
the one to use.

## Read the section, not the file

A document that answers the question in one section is still a document with
twelve. Find the heading first, then read that range:

    git grep -n "^#" -- <file>

The read tool takes `offset` and `limit` in lines and reports `next` when
there is more. A whole 40 KB specification read in one call fills the
context the question needed and leaves nothing for the answer.

## Answer with the citation

Every claim carries `path:line`. Quote the smallest span that supports it --
the paragraph, not the chapter. A citation is what lets the reader check
the answer in seconds instead of re-reading the document.

Where the documents do not answer the question, say so. "The documentation
does not cover this" is a finding; an answer assembled from a changelog and
general knowledge is a guess with a citation attached.

## When reads are being cut short

A project that works from documents reads more long files than a project
that works from code, and a `tool_output` cap truncates a long document
before the model has seen all of it. The truncated result says so and saves
the full output to a file.

Raise the cap **in that project only**, so the rest of the machine keeps the
tighter one:

    {
        "tool_output": { "max_lines": 2000, "max_bytes": 32768 }
    }

32 KB is about eight thousand tokens: a whole document in one read, and
still room inside a fifteen-thousand-token context for the answer.

## Non-goals

This is a lookup method, not a writing one. `tech-doc` owns how a document
is written and `deliverable-trace` owns how a claim is proved. Use them
alongside this; do not restate their rules here.
