# Template: a documentation index

Copy this to `docs/README.md` in a repository that has many documents, and
replace the placeholder rows.

The index is read before the agent searches, so it has to be short enough to
read whole and precise enough to answer *where is this documented* without a
search. One screen is the target; an index that has to be paged is a search
again, with extra authority.

## How to use this file

- One row per **question**, not per document. A question is what someone
  asks; a document is what answers it. Several questions can share a row.
- The `Document` column names the file that is currently true. When a
  document is replaced, the row points at the replacement, and the old file
  says so in its own `Status:` line.
- `Status` is `current`, `draft`, or `superseded`. Give every row one: a
  row with no status is a row the reader cannot trust.
- Keep it under a screen.

## The convention the documents follow

Every document in this repository opens with:

    Status: current | draft | superseded by <file>
    Owner: <team or person>

A superseded document keeps its history and is not deleted. It points at
what replaced it, so a search that finds it still leads somewhere useful.

## Topics

| Question | Document | Status |
| --- | --- | --- |
| How do I install and run this locally? | `docs/getting-started.md` | current |
| What does the service promise its callers? | `docs/api.md` | current |
| Why is the cache write-behind? | `docs/decisions/0007-cache-write-behind.md` | current |
| How do I rotate a credential? | `docs/runbooks/credential-rotation.md` | current |

## Archived

Documents kept for the record and not to be read as current.

| Document | Replaced by |
| --- | --- |
| `docs/legacy-setup.md` | `docs/getting-started.md` |

## Changing this file

A document is added, replaced, or retired, and this file changes in the
same commit. An index that lags the documents is worse than no index at
all, because the reader trusts it.
