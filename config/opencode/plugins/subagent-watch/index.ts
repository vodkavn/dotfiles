// Server half of subagent-watch, which draws nothing without it.
//
// opencode discovers a plugin directory from flat sibling filenames, and a
// directory holding only tui.tsx was not loaded at all -- it never appeared in
// /api/plugin or in the load log, so the section it contained simply never
// existed. This file exists so that it does.
//
// It registers nothing on purpose. The subagent list is entirely a read of
// stores the terminal already holds, and inventing a server-side hook to have
// something to put here would be a behaviour change disguised as a fix.

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
    id: "dotfiles.subagent-watch",
    setup() {},
})