import { Plugin } from "@opencode/plugin/tui"
import { createSignal } from "solid-js"
import { AGENT_LABEL, COMMANDS, labelTone, MODEL_LABEL, type Tone } from "./panel"

// Clickable **agent** and **model** shortcuts in the prompt footer, each opening
// the dialog its leader key opens: <leader>a for agents, <leader>m for models.
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

        // The action is on the release, so a press-and-drag-away is a natural
        // cancel rather than a switch, and every handler stops propagation
        // because the host binds the footer itself.
        const hold = (event: MouseEvent) => event.stopPropagation()
        const open = (command: string) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            context.keymap.dispatch(command)
        }

        // One shortcut: a caption, and its own hover signal, created here and
        // read in render, where reading it is what subscribes the label to the
        // pointer. A signal read once at setup would hold whatever the colour was
        // at that moment.
        const shortcut = (command: string, caption: string) => {
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
                render: () => (
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
                ),
            })
        }

        // Agent first, then model. The host places contributions to this slot in
        // registration order, so the order here is the order on screen: the agent
        // is the context the model is used in, so it reads first.
        const agent = shortcut(COMMANDS.agent, AGENT_LABEL)
        const model = shortcut(COMMANDS.model, MODEL_LABEL)

        return () => {
            agent?.()
            model?.()
        }
    },
})
