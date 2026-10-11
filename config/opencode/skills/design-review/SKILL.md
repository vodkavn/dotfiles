---
name: Design Review
description: Review or write a technical design, architecture decision, or solution document. Use when the task touches a design doc, an ADR, a technical proposal, or an architecture choice.
---

A design document exists to make a decision reviewable. A document that only
describes what was built has already missed its purpose.

## The decision comes first

Open with the decision in one sentence, then the context that forced it. A
reviewer who has to infer the decision from the body will usually infer it
differently from you.

State the **alternatives you rejected** and why. This is the highest-value
section and the one most often skipped. Without it, the next engineer re-litigates
the same choice with none of your context, or picks something worse by accident.

Name the constraints that actually bind — latency floor, regulatory limit,
existing contract, team skill, deadline. When a constraint is a preference,
say so; a preference treated as a hard constraint produces bad architecture.

## Trade-offs

Every design buys something and costs something. Write both down. A proposal
with only benefits is not a proposal, it is an advertisement, and reviewers
reasonably discount it.

Prefer the reversible over the irreversible, and say which choice you are. "If
this turns out wrong we can migrate in a week" is a real architectural
argument; "this is future-proof" is not.

## Consequences

Cover the operational life of the decision, not just the build:

- **Failure.** What happens when this dependency, service, or assumption breaks?
  Blast radius and detection.
- **Migration and rollback.** How you would back it out, and whether that is
  possible at all. State it plainly when it is not.
- **Cost.** Ongoing cost in the unit people actually budget: queries, storage,
  licences, on-call.
- **What it forecloses.** The next idea this makes expensive or impossible.

## Verification

Every factual claim carries a one-line check: the command and its output, or
the file and line. A claim about an API, a version, a limit, or existing
behaviour that was not checked is a guess wearing a citation, and it is the
single most common defect in a design review.

Prefer reading the actual implementation over inferring from a name. Version
numbers and configuration defaults change; verify against what is installed.

## Scope

A design document describes the design. Implementation belongs in the code and
its own review. Keep diagrams to the ones a reader needs; a diagram nobody
reads is maintenance debt with a picture.

Match the conventions of the repository you are in. Number sections, name
files, and set the frontmatter the way the surrounding documents do.
