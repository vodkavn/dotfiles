import { Plugin } from "@opencode/plugin/tui"

// Sidebar inspector: shows the agents, slash commands, and skills opencode
// actually loaded at this location. MCP servers are deliberately omitted;
// opencode already surfaces those itself.
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

type Section = "agents" | "commands" | "skills"

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
        const location = context.location ?? context.data.location.default()

        void Promise.all([
            context.data.location.agent.sync(location),
            context.data.location.command.sync(location),
            context.data.location.skill.sync(location),
        ])

        const sections: {
            key: Section
            label: string
            read: () => readonly unknown[]
            split?: boolean
        }[] = [
            {
                key: "agents",
                label: "Agents",
                // Filtered at the source so the section header counts only the
                // agents actually listed underneath it.
                read: () => (context.data.location.agent.list(location) ?? []).filter(listed),
                split: true,
            },
            {
                key: "commands",
                label: "Commands",
                read: () => context.data.location.command.list(location) ?? [],
            },
            {
                key: "skills",
                label: "Skills",
                read: () => context.data.location.skill.list(location) ?? [],
            },
        ]

        const [state, setState] = context.storage.memory("collapse", {
            initial: { agents: true, commands: true, skills: true },
        })

        const toggle = (key: Section) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            setState((draft) => {
                draft[key] = !draft[key]
            })
        }

        return context.ui.slot({
            append: "sidebar.content",
            render: () => (
                <box flexDirection="column" gap={1}>
                    {sections.map((section) => {
                        const entries = section.read()
                        const collapsed = state[section.key]
                        return (
                            <box flexDirection="column">
                                <box
                                    flexDirection="row"
                                    onMouseDown={toggle(section.key)}
                                    onMouseUp={(e: MouseEvent) => e.stopPropagation()}
                                >
                                    <text>{`${collapsed ? "▶" : "▼"} ${section.label}`}</text>
                                    <text fg={context.theme.text.muted}>{` (${entries.length})`}</text>
                                </box>
                                {!collapsed &&
                                    (section.split ? (
                                        group(entries).map(([name, members]) => (
                                            <box key={name} flexDirection="column">
                                                <box flexDirection="row">
                                                    <text>{`  ${name}`}</text>
                                                    <text fg={context.theme.text.muted}>{` (${members.length})`}</text>
                                                </box>
                                                {members.map((entry) => <text>{`    • ${label(entry)}`}</text>)}
                                            </box>
                                        ))
                                    ) : (
                                        entries.map((entry) => <text>{`  • ${label(entry)}`}</text>)
                                    ))}
                            </box>
                        )
                    })}
                </box>
            ),
        })
    },
})
