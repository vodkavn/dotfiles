---
name: Test Scenario
description: Write test scenarios, test cases, UAT scripts, or a QA catalogue from requirements or designs. Use when the task touches a test scenario, a test plan, UAT, or coverage.
---

A test scenario earns its place by failing for a reason someone cares about.
Producing more scenarios is not the goal; producing scenarios that distinguish
a working build from a broken one is.

## Format

Follow the convention already in the repository. Where none exists, Given /
When / Then:

- **Given** the starting state and any prerequisite data
- **When** exactly one action or event
- **Then** the observable result, stated so it can fail unambiguously

One scenario covers one behaviour. A scenario with five _When_ clauses is five
scenarios, and when one of them fails you cannot tell which.

Name scenarios so a defect report can reference them without opening the file.
Include the requirement ID in the name or a dedicated column.

## Coverage that gets missed

Happy paths are the smallest part of the job. Work through these deliberately
rather than waiting to be asked:

| Dimension               | Cases                                                             |
| ----------------------- | ----------------------------------------------------------------- |
| Boundaries              | empty, one, maximum, maximum+1, zero, negative                    |
| Malformed               | wrong type, missing field, oversized, unexpected encoding         |
| State                   | every valid state transition, plus illegal transitions            |
| Concurrency             | simultaneous edits, duplicate submit, interrupted operation       |
| Identity                | unauthenticated, wrong role, expired session, revoked access      |
| Lifecycle               | create, read, update, delete, archive, restore                    |
| Failure of dependencies | timeout, partial outage, downstream rejects                       |
| Data                    | migration correctness, retention, what happens to deleted records |

For every permission-gated action, test the role that _must not_ perform it.
The positive case proves little; the negative case is where authorisation bugs
live.

## Non-functional

Functional scenarios pass while the system is unusable. Give NFRs their own
scenarios with measured thresholds: response time at p95 and p99, not average;
concurrent users; soak duration; recovery time objective and recovery point
objective; behaviour under partial degradation.

State the measurement method. "Loads fast" is not a scenario; "p95 under
200 ms at 500 concurrent users, measured at the API gateway over 15 minutes"
is.

## Traceability

Every scenario traces to a requirement or design decision, and every
requirement has at least one scenario. Report the gaps in both directions —
uncovered requirements and scenarios with no requirement behind them. Both are
findings; the second is a sign the scenario encodes a bug rather than a rule.

## Verification

Before delivering, confirm each _Then_ is objectively checkable. "The system
responds appropriately" cannot fail, so it passes forever and catches nothing.
Every assertion names what is observed, where, and against what threshold.

For anything you ran, record the command and its output. A reported result
without evidence is an assumption.
