---
name: Release Rollback
description: Decide and plan a rollback safely, in two modes. Preflight before a release proves it can be reverted and names what cannot; execute during an incident produces an ordered plan. Use when the user says "rollback", "revert the release", "can we roll back", or is about to ship.
---

A rollback is the rarest and most expensive step in a release lifecycle. It
happens when people are stressed, information is thin, and it is 2am. The
point of this skill is to move that thinking **out of the incident** and into
release time.

> **`git revert` is the easy part, and it is almost never the part that
> breaks.** What breaks is the schema the old code cannot read, the jobs already
> queued with a new payload shape, the frontend already on a new contract, and
> the notification already sent. Those are what this skill enumerates.

## Non-goals

- **Never execute a production rollback.** Produce the plan and the exact
  commands; a human runs them.
- Do not decide _whether_ to roll back — that is a business call. Supply the
  evidence and the recommendation.
- Never write the rollback record to an external system without explicit
  consent. Posting is human-gated.

## Mode A — `preflight` (before release)

Run this **before** shipping, not during the incident.

### 1. Scan the diff for rollback-blocking signals

Report every hit:

| Signal                                                                                           | Why it matters                                                                                                                        |
| ------------------------------------------------------------------------------------------------ | ------------------------------------------------------------------------------------------------------------------------------------- |
| **Non-additive migration** (drop/rename a column, narrow a type, add NOT NULL without a default) | Reverting the app is **not enough**, and may not be possible at all.                                                                  |
| **Contract or API change** consumed by another deployable                                        | Services deploy separately → reverting one alone breaks the other. **Revert order matters.**                                          |
| **Job payload / queue shape change**                                                             | Jobs already enqueued carry the _new_ shape; the _old_ worker cannot read them → **poison queue.** The most-missed item on this list. |
| **New enum value / status written to storage**                                                   | Old code hits an unknown variant on read.                                                                                             |
| **Outward side effect** (email, payment API, webhook, third-party call)                          | **Already left the building. Not revertible** — only compensable.                                                                     |
| **New required env var / secret / config key**                                                   | The old deployment definition does not have it.                                                                                       |

No hits → say so plainly: "no rollback-blocking signals; a plain app revert is
sufficient."

### 2. Produce

1. **Revertible: yes / yes-with-order / no.**
2. **What cannot be reverted** — listed explicitly. This is the most valuable
   line in the document and the one people discover too late.
3. **Revert order**, if order matters.
4. **Compensating action** for each non-revertible item — who does it, and
   what it says.

## Mode B — `execute` (during an incident)

### 1. Classify

- **Pre-release** (bad change on staging, not yet in production) → revert the
  merge request. Low stakes. Stop here.
- **Post-rollout** (already in production) → continue.

### 2. Order

```
traffic → app (all services together) → worker → drain queue → schema (LAST, usually NEVER)
```

- **Traffic first** — shift back to the previous target. Fastest, safest, and
  often sufficient alone.
- **All services together** if a contract changed. A partial revert is a new
  outage.
- **Worker**: pause the queue _before_ reverting, so no new-shape job is picked
  up by an old worker.
- **Drain or quarantine in-flight jobs** carrying the new shape — move them
  aside; do not let an old worker consume them.
- **Schema last, and preferably not at all.** If the migrations were additive,
  the old app runs fine against the new schema — **leave it alone.** Reverting a
  migration is how a rollback becomes a data-loss incident.

### 3. Produce

- The ordered plan with **exact commands**.
- **What is NOT being rolled back**, and why.
- **Compensating actions** for side effects already emitted.
- **Verification**: how you will know the rollback worked.

### 4. Hand over

The human executes. You do not run it.

## Evidence

Record what happened, because a rollback is a change to a live system and needs
the same trace as a release:

```md
## Rollback record

- **Release**: <tag / MR>
- **Trigger**: <what broke — symptom, detection, time>
- **Decision**: rollback / fix-forward — **by <human>** at <time>
- **Rolled back**: <what>
- **NOT rolled back**: <what, and why>
- **Compensating actions**: <who does what, by when>
- **Verification**: <how recovery was confirmed>
```

## Related

If the incident is not yet understood, diagnose **first**. Rolling back a
symptom you have not diagnosed destroys the evidence you need.
