// The loadout report, as data.
//
// Kept out of tui.tsx for the reason drift.ts is: node can load a plain module
// and call its exports, but JSX needs opencode's transform.
// plugin-layout.test.mjs enforces the split.
//
// The report is the plugin's only surface: it is opened deliberately and
// every section is drawn expanded. What this module decides is what the report
// says; tui.tsx decides where it sits.

import type { Problem } from "./drift"

// The name the panel is opened under. It is the panel's identity, so it has to
// be the same string in the slot claim, in the open call, and in the check that
// decides whether this plugin's panel is the one on screen.
export const PANEL_NAME = "dotfiles.loadout"

// The footer button: a glyph and a word.
//
// The glyph is the one cell that changes, not the word. A broken plugin link is
// a problem with the toolchain rather than with the loadout being drawn, and
// swapping the word would make the button unfindable by the name it is known
// by -- "where did the loadout button go" is a worse failure than a stale gear.
export const WORD = "loadout"
export const GLYPH = "⚙"
export const ALERT_GLYPH = "⚠"

// A gear at rest, a warning while the drift scan finds something wrong.
//
// `problems` is the count the scan returned, so a warning and a warn-severity
// finding are the same condition: anything the scan thought worth reporting is
// worth a different glyph.
export const glyphFor = (problems: number): string => (problems > 0 ? ALERT_GLYPH : GLYPH)

// The keys the report is opened and closed from.
//
// ctrl+alt+<letter> is the range the host uses for navigation and never for text
// input, so the open binding cannot swallow a character the user meant to type;
// checked against the v2.2.3 keybind reference, and free there.
//
// Escape is *not* free: it is `session.interrupt`, and the diff viewer's close
// key. The close binding is therefore only live while this plugin's panel is
// open -- see tui.tsx -- so Escape goes on meaning "interrupt the turn"
// whenever the report is not on screen.
export const BINDINGS = {
    open: "ctrl+alt+i",
    close: "escape",
} as const

// The command ids. Namespaced to this plugin, and separate from the host's: an
// id the host owns is the host's to register.
export const COMMANDS = {
    open: "dotfiles.loadout.open",
    close: "dotfiles.loadout.close",
} as const

// What the commands are called in the palette. Only the open one is listed
// there; close has a key and a button and needs no third route.
export const COMMAND_TITLES = {
    open: "Open loadout",
    close: "Close loadout",
} as const

export type Tone = "base" | "muted" | "error" | "warn"

export type Segment = { readonly text: string; readonly tone: Tone }

// One line of the report.
//
// depth is what the renderer indents by: 0 for a section header, 1 for a group
// inside one, 2 for an entry. Keeping the indent out of the text is what lets
// the renderer own the layout and this module own the content.
export type Line = {
    readonly depth: 0 | 1 | 2
    readonly heading: boolean
    readonly segments: readonly Segment[]
}

// One list the report draws, with the header that introduces it.
export type Section = {
    readonly label: string
    readonly count: number
    readonly lines: readonly Line[]
}

// What one location's registries answered, plus the drift scan.
export type Readings = {
    readonly agents: readonly unknown[]
    readonly commands: readonly unknown[]
    readonly skills: readonly unknown[]
    readonly problems: readonly Problem[]
}

const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

// The name a registry entry is drawn under. The fields differ by registry --
// agents and commands carry `name`, a skill carries `id` and `name` -- so this
// reads whichever is there rather than assuming one.
export const label = (entry: unknown): string => {
    if (entry === null || typeof entry !== "object") return String(entry ?? "?")
    const e = record(entry)
    return String(e.name ?? e.id ?? e.title ?? "?")
}

// The one-sentence description a registry entry may carry.
export const describe = (entry: unknown): string => text(record(entry).description)

// Known modes first in the order opencode documents them; anything else the
// registry grows later sorts to the end instead of disappearing.
const MODES = ["primary", "subagent", "all"]

export const mode = (entry: unknown): string => {
    const named = text(record(entry).mode)
    return named === "" ? "primary" : named
}

