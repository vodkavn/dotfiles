// What the clickable shortcuts in the terminal say.
//
// Kept out of tui.tsx for the same reason inspector's drift.ts and
// subagent-watch's panel.ts are kept out of theirs: node can load a plain module
// and call its exports, but JSX needs opencode's transform.
// plugin-layout.test.mjs enforces the split.
//
// Nothing here reaches for opencode. Every value is a constant or arrives as an
// argument, so a test can pin it without a terminal or a running service.

// The dialogs the shortcuts open, by the command id opencode registers for each.
//
// Both are the commands the leader keys dispatch (<leader>a and <leader>m).
// Going through the keymap rather than re-implementing a picker is what keeps
// search, favourites, variants, and category grouping working, and what stops
// the shortcuts drifting from those dialogs the first time the host changes.
export const COMMANDS = {
    agent: "agent.list",
    model: "model.list",
} as const

// One glyph each, so the two shortcuts are told apart at a glance in a footer
// that also carries opencode's own indicators.
export const AGENT_GLYPH = "◆"
export const MODEL_GLYPH = "◇"

// What each shortcut is called: its glyph and the action it performs.
//
// The action, not the selected agent or model, because the host already draws
// both of those itself and a plugin cannot make host-rendered text clickable --
// it can only fill the regions it is given. Repeating a value the host owns buys
// exactly one thing: a copy that can go stale. The agent is the proof -- the
// plugin context offers ui.model and no ui.agent, verified against v2.0.32, and
// the host announces a switch only when it applies one.
export const AGENT_LABEL = `${AGENT_GLYPH} switch agent`
export const MODEL_LABEL = `${MODEL_GLYPH} switch model`

// Whether the agent shortcut is worth drawing: there has to be somewhere to
// switch to, so the project needs more than one primary agent.
//
// `mode: "all"` counts, because such an agent can be the prompt's agent; a
// `subagent` cannot. Hidden and disabled entries are dropped, the same defensive
// pair inspector applies, because the host keeps its internal agents (compaction,
// summary, title) in this registry and they never reach the dialog.
//
// An undefined list means the location's store has not synced yet. That is not
// "one agent": the shortcut stays, so a slow or failed sync cannot take away a
// working action.
export const showsAgentSwitch = (entries: readonly unknown[] | undefined): boolean => {
    if (entries === undefined) return true
    let primary = 0
    for (const entry of entries) {
        if (!entry || typeof entry !== "object") continue
        const agent = entry as Record<string, unknown>
        if (agent.mode === "subagent" || agent.hidden === true || agent.disabled === true) continue
        primary += 1
    }
    return primary > 1
}

// What a shortcut wears: muted at rest, so the footer still reads as chrome
// rather than as a second prompt, and the body colour under the pointer, so the
// label lights up as a target.
//
// The same pair, for the same reason, as opencode's own secondary action token
// -- base "$text.muted", "$hovered" "$text.base" -- verified against v2.0.32.
// Only the tone is decided here; tui.tsx maps the name to a theme value.
export type Tone = "muted" | "base"

export const labelTone = (hovered: boolean): Tone => (hovered ? "base" : "muted")
