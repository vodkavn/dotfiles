import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run panel.ts with no opencode at all; nothing here contacts a service.
//
// tui.tsx is absent by construction: JSX needs opencode's transform, so the
// decisions the plugin makes -- which registry entries are worth showing,
// how the agents are grouped, what each section counts, and what the full
// report says -- live in panel.ts and are exercised here. See
// plugin-layout.test.mjs for the rule that keeps them there.

const load = async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            // Static imports, single- or multi-line. ./drift is a type-only
            // import, so stripping the line changes nothing at runtime.
            .replace(/^import[\s\S]*?from\s+["'][^"']*["'];?[^\S\n]*$/gm, "")
            .replace(/^import\s+["'][^"']*["'];?[^\S\n]*$/gm, "")
            .replace(/^export /gm, "") +
        `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({})
    vm.runInContext(code, scope)
    return scope.exports
}

const {
    ALERT_GLYPH,
    BINDINGS,
    buildReport,
    buildSections,
    describe,
    GLYPH,
    glyphFor,
    group,
    label,
    listed,
    mode,
} = await load("../config/opencode/plugins/loadout/panel.ts")

// Values built inside the vm carry that realm's prototypes, which
// assert.deepStrictEqual rejects even when the contents match.
const plain = (value) => JSON.parse(JSON.stringify(value))

const readings = (overrides = {}) => ({
    agents: [],
    commands: [],
    skills: [],
    problems: [],
    ...overrides,
})

// The report as one string per line, with the indent its depth asks for and
// the tone of each segment kept, so an assertion can talk about what is drawn
// rather than about the shape that carries it.
const lines = (value) =>
    value.map((line) => ({
        depth: line.depth,
        heading: line.heading,
        text: `${"  ".repeat(line.depth)}${line.segments.map((segment) => segment.text).join("")}`,
        tones: line.segments.map((segment) => segment.tone),
    }))

test("A registry entry is named by whichever field it carries", () => {
    assert.equal(label({ name: "build" }), "build")
    assert.equal(label({ id: "minimal-change", name: "Minimal Change" }), "Minimal Change")
    assert.equal(label({ title: "Title only" }), "Title only")
    assert.equal(label({}), "?")
    assert.equal(label(null), "?")
})

test("An entry's description is read only when it is a string", () => {
    assert.equal(describe({ description: "does a thing" }), "does a thing")
    assert.equal(describe({ description: 42 }), "")
    assert.equal(describe({}), "")
    assert.equal(describe(undefined), "")
})

test("Hidden and disabled entries are dropped", () => {
    assert.equal(listed({ hidden: true }), false)
    assert.equal(listed({ disabled: true }), false)
    assert.equal(listed({ hidden: false }), true)
    assert.equal(listed({ name: "build" }), true)
    assert.equal(listed(undefined), true)
})

test("An agent with no mode is treated as primary", () => {
    assert.equal(mode({ name: "build" }), "primary")
    assert.equal(mode({ mode: "subagent" }), "subagent")
    assert.equal(mode({ mode: 7 }), "primary")
})

test("Agents group by mode in the documented order, unknown modes last", () => {
    const grouped = plain(
        group([
            { name: "custom", mode: "experimental" },
            { name: "all", mode: "all" },
            { name: "general", mode: "subagent" },
            { name: "build" },
        ]),
    )
    assert.deepEqual(grouped.map(([name]) => name), ["primary", "subagent", "all", "experimental"])
    assert.equal(grouped[0][1].length, 1)
})

test("A section counts entries, not lines", () => {
    const [agents] = plain(
        buildSections(
            readings({
                agents: [
                    { name: "build", description: "the primary agent" },
                    { name: "general", mode: "subagent" },
                    { name: "compaction", hidden: true },
                ],
            }),
        ),
    )
    assert.equal(agents.count, 2, "the hidden agent is not counted")
    // Two modes, so two subheaders, plus one line per agent.
    assert.equal(agents.lines.length, 4)
    assert.deepEqual(plain(agents.lines.map((line) => line.depth)), [1, 2, 1, 2])
    assert.deepEqual(plain(agents.lines.map((line) => line.segments[0].text)), [
        "primary",
        "build",
        "subagent",
        "general",
    ])
})

test("Commands and skills are flat lists", () => {
    const [, commands, skills] = plain(
        buildSections(
            readings({
                commands: [{ name: "review-changes", description: "review the diff" }],
                skills: [{ id: "minimal-change", name: "Minimal Change" }],
            }),
        ),
    )
    assert.equal(commands.count, 1)
    assert.equal(commands.lines[0].depth, 1)
    assert.deepEqual(commands.lines[0].segments.map((segment) => segment.text), [
        "review-changes",
        "  review the diff",
    ])
    assert.deepEqual(commands.lines[0].segments.map((segment) => segment.tone), ["base", "muted"])
    assert.equal(skills.count, 1)
    assert.deepEqual(skills.lines[0].segments.map((segment) => segment.text), ["Minimal Change"])
})

test("The report draws every section even when empty", () => {
    const report = lines(plain(buildReport(readings())))
    const headings = report.filter((line) => line.heading).map((line) => line.text)
    // Plugins carries no count: it counts problems, and "(0)" would read as
    // "no plugins".
    assert.deepEqual(headings, ["Agents (0)", "Commands (0)", "Skills (0)", "Plugins"])
    // The report is opened on purpose, so "no problems" is an answer rather
    // than the noise the sidebar refuses to draw.
    const config = report[report.length - 1]
    assert.equal(config.text, "  no problems")
    assert.deepEqual(config.tones, ["muted"])
})

test("Drift problems are drawn with the severity they report", () => {
    const report = lines(
        plain(
            buildReport(
                readings({
                    problems: [
                        { text: "tokens: link target is gone", severity: "error" },
                        { text: "odd: no index.ts, so it is skipped silently", severity: "warn" },
                    ],
                }),
            ),
        ),
    )
    assert.match(report[report.length - 2].text, /^  ✗ tokens: link target is gone$/)
    assert.deepEqual(report[report.length - 2].tones, ["error"])
    assert.match(report[report.length - 1].text, /^  ⚠ odd:/)
    assert.deepEqual(report[report.length - 1].tones, ["warn"])
})

test("Every section line reaches the report, in order", () => {
    const sample = readings({
        agents: [{ name: "build" }, { name: "general", mode: "subagent" }],
        commands: [{ name: "review-changes" }],
        skills: [{ id: "minimal-change", name: "Minimal Change" }],
    })
    const sections = plain(buildSections(sample))
    const report = plain(buildReport(sample))
    // Every section line appears in the report, in the same order.
    const sectionLines = sections.flatMap((section) => section.lines.map((line) => JSON.stringify(line)))
    const reportLines = report.map((line) => JSON.stringify(line))
    for (const line of sectionLines) assert.ok(reportLines.includes(line), `missing from the report: ${line}`)
})

test("The plugin draws in the prompt footer and the panel, not the sidebar", async () => {
    // The sidebar is for what changes while you work -- running subagents, a
    // draining quota -- and a list of loaded agents does not. Pinned here
    // because it is a decision about where the plugin draws, and a later edit
    // could quietly put the section back.
    const source = await readFile(new URL("../config/opencode/plugins/loadout/tui.tsx", import.meta.url), "utf8")
    assert.doesNotMatch(source, /sidebar\.content/, "the plugin has no sidebar section")
    assert.match(source, /after: "prompt\.footer\.status"/, "the button belongs in the prompt footer, beside the other shortcuts")
    assert.match(source, /append: "session\.panel"/, "the report fills the session panel")
})

test("The report body scrolls in the panel instead of being clipped", async () => {
    // The report grows with the project, so a long list used to lose its tail
    // off the bottom with no way to reach it. The title and the close row stay
    // outside the scrollbox so they do not scroll away.
    const source = await readFile(new URL("../config/opencode/plugins/loadout/tui.tsx", import.meta.url), "utf8")
    assert.match(source, /<scrollbox[^>]*flexGrow=\{1\}/, "the report body must be a scrollbox that fills the panel")
})

// --- the footer button -------------------------------------------------------

test("The footer glyph is a list at rest and a warning when drift is found", () => {
    // The word stays put: it is how the button is found. Only the glyph carries
    // the state, and any finding at all is worth carrying it -- the scan does
    // not distinguish a broken link from a directory opencode would skip when
    // it decides a problem is worth reporting.
    assert.equal(glyphFor(0), GLYPH)
    assert.equal(glyphFor(1), ALERT_GLYPH)
    assert.equal(glyphFor(9), ALERT_GLYPH)
    assert.notEqual(GLYPH, ALERT_GLYPH)
})

test("The open and close keys are different, and close is Escape", () => {
    assert.equal(BINDINGS.close, "escape")
    assert.notEqual(BINDINGS.open, BINDINGS.close)
})

test("Escape is scoped to the open panel, because the host owns it otherwise", async () => {
    // `escape` is session.interrupt and the diff viewer's close key. A layer
    // that bound it unconditionally would take the interrupt away from every
    // turn, so the close layer is gated on this plugin's panel being the one on
    // screen. Pinned because the failure is silent: the key would simply stop
    // interrupting.
    const source = await readFile(new URL("../config/opencode/plugins/loadout/tui.tsx", import.meta.url), "utf8")
    assert.match(
        source,
        /enabled: \(\) => context\.ui\.panel\.current\(\)\?\.name === PANEL_NAME/,
        "the close layer must be gated on this plugin's panel",
    )
    assert.match(source, /bind: BINDINGS\.close/, "the gated layer is what binds Escape")
})
