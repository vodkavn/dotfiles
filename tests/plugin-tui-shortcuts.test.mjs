import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run panel.ts with no opencode at all; nothing here contacts a service.
//
// tui.tsx is absent by construction: JSX needs opencode's transform, so the
// decisions the shortcuts make -- what each one says, which dialog it opens, and
// how it is toned -- live in panel.ts and are exercised here. See
// plugin-layout.test.mjs for the rule that keeps them there.

const load = async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            .replace(/^import .*$/gm, "")
            .replace(/export default /g, "globalThis.plugin = ")
            .replace(/^export /gm, "") +
        `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({})
    vm.runInContext(code, scope)
    return scope.exports
}

const {
    AGENT_GLYPH,
    AGENT_LABEL,
    BINDINGS,
    COMMAND_IDS,
    COMMAND_TITLES,
    COMMANDS,
    labelTone,
    MODEL_GLYPH,
    MODEL_LABEL,
    showsAgentSwitch,
} = await load("../config/opencode/plugins/tui-shortcuts/panel.ts")

test("Each shortcut names its glyph and the action it performs", () => {
    // The action, not the selected value: the host draws the agent and the model
    // itself, and the plugin context can read the model but not the agent
    // (ui.model exists, ui.agent does not, v2.0.32), so a value repeated here
    // would be a copy that goes stale.
    assert.equal(AGENT_LABEL, `${AGENT_GLYPH} switch agent`)
    assert.equal(MODEL_LABEL, `${MODEL_GLYPH} switch model`)
    // One glyph each, and not the same one twice: the shortcuts sit side by side
    // in a footer that also carries the host's own indicators.
    assert.notEqual(AGENT_GLYPH, MODEL_GLYPH)
    // Two different captions: identical ones would make the shortcuts
    // indistinguishable from each other.
    assert.notEqual(AGENT_LABEL, MODEL_LABEL)
})

test("Each shortcut opens the dialog its leader key opens", () => {
    // <leader>a and <leader>m, the registered build-ins. Dispatch reaches the
    // same dialog, so search, favourites, and grouping stay the host's.
    assert.equal(COMMANDS.agent, "agent.list")
    assert.equal(COMMANDS.model, "model.list")
})

test("The agent shortcut disappears when there is no agent to switch to", () => {
    // The dialog is pointless with one destination, so the shortcut is drawn
    // only when the project's agent registry offers more than one primary.
    const agent = (overrides) => ({ id: "a", name: "a", mode: "primary", hidden: false, ...overrides })

    // An unsynced store is unknown, not one: keep the action rather than hide it
    // because the server was slow.
    assert.equal(showsAgentSwitch(undefined), true)

    assert.equal(showsAgentSwitch([]), false)
    assert.equal(showsAgentSwitch([agent()]), false)
    assert.equal(showsAgentSwitch([agent(), agent({ id: "b", name: "b" })]), true)

    // A subagent cannot be the prompt's agent, so it is not a choice, while
    // "all" can be and counts.
    assert.equal(showsAgentSwitch([agent(), agent({ mode: "subagent" })]), false)
    assert.equal(showsAgentSwitch([agent(), agent({ mode: "all" })]), true)

    // The host keeps internal agents in the registry; the dialog does not list
    // them, so neither does the count.
    assert.equal(showsAgentSwitch([agent(), agent({ hidden: true })]), false)
    assert.equal(showsAgentSwitch([agent(), agent({ disabled: true })]), false)
})

test("A label is muted at rest and lit under the pointer", () => {
    // The pair opencode's own secondary action uses: muted at rest so the footer
    // reads as chrome, the body colour on hover so the label lights up.
    assert.equal(labelTone(false), "muted")
    assert.equal(labelTone(true), "base")
})

test("The plugin's commands are its own, and dispatch the host's", () => {
    // An id the host owns is the host's to register. These are separate so the
    // plugin can add a binding and a palette entry without claiming one.
    for (const key of ["agent", "model"]) {
        assert.notEqual(COMMAND_IDS[key], COMMANDS[key], `${key} must not reuse the host id`)
        assert.match(COMMAND_IDS[key], /^dotfiles\./, `${key} must be namespaced to this plugin`)
        assert.notEqual(COMMAND_TITLES[key], "", `${key} needs a name in the palette`)
    }
    assert.notEqual(COMMAND_IDS.agent, COMMAND_IDS.model)
    assert.notEqual(COMMAND_TITLES.agent, COMMAND_TITLES.model)
})

test("The two commands are bound to different keys, in the host's meta range", () => {
    assert.notEqual(BINDINGS.agent, BINDINGS.model, "one key for two actions would shadow one")
    for (const bind of [BINDINGS.agent, BINDINGS.model]) {
        // ctrl+alt+<letter> is the range the host uses for navigation and
        // scrolling, never for text input, so a binding here cannot swallow a
        // character the user meant to type.
        assert.match(bind, /^ctrl\+alt\+[a-z]$/, `${bind} is outside the range`)
        // Plain letters would be typed; a bare modifier combination would not
        // be a binding at all.
        assert.ok(!/\+[0-9]$/.test(bind), `${bind}: digit bindings are reserved for session switching`)
    }
})
