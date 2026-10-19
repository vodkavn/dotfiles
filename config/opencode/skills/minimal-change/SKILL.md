---
name: minimal-change
description: Find the smallest change that fully solves the task, reusing what the codebase already has. Use when writing, fixing, refactoring, or extending code, when choosing between an implementation and a dependency, or when a change is growing past what the task asked for.
---

The best code is the code never written — but only when what is written is
complete. A smaller diff that skips a caller, a test, or an error path is not
a smaller diff, it is a bug with extra steps. Laziness belongs to the
solution, never to the change.

## Before you write

Read the code the change touches, not just the request. Then list every place
the change must reach:

- callers of anything whose signature, return value, or behaviour changes
- tests, fixtures, and snapshots that assert the old behaviour
- config, exports, and generated artifacts derived from the code
- documentation that states the old behaviour

Check what the change could break for the people using it: data it would
destroy or expose, callers that would stop working, a public interface that
moves. That list is the scope. Features nobody asked for are not.

## The ladder

Stop at the first rung that fully works:

1. **Does it need to exist?** A vague request gets the smallest version that
   does the core job. Options, flags, and flexibility nobody asked for are
   skipped, and named in one line so the user can ask for them.
2. **Already in this codebase?** A helper, a component, a service, a pattern
   the surrounding code already uses. Reuse it the way the neighbours use it.
3. **Standard library or a platform feature?** Use it, unless the project
   has its own. A house component beats a native widget.
4. **An installed dependency?** Use it. Never add a dependency for a few
   lines.
5. **One line a reader gets at a glance?** One line. A one-liner that needs
   decoding is not short.
6. **Otherwise:** the minimum code that works.

## What that forbids

- Abstractions, wrappers, type conversions, options, config, and boilerplate
  that nobody asked for. An interface with one implementation, a factory with
  one product, a pass-through wrapper.
- Values reshaped into a form the platform does not already give you.
- "For later" code. Later is a separate task with its own review.
- Structure the codebase does not have. Keep its layers, its interfaces, its
  conventions. A change that reorganises around itself is a second change.
- Comments that restate the code. Comment the why the code cannot show, in
  one line.

## What is never cut

- Validation at a trust boundary — anything crossing from outside the program
  in, or from one trust zone to another.
- Error handling that prevents data loss: writes ordered, failures surfaced,
  partial states recoverable.
- Security: authentication, authorisation, secrets, injection, input checks.
- Accessibility.
- Calibration that real hardware needs.
- Anything the user asked for.

## The check that comes with the code

New logic with a branch, a loop, a parser, a formula, money, or security
leaves one small test behind — one test that fails for the reason that
matters, not coverage. A trivial change needs none.

Before editing a function, grep every caller of it. Fix the root cause once,
in the shared code, rather than patching one caller and leaving the shared
function broken. Code that is moved or merged keeps its error handling and
validation.

## Marking a deliberate shortcut

Sometimes the right answer is a shortcut with a known limit. Mark it so it
does not quietly become permanent:

    shortcut: <the limit>, <when to upgrade>

A reader who sees that comment knows the decision was deliberate, knows what
breaks, and knows what would retire it. A limit with no trigger is not a
shortcut, it is a deferral with no expiry — the trigger is the part that
matters. `shortcut-debt` collects these into a ledger.
