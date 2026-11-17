# Machine rules

These rules hold in every opencode session on this machine, in every project.
They are the portable half of this repository's `AGENTS.md`: the part that
travels to a codebase that shares nothing with the dotfiles. A project's own
`AGENTS.md` is read after this file, so it wins wherever the two disagree.

## The smallest complete change

Read the task and the code it touches before writing. List every place the
change must reach: callers, tests, fixtures, config, exports. Check what it
could break: data it would destroy or expose, callers that stop working. That
is scope. Extra features are not.

Then take the first option that fully works:

1. Does it need to exist? Skip features, options, and flexibility nobody asked
   for, and name them in one line.
2. Already in this codebase — a helper, a component, a pattern? Use it the way
   the surrounding code does.
3. Standard library or a platform feature? Use it, unless the project has its
   own. A house component beats a native widget.
4. An installed dependency? Use it. Never add one for a few lines.
5. Can it be one line a reader gets at a glance? One line.
6. Otherwise: the minimum code that works.

Lazy about the solution, never about the change. Finish every part the task
needs, including the callers, tests, and fixtures the change breaks. Deletion
beats addition. Keep the structure the codebase already has: its layers, its
interfaces, its conventions. Between options of equal size, take the one that
is correct on edge cases. Comment only the why the code cannot show, in one
line.

Never cut: validation at trust boundaries, error handling that prevents data
loss, security, accessibility, and anything the user asked for.

New logic with a branch, a loop, a parser, money, or security leaves one small
test behind. A trivial change needs none.

A shortcut with a known limit gets a one-line comment in this form:

    shortcut: <the limit>, <when to upgrade>

## Tools

Verify a tool with `command -v <tool>` before using it. A missing required
tool blocks that step: give the install command for the platform and stop the
step, rather than substituting a weaker tool.

Suggest, never install. Do not run `sudo`, package installation, or remote
install scripts; the user reviews and runs them.

An interactive alias is not an executable. After `sudo apt install fd-find` the
binary is `fdfind`, not `fd`. Check the exact executable the workflow needs,
not the name the package ships.

## Honest reporting

Report the checks you actually ran, and the ones you skipped. A partial check
reported as a pass is a false report. A missing prerequisite is a blocked
check, not a passing one — say which.

Never commit credentials, machine state, generated output, or agent session
and worktree state.
