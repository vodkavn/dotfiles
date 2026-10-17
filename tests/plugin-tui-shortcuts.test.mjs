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

const { AGENT_GLYPH, AGENT_LABEL, COMMANDS, labelTone, MODEL_GLYPH, MODEL_LABEL } = await load(
    "../config/opencode/plugins/tui-shortcuts/panel.ts",
)

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

test("A label is muted at rest and lit under the pointer", () => {
    // The pair opencode's own secondary action uses: muted at rest so the footer
    // reads as chrome, the body colour on hover so the label lights up.
    assert.equal(labelTone(false), "muted")
    assert.equal(labelTone(true), "base")
})
