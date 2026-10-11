import { Plugin } from "@opencode/plugin/tui"

// Token speed and cache rate for the active session, kept per model so a
// mid-run model switch shows up as separate blocks instead of one blended
// average.
//
// Two regions are filled:
//
//   prompt.footer.status   one compact live line for the model behind the most
//                          recent assistant message
//   sidebar.content        a collapsible panel with the per-model breakdown
//
// Every list and every number is read inside render(), never captured during
// setup(). opencode runs render() inside a memo, so those reads register as
// dependencies and both regions repaint when the session store updates; a
// component body would run once and freeze the panel.
//
// Throughput follows opencode's own definition: output plus reasoning tokens
// over the span the provider actually streamed, not the message lifetime.
//
// Only the session handed to the slot is counted. Child sessions started by
// the task tool keep their own message lists and are not folded in here.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

type Tokens = {
    input: number
    output: number
    reasoning: number
    cacheRead: number
    cacheWrite: number
}

type Row = {
    key: string
    label: string
    messages: number
    tokens: Tokens
    cost: number
    generatedMs: number
    lastAt: number
}

type Surface = {
    text: {
        base: string
        muted: string
        feedback: {
            success: { base: string }
        }
    }
}

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}

const count = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0

// Assistant time.streamed is stamped while the step runs; time.completed is
// the fallback for steps that never streamed.
const streamed = (time: Record<string, unknown>): number => {
    const end = time.streamed === undefined ? time.completed : time.streamed
    if (end === undefined) return 0
    return Math.max(0, count(end) - count(time.created))
}

const collect = (
    messages: readonly unknown[],
    label: (providerID: string, modelID: string, variant: string) => string,
): Row[] => {
    const rows = new Map<string, Row>()
    for (const entry of messages) {
        const message = record(entry)
        if (message.type !== "assistant") continue
        if (message.tokens === undefined || message.tokens === null) continue
        const usage = record(message.tokens)
        const cache = record(usage.cache)
        const model = record(message.model)
        const time = record(message.time)
        const providerID = String(model.providerID ?? "?")
        const modelID = String(model.id ?? "?")
        const variant = model.variant === undefined ? "" : String(model.variant)
        const key = `${providerID}/${modelID}#${variant}`
        let row = rows.get(key)
        if (!row) {
            row = {
                key,
                label: label(providerID, modelID, variant),
                messages: 0,
                tokens: { input: 0, output: 0, reasoning: 0, cacheRead: 0, cacheWrite: 0 },
                cost: 0,
                generatedMs: 0,
                lastAt: 0,
            }
            rows.set(key, row)
        }
        row.messages += 1
        row.tokens.input += count(usage.input)
        row.tokens.output += count(usage.output)
        row.tokens.reasoning += count(usage.reasoning)
        row.tokens.cacheRead += count(cache.read)
        row.tokens.cacheWrite += count(cache.write)
        row.cost += count(message.cost)
        row.generatedMs += streamed(time)
        row.lastAt = Math.max(row.lastAt, count(time.created))
    }
    return [...rows.values()].sort((a, b) => b.lastAt - a.lastAt)
}

const speed = (row: Row): number =>
    row.generatedMs > 0 ? (row.tokens.output + row.tokens.reasoning) / (row.generatedMs / 1000) : 0

// Providers that cache implicitly report zero for every cache field, which is
// indistinguishable from a cache that never hit. Show a dash rather than a
// misleading 0%.
const cached = (row: Row): number | undefined => {
    const prompt = row.tokens.input + row.tokens.cacheRead + row.tokens.cacheWrite
    if (prompt <= 0) return undefined
    return row.tokens.cacheRead / prompt
}

// Drops the trailing zero so "30.0K" prints as "30K"; every panel line below
// is width-constrained by the 42 column sidebar.
const trim = (value: number): string => String(Number(value.toFixed(1)))

const compact = (value: number): string => {
    const abs = Math.abs(value)
    // Pick the unit, then let the rounding promote a value that rounds up into
    // the next unit: 999999 must read "1M", never "1000K". Promoting after the
    // division, rather than widening the threshold, keeps 949999 at "950K"
    // instead of collapsing it to "0.9M".
    let scale = abs >= 1000000 ? 1000000 : abs >= 1000 ? 1000 : 1
    let scaled = trim(value / scale)
    if (scale < 1000000 && Number(scaled) >= 1000) {
        scale = scale * 1000
        scaled = trim(value / scale)
    }
    const unit = scale === 1000000 ? "M" : scale === 1000 ? "K" : ""
    return `${scaled}${unit}`
}

// Hard clips a panel line to the sidebar's usable width. The text elements
// already truncate, but only on the label row; metric rows are sized by their
// content and would otherwise push the box wider than the sidebar.
const clip = (text: string, width: number): string =>
    text.length <= width ? text : `${text.slice(0, Math.max(0, width - 1))}…`

// Every formatter tolerates an absent row so a session with no assistant
// message yet renders as empty text instead of throwing.
const perSecond = (row: Row | undefined): string => {
    if (!row) return ""
    const value = speed(row)
    return value > 0 ? `${value.toFixed(1)} tok/s` : "— tok/s"
}

const hitRate = (row: Row | undefined): string => {
    if (!row) return ""
    const value = cached(row)
    return value === undefined ? "—" : `${(value * 100).toFixed(2)}%`
}

