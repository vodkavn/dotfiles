// The **Token Usage** panel under opencode's own Context section: what the
// session has spent, by kind, with the two rates that make it readable.
//
// opencode's built-in `opencode.sidebar.context` plugin draws the context
// window as it stands -- the last step's total, the percentage of the model's
// window, the spend -- and hides the rest. This panel is the other reading: the
// session's own cumulative totals, which only grow, so a number that moved
// between two glances means another step ran rather than another step's shape
// changed. It is also why `Cache write` can sit at 0 for a whole session: a
// provider with implicit caching reports hits and never reports writes.
//
// The layout is Kilo Code's token panel: a label on the left, its value flush
// right, so the numbers can be read down one column instead of being matched
// across a grid.

// The token fields opencode reports, on a session and on a message alike. Only
// the ones this panel reads, and optional: a field the host did not report is
// handled as zero below.
type TokenFields = {
    readonly input?: number
    readonly output?: number
    readonly reasoning?: number
    readonly cache?: { readonly read?: number; readonly write?: number }
}

// The parts of a session this panel reads: opencode's cumulative token totals.
// Structural on purpose; naming the host's type would tie a drawn row to a
// package a plugin cannot import at runtime.
export type Session = { readonly tokens?: TokenFields }

// The parts of a session message this panel reads, for the one live rate it
// shows: how fast the latest generation ran.
export type Message = {
    readonly type: string
    readonly tokens?: TokenFields
    readonly time?: { readonly created?: number; readonly streamed?: number }
}

// The tones a row can wear: the label recedes, the value is what is read.
export type Tone = "muted" | "base"

export type Segment = { readonly text: string; readonly tone: Tone }

export type Line = { readonly segments: readonly Segment[] }

// The kinds a session's tokens come in, named as opencode names them:
// `cacheRead` is the prefix read back from the prompt cache, `cacheWrite` the
// part written into it.
export type Tokens = {
    readonly input: number
    readonly output: number
    readonly reasoning: number
    readonly cacheRead: number
    readonly cacheWrite: number
}

export type Usage = {
    readonly tokens: Tokens
    readonly cacheRate: number | undefined
    readonly speed: number | undefined
}

// A token count as the host reports it. A field the host did not report is
// zero rather than undefined: an undefined would make every number below NaN.
const count = (value: number | undefined): number =>
    typeof value === "number" && Number.isFinite(value) ? value : 0

// The share of the prompt that came back from the cache.
//
// The denominator is every prompt token -- uncached input, cache reads, and
// cache writes -- which is the rate Kilo Code reports and the one the host's
// own cache accounting adds up to.
export function cacheRateOf(tokens: Tokens): number | undefined {
    const prompt = tokens.input + tokens.cacheRead + tokens.cacheWrite
    if (prompt <= 0) return undefined
    return (tokens.cacheRead / prompt) * 100
}

// How many tokens per second a step generated.
//
// Generated tokens are output plus reasoning: a reasoning model spends part of
// the step thinking, and the host counts that work in its own throughput. The
// duration is the streaming window, `streamed - created`, so the wait before
// the first token is left out -- the host measures the same way. A step that
// did not stream has no speed to report rather than a made-up one.
export function speedOf(step: Message): number | undefined {
    const created = step.time?.created
    const streamed = step.time?.streamed
    if (created === undefined || streamed === undefined) return undefined
    const duration = streamed - created
    if (duration <= 0) return undefined
    const generated = count(step.tokens?.output) + count(step.tokens?.reasoning)
    if (generated <= 0) return undefined
    return generated / (duration / 1000)
}

// The latest generation's speed.
//
// The totals are cumulative, so the speed cannot be: it is a rate, and the only
// honest one is the last step that actually streamed. Found by scanning back
// for it rather than taking the last message, because a step interrupted before
// its first token has no streaming window to measure.
export function latestSpeed(messages: readonly Message[]): number | undefined {
    const step = messages.findLast(
        (message) => message.type === "assistant" && message.time?.streamed !== undefined,
    )
    return step ? speedOf(step) : undefined
}

// The session's totals as opencode reports them, with the latest generation's
// speed beside them.
export function usageOf(session: Session | undefined, messages: readonly Message[]): Usage | undefined {
    const tokens: Tokens = {
        input: count(session?.tokens?.input),
        output: count(session?.tokens?.output),
        reasoning: count(session?.tokens?.reasoning),
        cacheRead: count(session?.tokens?.cache?.read),
        cacheWrite: count(session?.tokens?.cache?.write),
    }
    // A session that has not spent anything yet gets no panel, as the host's
    // own section waits for its first step.
    const total = tokens.input + tokens.output + tokens.reasoning + tokens.cacheRead + tokens.cacheWrite
    if (total <= 0) return undefined
    return { tokens, cacheRate: cacheRateOf(tokens), speed: latestSpeed(messages) }
}

// Width of one row, in cells.
//
// Measured against opencode v2.1.0 rather than derived: the sidebar box is a
// fixed 42 columns with 2 columns of padding on each side, and the box that
// carries the sidebar.content slot adds one more on the right. That leaves 37,
// the same constant the subagent panel budgets its lines at. The width is not
// exposed to a sidebar.content slot, so this is a constant and the test pins
// the arithmetic; rows drawn with wrapMode="none" lose their overflow rather
// than the layout when the terminal is narrower.
export const WIDTH = 42 - 2 - 2 - 1

// One label/value row: the label inset by the section's two-cell body indent,
// its value flush right, and at least one space between them so a long pair
// does not read as one word. The row is still one panel width, so every value
// ends in the same column.
export const INDENT = 2

export function row(label: string, value: string): Line {
    const text = `${" ".repeat(INDENT)}${label}`
    const pad = Math.max(1, WIDTH - text.length - value.length)
    return {
        segments: [
            { text: `${text}${" ".repeat(pad)}`, tone: "muted" },
            { text: value, tone: "base" },
        ],
    }
}

const percent = (value: number | undefined): string => (value === undefined ? "-" : `${value.toFixed(1)}%`)

const rate = (value: number | undefined): string => (value === undefined ? "-" : `${value.toFixed(1)} t/s`)

// The panel's rows, in the order Kilo Code reads them. Every row is drawn,
// including a zero: the shape of the panel is the same from one session to the
// next, so the eye can go to the same place instead of re-finding each number.
//
// Cost is deliberately absent: the built-in Context section above already draws
// the spend, and a second dollar figure beside it could only disagree with it.
export function buildSection(usage: Usage): Line[] {
    const { tokens } = usage
    return [
        row("Input", tokens.input.toLocaleString()),
        row("Output", tokens.output.toLocaleString()),
        row("Reasoning", tokens.reasoning.toLocaleString()),
        row("Cache read", tokens.cacheRead.toLocaleString()),
        row("Cache write", tokens.cacheWrite.toLocaleString()),
        row("Cache rate", percent(usage.cacheRate)),
        row("Generation speed", rate(usage.speed)),
    ]
}
