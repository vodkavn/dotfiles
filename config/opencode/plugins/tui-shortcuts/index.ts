// Server half of tui-shortcuts, which draws nothing without it.
//
// opencode discovers a plugin directory from flat sibling filenames, and a
// directory holding only tui.tsx is not loaded at all -- it never appears in
// /api/plugin or in the load log, so the shortcuts it contained simply never
// exist. This file exists so that it does, and plugin-layout.test.mjs keeps it
// here.
//
// It registers nothing on purpose. The shortcuts draw fixed captions and dispatch
// opencode's own dialogs, so there is no server-side hook for them to own, and
// inventing one to have something to put here would be a behaviour change
// disguised as a fix.

import { Plugin } from "@opencode/plugin"

export default Plugin.define({
    id: "dotfiles.tui-shortcuts",
    setup() {},
})