// WIDTH is the sidebar's usable text columns: the host renders the sidebar at
// width 42 with paddingLeft 2 and paddingRight 2. LABEL is the budget for the
// left column of each stat line; the right column takes whatever is left.
const WIDTH = 38
const LABEL = 15
const GAP = 2

// One model becomes a block of stat rows, each row pairing numbers that mean
// something together: throughput with its cache rate, prompt with completion,
// cache read with cache write, spend with turn count.
const statRows = (row: Row): [string, string][] => [
    [perSecond(row), `cache ${hitRate(row)}`],
    [`in ${compact(row.tokens.input)}`, `out ${compact(row.tokens.output + row.tokens.reasoning)}`],
    [`cache r ${compact(row.tokens.cacheRead)}`, `w ${compact(row.tokens.cacheWrite)}`],
    [`$${row.cost.toFixed(2)}`, `${row.messages} msg`],
]

const statLine = (row: Row): string[] => {
    const width = Math.min(
        LABEL,
        statRows(row).reduce((widest, [left]) => Math.max(widest, left.length), 0),
    )
    return statRows(row).map(([left, right]) =>
        clip(`  ${left.padEnd(width)}${" ".repeat(GAP)}${right}`, WIDTH),
    )
}

const Live = (props: { rows: readonly Row[]; surface: Surface }) => {
    // As with Panel, no prop may be read in the body; see the note there.
    const surface = props.surface
    return (
        <box flexDirection="row" flexShrink={0}>
            <text fg={surface.text.base}>{perSecond(props.rows[0])}</text>
            {props.rows[0] !== undefined && <text fg={surface.text.muted}>{` · cache ${hitRate(props.rows[0])}`}</text>}
        </box>
    )
}

const Panel = (props: {
    rows: readonly Row[]
    surface: Surface
    open: boolean
    toggle: (event: MouseEvent) => void
    stop: (event: MouseEvent) => void
}) => {
    // A component body runs once, so nothing that depends on props may be
    // computed here. Every read below sits inside JSX, where opencode's Solid
    // runtime re-evaluates it when the underlying signal changes; hoisting
    // these into consts freezes the disclosure arrow on the first paint.
    //
    // The row bullet is the same glyph opencode's own MCP sidebar section
    // draws. MCP has no "current" row to single out, so the model behind the
    // most recent message is marked with colour on the bullet and the label
    // rather than a second, heavier glyph.
    const surface = props.surface
    return (
        <box flexDirection="column" gap={0}>
            <box flexDirection="row" flexShrink={0} onMouseDown={props.toggle} onMouseUp={props.stop}>
                <text fg={surface.text.base}>{`${props.open ? "▾" : "▸"} Tokens`}</text>
                {props.rows.length > 0 && (
                    <text fg={surface.text.muted}>
                        {props.open
                            ? ` (${props.rows.length} model${props.rows.length === 1 ? "" : "s"})`
                            : ` (${perSecond(props.rows[0])} · ${hitRate(props.rows[0])})`}
                    </text>
                )}
            </box>
            {props.open &&
                props.rows.map((row, index) => (
                    <box flexDirection="column">
                        <box flexDirection="row" flexShrink={1} minWidth={0}>
                            <text fg={index === 0 ? surface.text.feedback.success.base : surface.text.muted}>
                                {"•"}
                            </text>
                            <text
                                fg={index === 0 ? surface.text.base : surface.text.muted}
                                wrapMode="none"
                                truncate={true}
                                flexShrink={1}
                                minWidth={0}
                            >{` ${row.label}`}</text>
                        </box>
                        {statLine(row).map((line) => (
                            <text fg={surface.text.muted} wrapMode="none" truncate={true}>{line}</text>
                        ))}
                    </box>
                ))}
        </box>
    )
}

export default Plugin.define({
    id: "dotfiles.tokens.tui",
    setup(context) {
        // Collapsed by default: the collapsed headline still carries the live
        // tok/s and cache rate, so the panel only expands on demand.
        const [state, setState] = context.storage.memory("panel", {
            initial: { open: false },
        })

        const toggle = (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            setState((draft) => {
                draft.open = !draft.open
            })
        }
        const stop = (event: MouseEvent) => event.stopPropagation()

        const read = (sessionID: string | undefined): Row[] => {
            if (!sessionID) return []
            const messages = context.data.session.message.list(sessionID) ?? []
            const session = context.data.session.get(sessionID)
            const models = context.data.location.model.list(session?.location) ?? []
            const label = (providerID: string, modelID: string, variant: string): string => {
                const entry = models.find((model) => model?.providerID === providerID && model?.id === modelID)
                const base = entry?.name ? String(entry.name) : `${providerID}/${modelID}`
                return variant === "" || variant === "default" ? base : `${base} (${variant})`
            }
            return collect(messages, label)
        }

        context.ui.slot({
            append: "prompt.footer.status",
            render: (props) => <Live rows={read(props.sessionID)} surface={context.theme} />,
        })

        context.ui.slot({
            append: "sidebar.content",
            render: (props) => (
                <Panel
                    rows={read(props.sessionID)}
                    surface={context.theme}
                    open={state.open}
                    toggle={toggle}
                    stop={stop}
                />
            ),
        })
    },
})
