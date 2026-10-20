import { Plugin } from "@opencode/plugin/tui"
import { TextAttributes } from "@opentui/core"
import { buildSection, usageOf, type Tone } from "./panel"

// A **Token Usage** panel in the sidebar, under opencode's own Context section:
// the session's cumulative tokens by kind, with the two rates that make them
// readable.
//
// The host's section draws the context window as it stands -- the last step's
// total, the percentage of the model's window, and the spend. This panel is the
// other reading: totals that only grow, so a number that moved between two
// glances means another step ran. Between them, "how full is the window" and
// "what has this session used" are both one glance away.
//
// It starts collapsed: the host's section above already answers the first
// question, so the breakdown is a detail to open rather than permanent chrome.
// The choice is persisted, so a panel that was opened stays open.
//
// The host's section is left where it is. A plugin cannot insert into it: the
// sidebar's content slot takes contributions in plugin enable order, so the
// only way to sit under the built-in section exactly would be to take over its
// plugin id and redraw it, and a copy of the host's own rows is a copy that
// can drift from them.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

export default Plugin.define({
    id: "dotfiles.context-detail.tui",
    setup(context) {
        // Persistent, unlike the subagent panel's memory store: a panel the
        // reader opened once should not fold itself again on the next start.
        const [state, setState] = context.storage.store("view", { initial: { open: false } })

        const ink = (tone: Tone) => (tone === "base" ? context.theme.text.base : context.theme.text.muted)

        // The toggle acts on the press, the way opencode's own sidebar rows do;
        // the release only stops propagation so the host's own sidebar binding
        // does not also fire.
        const toggle = (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            void setState((draft) => {
                draft.open = !draft.open
            }).catch((error) => console.error("Failed to persist the token panel state", error))
        }
        const hold = (event: MouseEvent) => event.stopPropagation()

        const dispose = context.ui.slot({
            append: "sidebar.content",
            render: (input) => {
                const session = context.data.session.get(input.sessionID)
                const usage = usageOf(session, context.data.session.message.list(input.sessionID))
                if (!usage) return null
                const lines = buildSection(usage)

                return (
                    <box flexDirection="column" gap={0}>
                        <box flexDirection="row" onMouseDown={toggle} onMouseUp={hold}>
                            <text fg={context.theme.text.base} attributes={TextAttributes.BOLD}>
                                {`${state.open ? "▼" : "▶"} Token Usage`}
                            </text>
                        </box>
                        {state.open &&
                            lines.map((line) => (
                                <box flexDirection="row">
                                    {line.segments.map((segment) => (
                                        <text wrapMode="none" fg={ink(segment.tone)}>
                                            {segment.text}
                                        </text>
                                    ))}
                                </box>
                            ))}
                    </box>
                )
            },
        })

        return () => {
            dispose?.()
        }
    },
})