// Entries opencode keeps to itself are dropped. Verified against v2.0.26:
// "hidden: true" agents (compaction, summary, title) are still returned by the
// registry, while "disabled: true" agents are already excluded before it
// reaches us and carry no "disabled" field on Agent.Info at all. Both are
// checked anyway, so the report stays correct if that filtering ever moves.
export const listed = (entry: unknown): boolean => {
    const e = record(entry)
    return e.hidden !== true && e.disabled !== true
}

const rank = (name: string): number => {
    const index = MODES.indexOf(name)
    return index === -1 ? MODES.length : index
}

// Group agents by mode, in the order opencode documents them.
export const group = (entries: readonly unknown[]): [string, unknown[]][] => {
    const buckets = new Map<string, unknown[]>()
    for (const entry of entries) {
        const key = mode(entry)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(entry)
        else buckets.set(key, [entry])
    }
    return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

// One entry as a line, with its description when the host gave one.
//
// The name and the description are separate segments so the name keeps the body
// colour and the description recedes: a list where both read the same has to be
// read word by word.
const row = (depth: 1 | 2, entry: unknown): Line => {
    const note = describe(entry)
    const segments: Segment[] = [{ text: label(entry), tone: "base" }]
    if (note !== "") segments.push({ text: `  ${note}`, tone: "muted" })
    return { depth, heading: false, segments }
}

// A section header. The count is optional because the Plugins section counts
// problems, not entries, and "(0)" there would read as "no plugins".
const header = (title: string, count?: number): Line => ({
    depth: 0,
    heading: true,
    segments:
        count === undefined
            ? [{ text: title, tone: "base" }]
            : [
                  { text: title, tone: "base" },
                  { text: ` (${count})`, tone: "muted" },
              ],
})

const subheader = (title: string, count: number): Line => ({
    depth: 1,
    heading: false,
    segments: [
        { text: title, tone: "base" },
        { text: ` (${count})`, tone: "muted" },
    ],
})

// The agents, split by mode, as the body of one section.
const agentLines = (agents: readonly unknown[]): Line[] => {
    const lines: Line[] = []
    for (const [name, members] of group(agents)) {
        lines.push(subheader(name, members.length))
        for (const entry of members) lines.push(row(2, entry))
    }
    return lines
}

// The commands and skills, which have no mode to split on.
const entryLines = (entries: readonly unknown[]): Line[] => entries.map((entry) => row(1, entry))

// The sections the report draws, with the count each header shows.
//
// The count is the number of entries drawn underneath, not the number of lines:
// an agent section's lines also carry one subheader per mode.
export const buildSections = (readings: Readings): Section[] => {
    const agents = readings.agents.filter(listed)
    const commands = readings.commands.filter(listed)
    const skills = readings.skills.filter(listed)
    return [
        { label: "Agents", count: agents.length, lines: agentLines(agents) },
        { label: "Commands", count: commands.length, lines: entryLines(commands) },
        { label: "Skills", count: skills.length, lines: entryLines(skills) },
    ]
}

// The whole report, in the order the sidebar draws it: what opencode loaded,
// then what it got wrong.
//
// Every section is drawn even when it is empty, because the report is opened
// deliberately and "(0)" is the answer to "did my skill load?". That is the
// opposite of the sidebar's Config block, which appears only when something is
// wrong: there, a permanent "no problems" row teaches the eye to skip it.
export const buildReport = (readings: Readings): Line[] => {
    const sections = buildSections(readings)
    const lines: Line[] = []
    for (const section of sections) {
        lines.push(header(section.label, section.count))
        for (const line of section.lines) lines.push(line)
    }

    lines.push(header("Plugins"))
    if (readings.problems.length === 0) {
        lines.push({ depth: 1, heading: false, segments: [{ text: "no problems", tone: "muted" }] })
    }
    for (const problem of readings.problems) {
        lines.push({
            depth: 1,
            heading: false,
            segments: [
                { text: `${problem.severity === "error" ? "✗" : "⚠"} ${problem.text}`, tone: problem.severity === "error" ? "error" : "warn" },
            ],
        })
    }
    return lines
}
