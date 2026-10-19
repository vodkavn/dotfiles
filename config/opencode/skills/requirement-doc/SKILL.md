---
name: requirement-doc
description: Write and revise requirements, user stories, functional specs, and acceptance criteria. Use when the task touches a requirement document, a story, or a customer-facing specification.
---

Requirements fail in predictable ways. The checks below catch the ones that
actually reach a customer.

## Before writing

Find the nearest existing sibling and match it. A document in the wrong
house style is rejected on review even when the content is right.

Separate what is **given** from what is **assumed**. Anything not traceable to
a source document is an assumption; mark it as one rather than writing it as
fact. A confident unsourced requirement is worse than a flagged gap, because
nobody knows to go looking for it.

## Acceptance criteria

One behaviour per criterion. Use EARS forms where the surrounding document
already does:

| Form         | Wording                                     |
| ------------ | ------------------------------------------- |
| Ubiquitous   | The system _shall_ …                        |
| Event-driven | _When_ <trigger>, the system _shall_ …      |
| State-driven | _While_ <state>, the system _shall_ …       |
| Unwanted     | _If_ <condition>, then the system _shall_ … |

State the observable result, not the implementation. "The system shall respond
within 200 ms for p95 queries over 10k rows" is testable. "The system shall
use a cache" is a design decision wearing a requirement's clothes.

Cover the boundaries, not just the happy path: empty, single, maximum,
malformed, concurrent, and permission-denied. A criterion nobody can think of
a failing input for is usually not a criterion yet.

## Structure

Keep numbering stable and never renumber an existing requirement — other
documents and test scenarios cite these IDs. If a requirement is withdrawn,
mark it withdrawn rather than deleting it.

Cover the non-functional side explicitly: performance, availability, security,
audit, retention, and recovery. These are the requirements most often assumed
and least often written, and they are the ones that surface during UAT.

State dependencies and assumptions in their own section. A design document
that quietly depends on an unwritten assumption is a schedule risk.

## Tables and formatting

Match the existing table shape exactly. Do not reformat a table you were not
asked to change.

**Never run a formatter over a requirement document.** Prettier and similar
tools normalise Markdown tables unconditionally — there is no flag to disable
it, and `--prose-wrap preserve` does not apply to tables. On a table using
non-breaking spaces for column alignment they convert the NBSPs to ordinary
spaces and reflow every column, which silently destroys the layout and makes a
customer-facing document look corrupted.

If a document needs table formatting applied deliberately, do it by hand and
confirm the diff.

## Before handing it over

Verify each criterion is testable and each claim traceable to a source. State
open questions explicitly instead of resolving them by assumption — an
unresolved question in the document is a question the customer can answer, and
an unresolved assumption in the document is a defect nobody sees coming.
