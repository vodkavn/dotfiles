// Structural rules for the plugin tree, checked by reading the files rather
// than by running them.
//
// Both rules here exist because something in this repo already broke them.
//
// 1. opencode bundles a plugin's sibling files into one scope, so a name
//    declared at the top level of two files in the same directory is a
//    duplicate declaration and takes the whole entry down. inspector lost its
//    panel this way when tui.tsx and drift.ts both declared driftProblems, and
//    todo shipped the same landmine twice (record and GLYPH) before this
//    existed. Neither failure announces itself: /api/plugin still reports the
//    plugin active.
//
// 2. A directory needs a recognised entrypoint. A plugin holding only tui.tsx
//    was not discovered at all -- absent from /api/plugin and from the logs --
//    so its panel simply never appeared.

import assert from "node:assert/strict"
import { readdir, readFile } from "node:fs/promises"
import { fileURLToPath } from "node:url"
import { join } from "node:path"
import test from "node:test"

const PLUGINS = fileURLToPath(new URL("../config/opencode/plugins/", import.meta.url))

// Top-level declarations only, at column 0. An indented one belongs to a
// function body and cannot collide with anything.
const declarations = (source) => {
    const found = []
    const pattern = /^(?:export\s+)?(?:declare\s+)?(?:const|let|var|function|class|type|enum|interface)\s+([A-Za-z_$][\w$]*)/gm
    for (const match of source.matchAll(pattern)) found.push(match[1])
    return found
}

const directories = async () => {
    const entries = await readdir(PLUGINS, { withFileTypes: true })
    return entries.filter((entry) => entry.isDirectory()).map((entry) => entry.name).sort()
}

test("Every plugin directory has a server entrypoint", async () => {
    const missing = []
    for (const name of await directories()) {
        const files = await readdir(join(PLUGINS, name))
        // index.ts, not tui.tsx. A directory holding only tui.tsx was not
        // discovered at all: absent from /api/plugin, absent from the load log,
        // panel simply never present. A plugin that draws still needs the server
        // entry, and it is what carries the plugin id into the storage namespace.
        if (!files.includes("index.ts")) missing.push(name)
    }
    assert.deepEqual(missing, [], `plugin directories opencode would skip: ${missing.join(", ")}`)
})

test("No plugin directory declares the same top-level name twice", async () => {
    const clashes = []
    for (const name of await directories()) {
        const files = (await readdir(join(PLUGINS, name))).filter((file) => file.endsWith(".ts") || file.endsWith(".tsx"))
        const seen = new Map()
        for (const file of files) {
            for (const declared of declarations(await readFile(join(PLUGINS, name, file), "utf8"))) {
                if (seen.has(declared)) {
                    clashes.push(`${name}: ${declared} in both ${seen.get(declared)} and ${file}`)
                } else {
                    seen.set(declared, file)
                }
            }
        }
    }
    assert.deepEqual(clashes, [], `bundled siblings share a name:\n  ${clashes.join("\n  ")}`)
})

test("A panel keeps its decisions out of the JSX", async () => {
    // The rule that made the todo panel testable: anything a .tsx computes that
    // decides whether or what to draw belongs in a sibling .ts, because node
    // cannot execute JSX. This is a nudge, not a proof -- but the failure it
    // guards against is a panel that registers and paints nothing.
    const findings = []
    for (const name of await directories()) {
        const files = await readdir(join(PLUGINS, name))
        if (!files.includes("tui.tsx")) continue
        const panel = files.find((file) => file === "panel.ts")
        if (!panel) continue
        const source = await readFile(join(PLUGINS, name, "tui.tsx"), "utf8")
        // A render body that computes rather than just laying out.
        if (/\.sort\(|\.filter\(|\.reduce\(|JSON\.parse/.test(source)) {
            findings.push(`${name}/tui.tsx still does data work that ${panel} should own`)
        }
    }
    assert.deepEqual(findings, [], findings.join("\n"))
})