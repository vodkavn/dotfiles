import { Plugin } from "@opencode/plugin"

// Server half. opencode requires a main entry alongside the TUI entry; this
// plugin only renders, so there is nothing to register on the server side.
export default Plugin.define({
    id: "dotfiles.tokens",
    setup() {},
})
