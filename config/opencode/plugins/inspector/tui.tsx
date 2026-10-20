import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { driftProblems, type Problem } from "./drift"

// Sidebar inspector: shows the agents, slash commands, and skills opencode
// actually loaded at this location, plus any plugin that failed to load at all.
// MCP servers are deliberately omitted; opencode already surfaces those itself.
//
// The agent list is split by Agent.Info.mode, which opencode defines as
// "primary", "subagent", or "all". A primary agent is what the prompt itself
// runs as; a subagent is only reachable by delegating to it. Both kinds are
// returned by the same registry, so the split is worth drawing explicitly.
//
// Entries opencode keeps to itself are dropped. Verified against v2.0.26:
// "hidden: true" agents (compaction, summary, title) are still returned by the
// registry, while "disabled: true" agents are already excluded before it
// reaches us and carry no "disabled" field on Agent.Info at all. Both are
// checked anyway, so the panel stays correct if that filtering ever moves.
//
// Sections expand and collapse on mouse click, the same way opencode's own
// sidebar rows behave. The clickable prop on an OpenTUI element is onMouseDown;
// onClick belongs to opencode's internal components, not to raw <box>/<text>.
//
// Collapse state uses memory storage, so it survives a plugin reload and resets
// when the TUI exits.
//
// Every list is read inside render(), never captured in setup(), so the panel
// repaints when sync() resolves and when opencode reloads its config.

type Section = "agents" | "commands" | "skills" | "drift"

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

const label = (entry: unknown): string => {
    if (!entry || typeof entry !== "object") return String(entry ?? "?")
    const e = entry as Record<string, unknown>
    return String(e.name ?? e.id ?? e.title ?? "?")
}

// Known modes first in the order opencode documents them; anything else the
// registry grows later sorts to the end instead of disappearing.
const MODES = ["primary", "subagent", "all"]

const mode = (entry: unknown): string => {
    if (!entry || typeof entry !== "object") return "primary"
    const e = entry as Record<string, unknown>
    return String(e.mode ?? "primary")
}

const listed = (entry: unknown): boolean => {
    if (!entry || typeof entry !== "object") return true
    const e = entry as Record<string, unknown>
    return e.hidden !== true && e.disabled !== true
}

const rank = (name: string): number => {
    const index = MODES.indexOf(name)
    return index === -1 ? MODES.length : index
}

const group = (entries: readonly unknown[]): [string, unknown[]][] => {
    const buckets = new Map<string, unknown[]>()
    for (const entry of entries) {
        const key = mode(entry)
        const bucket = buckets.get(key)
        if (bucket) bucket.push(entry)
        else buckets.set(key, [entry])
    }
    return [...buckets.entries()].sort((a, b) => rank(a[0]) - rank(b[0]))
}

export default Plugin.define({
    id: "dotfiles.inspector.tui",
    setup(context) {
        // The panel lives in the sidebar for as long as the TUI does, so the
        // location is resolved per render from the session on screen rather
        // than captured once during setup. Capturing it left the panel listing
        // the agents, commands, and skills of whichever project happened to be
        // open at startup, for the rest of the session, after a switch.
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

        const sections: {
            key: Section
            label: string
            read: (at: Location) => readonly unknown[]
            split?: boolean
        }[] = [
            {
                key: "agents",
                label: "Agents",
                // Filtered at the source so the section header counts only the
                // agents actually listed underneath it.
                read: (at) => (context.data.location.agent.list(at) ?? []).filter(listed),
                split: true,
            },
            {
                key: "commands",
                label: "Commands",
                read: (at) => context.data.location.command.list(at) ?? [],
            },
            {
                key: "skills",
                label: "Skills",
                read: (at) => context.data.location.skill.list(at) ?? [],
            },
        ]

        const [state, setState] = context.storage.memory("collapse", {
            initial: { agents: true, commands: true, skills: true, drift: true },
        })

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
            // the answer it computed at startup for as long as the TUI lives,
            // which is exactly the failure this panel exists to report: add a
            // plugin, break a link, and the badge keeps saying all is well.
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

        const toggle = (key: Section) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            setState((draft) => {
                draft[key] = !draft[key]
            })
        }

        return context.ui.slot({
            append: "sidebar.content",
            render: (current) => {
                const at = location(current.sessionID)
                sync(at)
                const directory = (at as { directory?: unknown } | undefined)?.directory
                check(typeof directory === "string" ? directory : undefined)

                // The Config block is only drawn when something is wrong. A panel
                // that always renders a "Config ok" row teaches the eye to skip
                // it, which is the opposite of what it is for. The comment lives
                // here rather than in the JSX below, because opencode's transform
                // can compile a comment inside a JSX expression into a text node
                // and fail the whole region with "Orphan text error".
                return (
                    <box flexDirection="column" gap={1}>
                        {problems.length > 0 && (
                            <box flexDirection="column">
                                <box flexDirection="row" onMouseDown={toggle("drift")} onMouseUp={(e: MouseEvent) => e.stopPropagation()}>
                                    <text fg={context.theme.text.feedback.error.base}>
                                        {`${state.drift ? "▶" : "▼"} Config`}
                                    </text>
                                    <text fg={context.theme.text.muted}>{` (${problems.length})`}</text>
                                </box>
                                {!state.drift &&
                                    problems.map((problem) => (
                                        <box flexDirection="column">
                                            <text
                                                fg={
                                                    problem.severity === "error"
                                                        ? context.theme.text.feedback.error.base
                                                        : context.theme.text.feedback.warning.base
                                                }
                                            >
                                                {`  ${problem.severity === "error" ? "✗" : "⚠"} ${problem.text}`}
                                            </text>
                                        </box>
                                    ))}
                            </box>
                        )}
                        {sections.map((section) => {
                            const entries = section.read(at)
                            const collapsed = state[section.key]
                            return (
                                <box flexDirection="column">
                                    <box
                                        flexDirection="row"
                                        onMouseDown={toggle(section.key)}
                                        onMouseUp={(e: MouseEvent) => e.stopPropagation()}
                                    >
                                        <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>{`${collapsed ? "▶" : "▼"} ${section.label}`}</text>
                                        <text fg={context.theme.text.muted}>{` (${entries.length})`}</text>
                                    </box>
                                    {!collapsed &&
                                        (section.split ? (
                                            group(entries).map(([name, members]) => (
                                                <box flexDirection="column">
                                                    <box flexDirection="row">
                                                        <text fg={context.theme.text.base}>{`• ${name}`}</text>
                                                        <text fg={context.theme.text.muted}>{` (${members.length})`}</text>
                                                    </box>
                                                    {members.map((entry) => <text fg={context.theme.text.muted}>{`  ${label(entry)}`}</text>)}
                                                </box>
                                            ))
                                        ) : (
                                            entries.map((entry) => <text fg={context.theme.text.muted}>{`  ${label(entry)}`}</text>)
                                        ))}
                                </box>
                            )
                        })}
                    </box>
                )
            },
        })
    },
})
