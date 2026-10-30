import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { createSignal } from "solid-js"
import { driftProblems, type Problem } from "./drift"
import {
    BINDINGS,
    COMMANDS,
    COMMAND_TITLES,
    glyphFor,
    PANEL_NAME,
    WORD,
    buildReport,
    type Line,
    type Readings,
    type Tone,
} from "./panel"

// Loadout: what opencode actually loaded at this location -- agents, slash
// commands, and skills -- plus any plugin that failed to load at all. MCP
// servers are deliberately omitted; opencode already surfaces those itself.
//
// One surface, not two. The report is opened from a button in the prompt footer
// or from a keybind, and fills the session panel. It does not also sit in the
// sidebar: the sidebar is for what changes while you work -- running subagents,
// a draining quota -- and this does not change until a plugin or a command is
// added. A permanent section there spent the most expensive space in the TUI on
// a list that is read once.
//
// The drift scan moved with it. It used to be the sidebar's Config block, drawn
// only when something was wrong, so a broken plugin link announced itself
// without being asked for. It is now drawn in the report, which means it is
// found by opening the loadout rather than by glancing at the sidebar -- the
// cost of removing the section, and the reason the report always draws it.
//
// The agent list is split by Agent.Info.mode, which opencode defines as
// "primary", "subagent", or "all". A primary agent is what the prompt itself
// runs as; a subagent is only reachable by delegating to it. Both kinds are
// returned by the same registry, so the split is worth drawing explicitly.
//
// Every list is read inside render(), never captured in setup(), so the report
// repaints when sync() resolves and when opencode reloads its config.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

// The footer button. An action and a glyph, the same shape the footer shortcuts
// beside it use, so the row reads as one set of controls rather than as three
// unrelated ones. "loadout" is shorter than naming what it opens and says the
// right thing: the kit this project has loaded.
//
// Two spaces after the glyph, not one. The gear and the warning sign are both
// East Asian *ambiguous* width characters that many terminals draw as a wide
// emoji, so they advance two cells and a single space that follows is swallowed
// into the glyph.
const GAP = "  "

