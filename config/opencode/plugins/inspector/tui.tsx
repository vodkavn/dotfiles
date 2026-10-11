import { Plugin } from "@opencode/plugin/tui"

// Sidebar inspector: shows the agents, slash commands, and skills opencode
// actually loaded at this location. MCP servers are deliberately omitted;
// opencode already surfaces those itself.
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

export default Plugin.define({
    id: "dotfiles.inspector.tui",
    setup(context) {
        const location = context.location ?? context.data.location.default()

        void Promise.all([
            context.data.location.agent.sync(location),
            context.data.location.command.sync(location),
            context.data.location.skill.sync(location),
        ])

        const sections: { key: Section; label: string; read: () => readonly unknown[] }[] = [
            {
                key: "agents",
                label: "Agents",
                read: () => context.data.location.agent.list(location) ?? [],
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
                        const names = section.read().map(label)
                        const collapsed = state[section.key]
                        return (
                            <box flexDirection="column">
                                <box
                                    flexDirection="row"
                                    onMouseDown={toggle(section.key)}
                                    onMouseUp={(e: MouseEvent) => e.stopPropagation()}
                                >
                                    <text>{`${collapsed ? "▸" : "▾"} ${section.label} (${names.length})`}</text>
                                </box>
                                {!collapsed && names.map((name) => <text>{`  ${name}`}</text>)}
                            </box>
                        )
                    })}
                </box>
            ),
        })
    },
})
