// Server half of source-control, which draws nothing without it.
//
// opencode discovers a plugin directory from flat sibling filenames, and a
// directory holding only tui.tsx is not loaded at all -- it never appears in
// /api/plugin or in the load log, so the section it contained simply never
// existed. This file exists so that it does, and plugin-layout.test.mjs keeps it
// here.
//
// It registers nothing on purpose. Everything the panel needs is a local read:
// discovery is a `stat` on `.git`, status is `git status`, and the actions are
// `git` invocations the TUI makes itself. None of that wants a server-side hook,
// and inventing one to have something to put here would be a behaviour change
// disguised as a fix.
//
// What it deliberately does not add: model-facing tools. A tool would be a
// second, differently-shaped entry point to the same git commands, and the
// panel already shows the model and the user the same thing. If the model needs
// status in a turn, the shell it already has runs `git status`.

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
    id: "dotfiles.source-control",
    setup() {},
})