export default Plugin.define({
    id: "dotfiles.loadout.tui",
    setup(context) {
        // Resolved per render from the session on screen rather than captured
        // once during setup. Capturing it left the report listing the agents,
        // commands, and skills of whichever project happened to be open at
        // startup, for the rest of the session, after a switch.
        //
        // context.location is deliberately not in this chain. It is a plain
        // property of the setup context, so it is the value captured at setup
        // -- the very thing this replaces -- and keeping it as a fallback
        // would reintroduce the staleness whenever the session store has not
        // caught up. data.location.default() is the live default instead.
        const location = (sessionID: string | undefined) => {
            const session = sessionID === undefined ? undefined : context.data.session.get(sessionID)
            return session?.location ?? context.data.location.default()
        }

        // The location the registries are keyed by. Taken from the context
        // rather than written out, so it cannot drift from what the host
        // expects to be handed.
        type Location = Parameters<typeof context.data.location.agent.sync>[0]

        // sync() is one-shot per store, so it is issued when the resolved
        // location changes rather than on every repaint. Rejections are
        // swallowed: the client can be pointed at a remote server, and an
        // unhandled rejection here would take the whole TUI down over a list
        // that is allowed to be empty until the store syncs. A failed attempt is
        // retried on the next render rather than being lost for the session.
        //
        // Recently synced locations, not just the last one. A single-slot cache
        // thrashes the moment the user alternates between two projects: every
        // render misses and re-issues all three syncs, so switching tabs becomes
        // a network call per frame. Bounded so it cannot grow with the number of
        // projects a long-lived server ever sees.
        const SYNC_HISTORY = 8
        const synced = new Set<string>()
        const syncing = new Set<string>()
        const sync = (at: Location) => {
            const key = JSON.stringify(at ?? null)
            if (synced.has(key) || syncing.has(key)) return
            syncing.add(key)
            void Promise.all([
                context.data.location.agent.sync(at),
                context.data.location.command.sync(at),
                context.data.location.skill.sync(at),
            ]).then(
                () => {
                    synced.add(key)
                    if (synced.size > SYNC_HISTORY) {
                        const oldest = synced.values().next()
                        if (!oldest.done) synced.delete(oldest.value)
                    }
                },
                () => {},
            ).finally(() => { syncing.delete(key) })
        }

        // Walking the filesystem on every repaint would be wasteful, and the
        // answer only changes when a plugin is added or removed. Cached per
        // project directory and re-read when that changes, which is the
        // same trigger the registry sync above uses.
        //
        // Several directories, not just the last, for the same reason the sync
        // history is: a single-slot cache re-walks the filesystem on every
        // render the moment two projects alternate. Bounded for the same
        // reason too. Re-inserting on a hit keeps the oldest key evictable,
        // because Map iterates in insertion order.
        const DRIFT_HISTORY = 8
        const DRIFT_MAX_AGE = 30_000
        const scanned = new Map<string, { problems: Problem[]; at: number }>()
        let problems: Problem[] = []
        const check = (directory: string | undefined) => {
            const key = directory ?? ""
            const hit = scanned.get(key)
            // Age-bounded as well as size-bounded. A pure size cache would serve
            // the answer it computed when the report was first opened for as
            // long as the TUI lives, which is exactly the failure this report
            // exists to catch: add a plugin, break a link, and the report keeps
            // saying all is well.
            if (hit !== undefined && Date.now() - hit.at < DRIFT_MAX_AGE) {
                scanned.delete(key)
                scanned.set(key, hit)
                problems = hit.problems
                return
            }
            const found = driftProblems(directory)
            scanned.set(key, { problems: found, at: Date.now() })
            if (scanned.size > DRIFT_HISTORY) {
                const oldest = scanned.keys().next()
                if (!oldest.done) scanned.delete(oldest.value)
            }
            problems = found
        }

        // Everything the report draws, read in one place. The registries are
        // raw: panel.ts owns which of their entries are worth showing, so a
        // project's hidden internal agents are dropped once rather than in
        // every call site.
        const readings = (at: Location): Readings => ({
            agents: context.data.location.agent.list(at) ?? [],
            commands: context.data.location.command.list(at) ?? [],
            skills: context.data.location.skill.list(at) ?? [],
            problems,
        })

        // The directory the drift scan covers, resolved from the same location
        // the registries are keyed by.
        const directoryOf = (at: Location): string | undefined => {
            const directory = (at as { directory?: unknown } | undefined)?.directory
            return typeof directory === "string" ? directory : undefined
        }

        const ink = (tone: Tone) => {
            if (tone === "muted") return context.theme.text.muted
            if (tone === "error") return context.theme.text.feedback.error.base
            if (tone === "warn") return context.theme.text.feedback.warning.base
            return context.theme.text.base
        }

        // One line as it is drawn: the indent its depth asks for, then each
        // segment in its own colour. A heading carries the bold attribute rather
        // than a colour, so it stays distinct from the tone a problem uses.
        //
        // Composed here rather than in the JSX below, for the reason the other
        // panels give: the render lays out, panel.ts decides.
        const drawn = (line: Line) => ({
            indent: "  ".repeat(line.depth),
            segments: line.segments.map((segment) => ({ text: segment.text, ink: ink(segment.tone) })),
            bold: line.heading,
        })

        const open = () => {
            context.ui.panel.open(PANEL_NAME, { presentation: "fullscreen" })
        }

        // The press only stops propagation; the action is on the release, so a
        // press-and-drag-away cancels. The host binds the footer itself, which
        // is why every handler stops propagation.
        const hold = (event: MouseEvent) => event.stopPropagation()
        const openOnRelease = (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            open()
        }

        // The footer button. `after`, not `append`, and one box holding one
        // text: the host's child inside prompt.footer.status is a box with
        // flexGrow: 1, so an appended button lands inside that boundary and
        // collapses to zero width for the whole of a turn. Both findings come
        // from tui-shortcuts, which draws in the same region.
        //
        // Muted at rest and lit under the pointer, the pair opencode's own
        // secondary action uses, so the footer reads as chrome until it is
        // aimed at.
        //
        // The drift scan runs here, not only in the report, because the warning
        // glyph is the whole point of it: a problem that is only visible once
        // you open the report is not a warning. It is cached per directory for
        // 30 seconds, so the footer's frequent repaints do not walk the
        // filesystem each time.
        const [hovered, setHovered] = createSignal(false)
        const button = context.ui.slot({
            after: "prompt.footer.status",
            render: (input) => {
                const at = location(input.sessionID)
                check(directoryOf(at))
                // The glyph is the one cell that says something is wrong, so it
                // carries the warning colour rather than the button's own; the
                // word keeps the hover pair. A clickable row stays one box
                // holding one text, and the glyph is a span inside it, the same
                // shape the subagent spinner uses.
                const glyph =
                    problems.length > 0 ? (
                        <span style={{ fg: context.theme.text.feedback.warning.base }}>{glyphFor(problems.length)}</span>
                    ) : (
                        glyphFor(problems.length)
                    )
                return (
                    <box
                        flexDirection="row"
                        flexShrink={0}
                        onMouseOver={() => setHovered(true)}
                        onMouseOut={() => setHovered(false)}
                        onMouseDown={hold}
                        onMouseUp={openOnRelease}
                    >
                        <text wrapMode="none" fg={hovered() ? context.theme.text.base : context.theme.text.muted}>
                            {glyph}
                            {`${GAP}${WORD}`}
                        </text>
                    </box>
                )
            },
        })

        // The report itself. It claims the session panel and renders nothing
        // unless that panel was opened under this plugin's name, so a panel
        // another plugin opened is left alone.
        const report = context.ui.slot({
            append: "session.panel",
            render: (input) => {
                if (input.name !== PANEL_NAME) return null
                const at = location(input.sessionID)
                sync(at)
                check(directoryOf(at))
                const lines = buildReport(readings(at))
                const directory = directoryOf(at)

                const close = (event: MouseEvent) => {
                    event.stopPropagation()
                    event.preventDefault()
                    input.close()
                }

                return (
                    <box flexDirection="column" gap={0}>
                        <box flexDirection="row">
                            <text wrapMode="none" fg={context.theme.text.base} attributes={TextAttributes.BOLD}>Loadout</text>
                            {directory !== undefined && (
                                <text wrapMode="none" fg={context.theme.text.muted}>{`  ${directory}`}</text>
                            )}
                        </box>
                        <box flexDirection="row" onMouseDown={hold} onMouseUp={close}>
                            <text wrapMode="none" fg={context.theme.text.muted}>✕ close</text>
                        </box>
                        {lines.map((line) => {
                            const view = drawn(line)
                            return (
                                <text wrapMode="none" attributes={view.bold ? TextAttributes.BOLD : undefined}>
                                    {view.indent}
                                    {view.segments.map((segment) => (
                                        <span style={{ fg: segment.ink }}>{segment.text}</span>
                                    ))}
                                </text>
                            )
                        })}
                    </box>
                )
            },
        })

        // The same action from the keyboard, and findable by name in the
        // palette. A layer is global rather than scoped to the base mode: the
        // report is worth opening while the prompt has focus, which is where a
        // session spends most of its time.
        context.keymap.layer(() => ({
            mode: "global",
            commands: [
                {
                    id: COMMANDS.open,
                    title: COMMAND_TITLES.open,
                    group: "Loadout",
                    bind: BINDINGS.open,
                    palette: true,
                    run: open,
                },
            ],
        }))

        // Escape closes the report, and only while the report is the open panel.
        //
        // Escape belongs to the host: it is `session.interrupt`, and the diff
        // viewer's close key. A layer that claimed it unconditionally would take
        // the interrupt away from every turn. Gating the whole layer on
        // `ui.panel.current()` means the binding does not exist until the panel
        // does, so outside the report the key is the host's again.
        context.keymap.layer(() => ({
            mode: "global",
            enabled: () => context.ui.panel.current()?.name === PANEL_NAME,
            commands: [
                {
                    id: COMMANDS.close,
                    title: COMMAND_TITLES.close,
                    group: "Loadout",
                    bind: BINDINGS.close,
                    run: () => {
                        context.ui.panel.close()
                    },
                },
            ],
        }))

        return () => {
            button?.()
            report?.()
        }
    },
})
