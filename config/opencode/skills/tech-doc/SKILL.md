---
name: tech-doc
description: Draft and revise Markdown/MDX technical documentation, READMEs, runbooks, and how-to guides. Use when the task writes or edits a document that someone will follow.
---

A document is judged by whether somebody can act on it without the author in
the room. The rules below decide that more often than any other factor.

## Write for the reader who did not write the code

Assume no context, no memory of the previous conversation, and no permission
to ask a question. Name the file, the flag, and the directory rather than
"the relevant config". Expand every acronym the repository's own authors
already take for granted.

## Match the document that is already there

Match the voice, heading depth, and frontmatter of the document being edited.
A new document follows the closest existing sibling rather than an idealised
house style invented for it — a document in the wrong style gets rewritten
whatever the content is worth.

Where the repository holds no document to match, there is no house style to
follow, and inventing one is worse than a plain structure: a title, one line
saying what it is for, then the task, then the steps, then the failure modes.

## What belongs here, and what does not

This skill covers the documents a reader follows: a README, a runbook, a
how-to guide, a reference page, an API note.

An **architecture decision record** is not one of them. A decision record
answers *why this was chosen over what*, and `design-review` is the skill
for that. Two rule sets for one artifact produce two different documents, so
the boundary is drawn here rather than left to the moment.

## Verify before you write

Every command, flag, file path, and environment variable in a document must be
checked against the repository or run first. A plausible-looking command that
does not exist is the worst possible output here: the reader pays the full
cost of the mistake, and pays it silently.

Prefer the installed version over the remembered one. Defaults, flag names,
and output formats change between releases, and a command checked against
last year's toolchain is a guess with a citation.

## One working example beats a list of options

Show one command that works, with its real output. Listing many options
pushes the decision back onto the reader, which is the work the document
exists to save them.

Document the failure modes and the exit path, not just the happy path. What
the command prints when it fails, what it returns, and what to do next are
the parts a reader meets first.

## Keep prose tight

Cut throat-clearing, restating the heading, and hedging. Every sentence
should carry something the previous one did not.

## Before handing it over

Re-read the document as somebody who has never seen the repository. Every
command in it should be one the reader can paste. Every claim about
behaviour should be one you checked.
