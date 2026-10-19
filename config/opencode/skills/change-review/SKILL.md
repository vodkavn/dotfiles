---
name: change-review
description: Review a code change for correctness, risk, scale, missing tests, and needless code. Reads the code the change touches, not only the diff, and ranks the findings. Use for "review this", "review my change", "is this over-engineered", "what can I cut", or before opening a pull request.
---

A review is worth the time it takes only if it finds something. The value is
in ranking: a reader has to know what to fix before they can decide anything
else.

## Understand first

- Review what the user names: uncommitted changes, staged changes, a branch, a
  pull request, or files. Nothing named: the uncommitted changes, or the last
  commit if there are none.
- Read the diff, then the code it touches. The callers of every changed
  function, the functions it calls, the tests, and the documentation that
  states the old behaviour. A change breaks code it does not touch whenever a
  signature, a return value, or a behaviour moves — so grep every caller.
- Trace the real flow: where the data comes in, what is stored, what goes out.
- Find the expected load. One person running a script and many users hitting
  an endpoint are different systems, and "fine for one" is a real bug in the
  second. Judge scale against the load the project actually has, and say
  which load you assumed.

## What to look for

1. **Correctness.** A wrong result, a crash, a missed edge case — empty
   input, zero, the last item, rounding, time zones. A fix applied in one
   caller while the shared function stays broken. The same rule implemented
   differently in two places.
2. **Risk.** Injection, weak randomness, a secret in the code, a missing check
   on input from a user. Data loss: errors swallowed, writes in the wrong
   order, no transaction around them.
3. **Scale.** A check-then-write race. The same work repeated by every
   process. A list that only grows. A query per item. Work that is fine for
   one user and wrong for many.
4. **Missing test.** Risky new logic — a branch, a parser, money, security, a
   data write, a bug fix — with no test that fails when it breaks. One good
   test, not coverage.
5. **Speed.** A real slowdown is a finding. A small win in a hot path is a
   suggestion, and the review says which it is.
6. **Needless code.** See the ladder below.

## The needless-code ladder

For every block the change adds, ask in order:

- **Delete.** Dead code, an unused option, a flag nobody sets, a speculative
  feature.
- **Reuse.** The repository already has this helper. Name the path.
- **Standard library or platform.** It already does this. A new dependency for
  a few lines is not worth the install.
- **One implementation.** An interface with one implementation, a factory with
  one product, a wrapper that only passes calls through.
- **Merge.** Near-copies that have to change together.
- **Split.** One function doing several unrelated jobs, so it is hard to read
  or to test. Split by job, never by line count, and never into helpers that
  exist only to make a function shorter.

## Before a finding is reported

- Every finding needs a concrete case: "this input or situation leads to this
  wrong result". No case, no finding.
- Re-read the lines and confirm. The caller exists, the value really can be
  empty, the code really is unused.
- A `shortcut:` comment that names its limit is a decision, not a finding —
  unless the expected load already crosses the limit it names.
- Propose the smallest fix that works, and prefer a fix that deletes code.
- No style taste, no "consider", no vague worry.

## How a finding is written

Every finding carries four parts, each one or two short sentences:

1. **What this is** — the code, in one line.
2. **Problem** — the concrete case that goes wrong.
3. **Fix** — the smallest change that works.
4. **If we skip it** — the consequence, so the reader can weigh it.

Back the finding with evidence: the file and line, and the command that
demonstrates it. `deliverable-trace` carries the discipline for a claim that
needs proving, and the same rule applies here — a finding nobody can verify
is a guess with a confident tone.

## The report

Open with what the change does, in two or three sentences, and the load you
assumed. Then the findings in three groups, skipping empty ones:

- **Must fix** — a bug, a security hole, data loss, or a break at the
  expected load.
- **Should fix** — risky code with no test, real slowness, duplication, a
  function that mixes jobs, code that should not exist.
- **Nice to have** — small speed-ups, shorter forms.

Number the findings across all groups, so the reader can say "fix 2 and 5". A
change with nothing to report says so plainly, with a line on what was
checked, instead of inventing filler.

A review changes no code.
