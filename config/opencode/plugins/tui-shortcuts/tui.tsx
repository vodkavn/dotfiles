import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { AGENT_LABEL, COMMANDS, labelTone, MODEL_LABEL, showsAgentSwitch, type Tone } from "./panel"

// Clickable **agent** and **model** shortcuts in the prompt footer, each opening
// the dialog its leader key opens: <leader>a for agents, <leader>m for models.
// The agent one is omitted when the project has one primary agent or none, since
// there is then nothing to switch to.
//
// Why this is not the text opencode already draws. opencode renders the selected
// agent and model itself, and a plugin cannot make host-rendered text clickable
// -- it can only fill the regions it is given. So the footer gains two shortcuts
// of its own beside those readouts rather than turning them into buttons, and
// each names its action instead of repeating the value: a second copy of a name
// the host owns can only fall out of step with it.
//
// Why dispatch instead of a picker of our own. A dialog built here would have to
// reproduce search, favourites, variants, provider grouping, and the keyboard
// contract, and would drift from them the first time the host changed. Dispatch
// is also what opencode's own clickable footer rows do.
//
// Two registrations rather than one row holding two boxes. The verified layout
// finding in this repo is that a clickable row has to be one box holding one
// text: a second box beside it either stacks the columns or needs a nesting
// level that stops the region painting at all. The host already composes this
// footer from several contributions, so two contributions is the shape it
// handles -- one box and one text each.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

export default Plugin.define({
    id: "dotfiles.tui-shortcuts.tui",
    setup(context) {
        const ink = (tone: Tone) => (tone === "muted" ? context.theme.text.muted : context.theme.text.base)

        // The location whose agents decide whether the agent shortcut has a
        // choice to offer. Resolved per render from the session on screen, not
        // from context.location: that is captured at setup and would keep
        // answering for whichever project was open then.
        type Location = Parameters<typeof context.data.location.agent.sync>[0]
        const at = (sessionID: string | undefined): Location =>
            (sessionID === undefined ? undefined : context.data.session.get(sessionID))?.location ??
            context.data.location.default()

        // The agent registry is empty until its store syncs, so the read below
        // issues the sync once per location. Rejections are swallowed: the
        // client can point at a remote server, and a request that does not answer
        // must not take the footer down over a list showsAgentSwitch can do
        // without.
        const syncing = new Set<string>()
        const syncAgents = (location: Location) => {
            if (context.data.location.agent.list(location) !== undefined) return
            const key = JSON.stringify(location ?? null)
            if (syncing.has(key)) return
            syncing.add(key)
            void context.data.location.agent.sync(location).catch(() => {}).finally(() => syncing.delete(key))
        }

        // The action is on the release, so a press-and-drag-away is a natural
        // cancel rather than a switch, and every handler stops propagation
        // because the host binds the footer itself.
        const hold = (event: MouseEvent) => event.stopPropagation()
        const open = (command: string) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            context.keymap.dispatch(command)
        }

        // One shortcut: a caption, a reason to show it, and its own hover signal,
        // created here and read in render, where reading it is what subscribes
        // the label to the pointer. A signal read once at setup would hold
        // whatever the colour was at that moment.
        const shortcut = (command: string, caption: string, show: (input: { readonly sessionID?: string }) => boolean = () => true) => {
            const [hovered, setHovered] = createSignal(false)
            return context.ui.slot({
                // `after`, not `append`. The host's child inside
                // prompt.footer.status is a box with flexGrow:1, and while a turn
                // runs it draws a second one holding the spinner and the
                // interrupt hint. Appending lands inside that boundary, after the
                // greedy child, so the shortcut collapses to zero width for the
                // whole of a turn and only comes back once idle. `after` makes it
                // a sibling of the status box, where the greedy child cannot
                // reach it.
                after: "prompt.footer.status",
                render: (input) => (!show(input) ? null : (
                    <box
                        flexDirection="row"
                        flexShrink={0}
                        onMouseOver={() => setHovered(true)}
                        onMouseOut={() => setHovered(false)}
                        onMouseDown={hold}
                        onMouseUp={open(command)}
                    >
                        <text wrapMode="none" fg={ink(labelTone(hovered()))}>
                            {caption}
                        </text>
                    </box>
                )),
            })
        }

        // Agent first, then model. The host places contributions to this slot in
        // registration order, so the order here is the order on screen: the agent
        // is the context the model is used in, so it reads first.
        //
        // The agent is drawn only when that project offers a choice. It is read
        // here, in render, because the store is reactive and repaints when the
        // sync lands or the session changes project.
        const agent = shortcut(COMMANDS.agent, AGENT_LABEL, (input) => {
            const location = at(input.sessionID)
            syncAgents(location)
            return showsAgentSwitch(context.data.location.agent.list(location))
        })
        const model = shortcut(COMMANDS.model, MODEL_LABEL)

        return () => {
            agent?.()
            model?.()
        }
    },
})
