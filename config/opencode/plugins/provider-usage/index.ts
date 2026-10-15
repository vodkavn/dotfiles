import { Plugin } from "@opencode/plugin"

// Server half. opencode discovers a plugin directory from flat sibling entries,
// and a directory holding only tui.tsx is skipped without a message (see
// tests/plugin-layout.test.mjs). This file makes the directory discoverable and
// carries the plugin id into the storage namespace; the panel itself is a read
// of stores the terminal already holds plus its own HTTP calls, so there is
// nothing to register on the server side.
export default Plugin.define({
    id: "dotfiles.provider-usage",
    setup() {},
})
