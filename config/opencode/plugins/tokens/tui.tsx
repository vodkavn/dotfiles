import { Plugin } from "@opencode/plugin/tui"

// Token speed and cache rate for the active session, kept per model so a
// mid-run model switch shows up as separate blocks instead of one blended
// average. Alongside it, what the context window is actually made of.
//
// Three regions are filled:
//
//   prompt.footer.status   one compact live line for the model behind the most
//                          recent assistant message
//   sidebar.content        a collapsible panel with the per-model breakdown
//   sidebar.content        a second collapsible panel breaking the context
//                          down by data type, each row explaining itself on
//                          click
//
// Both sidebar panels are separate claims on the same slot. Claims coexist in
// plugin enable order, so Context renders directly below Tokens, and each one
// repaints on its own without either depending on the other's state.
//
// Every list and every number is read inside render(), never captured during
// setup(). opencode runs render() inside a memo, so those reads register as
// dependencies and all regions repaint when the session store updates; a
// component body would run once and freeze the panel.
//
// Throughput follows opencode's own definition: output plus reasoning tokens
// over the span the provider actually streamed, not the message lifetime.
//
// The context breakdown is sized from characters and anchored to the one number
// opencode reports exactly; see the note above CHARS_PER_TOKEN. It is
// session-wide rather than per model, because a prompt is assembled from the
// whole history regardless of which model produced which turn.
//
// Only the session handed to the slot is counted. Child sessions started by
// the task tool keep their own message lists and are not folded in here.
//
// Two rules govern every row in both panels, and both were learned the hard way:
//
//   No comment may sit inside a JSX expression. opencode's transform compiles a
//   `//` comment there into a text node rather than dropping it, and OpenTUI then
//   rejects that node because its parent is a box and not a text. Keep
//   explanatory comments at module scope or above the return; never between the
//   arrow of a `.map()` and the element it returns.
//
//   Click targets act on pointer release, never on pointer press. Raw OpenTUI
//   elements have no click prop, only the pointer family, so firing on down
//   opens the dialog the instant the button goes down and leaves it hanging
//   there for as long as the button is held. Every row therefore stops
//   propagation on press and acts on release, which also means pressing and
//   dragging away never opens anything.
//
// A row is one box holding one text, with the handler on the box so the whole
// row is the target rather than only the glyphs under the pointer. No key, and
// no extra nesting: a stat line keeps its two numbers side by side inside a
// single box, because a box per number either stacks them or needs a third
// level that stops the section rendering at all.

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
    // Provider metadata for this model, resolved while rendering so that the
    // click handler needs nothing but the row. Absent when the provider is not
    // in opencode's registry, which the model dialog then says outright rather
    // than showing an empty box.
    info?: ModelSummary
}

// The slice of opencode's ModelInfo this panel reads. Declared locally, like
// Row and Surface, so the plugin depends on no client types and a provider that
// sends fewer fields than expected simply leaves them absent.
type ModelSummary = {
    providerID?: string
    modelID?: string
    family?: string
    canonical?: string
    status?: string
    released?: number
    context?: number
    input?: number
    output?: number
    cost?: { input: number; output: number; cache: { read: number; write: number }; tier?: number }[]
    tools?: boolean
    accepts?: string[]
    returns?: string[]
    variants?: string[]
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
        const providerID = optional(String(model.providerID ?? "")) ?? "?"
        const modelID = optional(String(model.id ?? "")) ?? "?"
        const variant = optional(String(model.variant ?? "")) ?? ""
        const key = `${providerID}/${modelID}#${variant}`
        let row = rows.get(key)
        if (!row) {
            row = {
                key,
                label: label(providerID, modelID, variant),
                providerID,
                modelID,
                variant,
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

// ---------------------------------------------------------------------------
// Model metadata
// ---------------------------------------------------------------------------

// opencode identifies a model by provider plus a bare id, but a registry entry
// carries both a bare modelID and a qualified id, and which of the two a given
// provider populates is not something this plugin can assume. Match on either,
// and accept the qualified spelling too, so a model is found rather than
// silently missing.
const matchesModel = (model: unknown, providerID: string, modelID: string): boolean => {
    const entry = record(model)
    if (String(entry.providerID ?? "") !== providerID) return false
    return entry.modelID === modelID || entry.id === modelID || entry.id === `${providerID}/${modelID}`
}

// Every provider-supplied string goes through here on its way into a note, and a
// note is structured by newlines and runs of spaces. A capability or variant
// carrying a newline or a stray double space would break that structure, so
// values are flattened to a single trimmed line before anything reads them.
const optional = (value: unknown): string | undefined => {
    if (typeof value !== "string") return undefined
    const flat = value.replace(/\s+/g, " ").trim()
    return flat.length > 0 ? flat : undefined
}

const strings = (value: unknown): string[] =>
    Array.isArray(value) ? value.map((item) => optional(String(item))).filter((item): item is string => item !== undefined) : []

// Copies out only the fields ModelSummary names. Everything is defensive: the
// registry is provider-supplied, so a missing field has to mean "not reported"
// rather than throw inside a render. Plain fields go through optional(String())
// and never through record(), which would hand back an empty object for them.
const summary = (model: unknown): ModelSummary | undefined => {
    const entry = record(model)
    const providerID = optional(String(entry.providerID ?? ""))
    if (providerID === undefined) return undefined
    const limit = record(entry.limit)
    const capabilities = record(entry.capabilities)
    const rates = Array.isArray(entry.cost)
        ? entry.cost.map((item) => {
              const rate = record(item)
              const cache = record(rate.cache)
              return {
                  input: count(rate.input),
                  output: count(rate.output),
                  cache: { read: count(cache.read), write: count(cache.write) },
                  // Some models price by prompt length: each entry covers
                  // contexts up to its own size, and the last one is the
                  // ceiling. A size of zero is not a tier, so it is dropped.
                  tier: count(record(rate.tier).size) || undefined,
              }
          })
        : undefined
    return {
        providerID,
        modelID: optional(String(entry.modelID ?? entry.id ?? "")),
        family: optional(String(entry.family ?? "")),
        canonical: optional(String(entry.canonical ?? "")),
        status: optional(String(entry.status ?? "")),
        released: count(record(entry.time).released),
        context: count(limit.context),
        input: count(limit.input),
        output: count(limit.output),
        cost: rates,
        tools: capabilities.tools === true,
        accepts: strings(capabilities.input),
        returns: strings(capabilities.output),
        variants: strings(Array.isArray(entry.variants) ? entry.variants.map((item) => record(item).id) : undefined),
    }
}

// Thousands separators, because a context limit is the one number on this panel
// worth reading exactly rather than through compact().
const grouped = (value: number): string => String(Math.round(value)).replace(/\B(?=(\d{3})+(?!\d))/g, ",")

const money = (value: number): string => `$${value.toFixed(2)}`

const day = (ms: number): string => {
    if (!Number.isFinite(ms) || ms <= 0) return ""
    const date = new Date(ms)
    return Number.isNaN(date.getTime()) ? "" : date.toISOString().slice(0, 10)
}

// "a, b and c", the way the rest of the panel's prose reads.
const listed = (items: readonly string[]): string =>
    items.length === 0
        ? ""
        : items.length === 1
          ? items[0]
          : `${items.slice(0, -1).join(", ")} and ${items[items.length - 1]}`

const dropped = (parts: readonly (string | undefined)[]): string[] =>
    parts.filter((part): part is string => part !== undefined && part.length > 0)

// A rate the provider reported as negative or non-finite is malformed, and
// printing it as "$-1.00" would be worse than leaving it out.
const rate = (label: string, value: number): string | undefined =>
    Number.isFinite(value) && value >= 0 ? `${label} ${money(value)}` : undefined

// Which price tier this model actually fell into. The entries are ordered, each
// covering contexts up to its own size, so the first entry whose size the
// prompt fits under is the right one; a prompt past every tier takes the last.
// The prompt size is the same total the cache rate above is built from: the
// input, cache read and cache write this model needed.
const priced = (row: Row, rates: NonNullable<ModelSummary["cost"]>): NonNullable<ModelSummary["cost"]>[number] => {
    const prompt = row.tokens.input + row.tokens.cacheRead + row.tokens.cacheWrite
    return rates.find((entry) => entry.tier === undefined || prompt <= entry.tier) ?? rates[rates.length - 1]
}

// What opencode knows about a model, for the dialog behind its name. Every
// paragraph is dropped when the registry did not report enough to fill it, so a
// sparse provider yields a short note rather than a list of blanks.
const modelNote = (row: Row): string => {
    const info = row.info
    if (info === undefined) {
        return `opencode has no entry for this model in its registry at this location, so it cannot say anything about the model itself. What this session recorded is still here: ${row.messages} ${row.messages === 1 ? "turn" : "turns"} for ${money(row.cost)}.`
    }
    const chosen = info.cost?.[0] === undefined ? undefined : priced(row, info.cost)
    const prices =
        chosen === undefined
            ? ""
            : dropped([
                  rate("input", chosen.input),
                  rate("output", chosen.output),
                  rate("cache read", chosen.cache.read),
                  rate("cache write", chosen.cache.write),
              ]).join(", ")
    // Only worth saying when the registry offered more than one price to choose
    // from; with a single rate the tier line would just restate the numbers.
    const tiered =
        chosen !== undefined && (info.cost?.length ?? 0) > 1
            ? ` Price varies with prompt length; this is the ${
                  chosen.tier === undefined ? "base rate" : `rate for prompts up to ${grouped(chosen.tier)} tokens`
              }.`
            : ""
    // Sanitised again on the way in, so the note's one-line-per-paragraph shape
    // holds however the row was built, not only when collect() built it.
    const variant = optional(row.variant) ?? ""
    const paragraphs = [
        [
            `This model is registered as ${info.providerID}/${info.modelID ?? row.modelID}.`,
            optional(info.family) === undefined ? undefined : `Family ${info.family}.`,
            optional(info.status) === undefined ? undefined : `Status ${info.status}.`,
            day(info.released) === "" ? undefined : `Released ${day(info.released)}.`,
        ]
            .filter((part): part is string => part !== undefined)
            .join(" "),
        dropped([
            info.context > 0 ? `context window ${grouped(info.context)}` : undefined,
            // Often the same number as the window. Printing it twice reads as a
            // mistake, so it is only shown when it actually differs.
            info.input > 0 && info.input !== info.context ? `max input ${grouped(info.input)}` : undefined,
            info.output > 0 ? `max completion ${grouped(info.output)}` : undefined,
        ]).join(", "),
        prices === "" ? undefined : `Price per million tokens: ${prices}.${tiered}`,
        // "cannot call tools" is only claimed when the provider said something
        // about the model at all. A provider that reports no capabilities has
        // told us nothing, which is not the same as having told us no.
        dropped([
            info.accepts.length > 0 ? `accepts ${listed(info.accepts)}` : undefined,
            info.returns.length > 0 ? `returns ${listed(info.returns)}` : undefined,
            info.tools ? "supports tools" : info.accepts.length + info.returns.length > 0 ? "cannot call tools" : undefined,
        ]).join(", "),
        dropped([
            info.variants.length > 0 ? `Variants offered: ${listed(info.variants)}.` : undefined,
            variant === "" || variant === "default" ? undefined : `This block is the ${variant} variant.`,
        ]).join(" "),
    ]
    // A paragraph is undefined, empty, or a bare list depending on what the
    // provider reported. Empty drops out; a bare list is capitalised and given a
    // full stop, but only if it did not already bring its own punctuation.
    const body = paragraphs
        .filter((paragraph): paragraph is string => typeof paragraph === "string" && paragraph.length > 0)
        .map((paragraph) => {
            const sentence = /^[A-Z]/.test(paragraph)
                ? paragraph
                : `${paragraph.charAt(0).toUpperCase()}${paragraph.slice(1)}`
            return /[.!?:]$/.test(sentence) ? sentence : `${sentence}.`
        })
    return body.length > 0 ? body.join("\n\n") : `opencode has this model under ${info.providerID}, but reported nothing else about it.`
}

// ---------------------------------------------------------------------------
// Context composition
// ---------------------------------------------------------------------------

// Buckets, in the order they are labelled before sorting by size. Ties keep
// this order, which is roughly the order they appear in a prompt.
const ORIGINS = ["prefix", "output", "summary", "reasoning", "call", "answer", "prompt", "files"] as const

type Origin = (typeof ORIGINS)[number]

// Every bucket lives in the prompt, so every label has to say what the model
// actually reads. "prefix" is the residue the message walk cannot see: the
// agent system prompt, the instruction files, and the tool schemas.
const ORIGIN_LABEL: Record<Origin, string> = {
    prefix: "sys+tools",
    output: "tool output",
    summary: "summary",
    reasoning: "reasoning",
    call: "tool call",
    answer: "answer",
    prompt: "prompt",
    files: "files",
}

// What a row means when someone asks. A bare definition is not enough on its
// own: a reader looking at a number needs to know whether it is a problem, and
// which lever moves it. Each note therefore says what lands in the bucket, what
// makes it grow, and what to do about it.
//
// Each paragraph is one source line, separated by a blank line. opencode's
// dialog wraps the message to whatever width it is actually rendered at, so
// hard-wrapping here would only bake in a guess about that width and make every
// later edit a re-counting exercise.
const ORIGIN_NOTE: Record<Origin, string> = {
    prefix: `The fixed cost of every request: the agent system prompt, the instruction files it picked up (AGENTS.md and friends), and the JSON schema of every tool it may call.

opencode re-sends all of it on every turn, so it is paid for in full each time whether or not it changed. It is a residual rather than a measurement: whatever the message list cannot account for lands here, which is also where any drift between the character estimate and the provider's real count shows up.

The one slice you cannot shrink by writing shorter prompts. Trim the instructions, or drop tools the agent never uses.`,
    output: `What your tools returned: the contents of files read, the lines grep matched, the output of a shell command.

This accumulates across the whole session and is re-sent on every turn, so a long working session fills the window with text that was only ever needed once. It is usually the largest thing worth cutting.

opencode prunes some older tool results from the prompt it actually sends while leaving them on disk, so the character walk can overshoot here. When it does, the panel scales the rows to fit and says so underneath.`,
    summary: `A compaction summary, plus the tail of the conversation the compaction kept, plus any system, synthetic, or skill message text injected into the prompt.

After a compaction this stands in for everything it replaced, which is how a long session keeps going without growing without bound.

Small next to what it replaces, and that is the point of compacting. If it is ever a large share, the session ran long before anything was summarised away.`,
    reasoning: `The model's own thinking, stored as reasoning parts on its assistant messages.

Whether this costs you context depends on the provider: some re-send earlier reasoning on every turn, some drop it once the turn ends. The panel counts what is stored on the messages either way, so read this row as an upper bound if your provider discards it.

Reasoning across a long tool chain is where it adds up.`,
    call: `The serialised arguments the model used to call a tool: file paths, command strings, grep patterns.

Much smaller than what the tools answered with, but it is the model's own output rather than data it was handed, so it scales with how much the agent does rather than with how much you say.`,
    answer: `Assistant text: commentary addressed to you, and any reply that was not a tool call.

Rarely the largest slice, because opencode and the models behind it are built to work in tool calls rather than prose. If this row ever dominates, the model is writing long explanations instead of editing files.`,
    prompt: `What you typed, as stored on the user messages: including any command, skill, or injected text that arrives as a user message rather than as system text.

It grows only when you paste. A short question costs the same as a long one, which makes this the least interesting row to watch.`,
    files: `Attached files: the name, description, and mention text, plus the payload itself.

The payload is counted at roughly 300 characters per token instead of four, because an image is billed in vision tokens rather than text ones. A screenshot therefore costs the thousands of tokens it really is, instead of the millions its base64 would suggest at text rates.

Image-heavy sessions live or die on this row.`,
}

type Chars = Record<Origin, number>

const empty = (): Chars => ({
    prefix: 0,
    output: 0,
    summary: 0,
    reasoning: 0,
    call: 0,
    answer: 0,
    prompt: 0,
    files: 0,
})

// The CLI plugin runtime ships no tokenizer, so nothing here counts tokens
// directly. Characters give the *shares* reliably, and the total is anchored to
// the prompt size the provider itself reported for the most recent assistant
// message. The panel says which of the two it is showing.
//
// CHARS_PER_TOKEN is the usual rule of thumb for prose and code. Base64
// attachment payloads are the exception and are converted back into equivalent
// characters before the single divisor is applied: an image is billed in vision
// tokens, so counting its base64 at four characters per token would swamp the
// whole breakdown with one screenshot.
const CHARS_PER_TOKEN = 4
const ATTACHMENT_CHARS_PER_TOKEN = 300

const text = (value: unknown): number => (typeof value === "string" ? value.length : 0)

// Tool inputs and attachment metadata are JSON values that still occupy the
// prompt verbatim, so their serialised length is the proxy. The stringify is
// guarded: a provider can hand back anything it likes, including a cycle.
const json = (value: unknown): number => {
    if (value === undefined || value === null) return 0
    try {
        const encoded = typeof value === "string" ? value : JSON.stringify(value)
        return encoded === undefined ? 0 : encoded.length
    } catch {
        return 0
    }
}

const measurePart = (part: unknown, into: Chars): void => {
    const entry = record(part)
    const type = entry.type
    if (type === "text") {
        into.answer += text(entry.text)
        return
    }
    if (type === "reasoning") {
        into.reasoning += text(entry.text)
        return
    }
    // The only third part type opencode puts on an assistant message is a tool
    // call; anything unknown is ignored rather than guessed at.
    if (type !== "tool") return
    const state = record(entry.state)
    into.call += json(state.input)
    for (const item of Array.isArray(state.content) ? state.content : []) {
        const result = record(item)
        // Text is the whole payload. A file result carries only a uri, and the
        // bytes behind it belong to the provider, not to anything measurable
        // here, so it contributes its label and nothing more.
        if (result.type === "text") into.output += text(result.text)
        else into.output += text(result.uri) + text(result.name)
    }
}

const measureMessage = (message: unknown, into: Chars): void => {
    const entry = record(message)
    if (entry.type === "assistant") {
        for (const part of Array.isArray(entry.content) ? entry.content : []) measurePart(part, into)
        return
    }
    if (entry.type === "user") {
        into.prompt += text(entry.text)
        for (const file of Array.isArray(entry.files) ? entry.files : []) {
            const attachment = record(file)
            // Name, description, and the mention span are text the model reads
            // verbatim; only the payload needs the binary divisor.
            into.files += text(attachment.name) + text(attachment.description) + json(attachment.mention)
            into.files += (json(attachment.data) * CHARS_PER_TOKEN) / ATTACHMENT_CHARS_PER_TOKEN
        }
        return
    }
    if (entry.type === "compaction") {
        // A completed compaction drops everything it replaced, so its summary
        // and retained tail are the only parts of the history still in play.
        into.summary += text(entry.summary) + text(entry.recent)
        return
    }
    // System, synthetic, and skill messages are instruction text injected into
    // the prompt rather than something either side typed as conversation.
    if (entry.type === "system" || entry.type === "synthetic" || entry.type === "skill") {
        into.summary += text(entry.text)
    }
}

// Walks the window the provider last actually saw and returns both the
// character counts and that window's exact prompt size.
const compose = (messages: readonly unknown[]): { chars: Chars; exact: number } => {
    const chars = empty()
    let exact = 0
    let start = 0
    let end = -1
    for (let index = 0; index < messages.length; index++) {
        const message = record(messages[index])
        // The last completed compaction resets the history, so the window opens
        // there rather than at the first message on disk.
        if (message.type === "compaction" && message.status === "completed") start = index
        if (message.type !== "assistant" || message.tokens === undefined) continue
        const usage = record(message.tokens)
        const cache = record(usage.cache)
        // Input plus both cache counters is what the provider had to hold for
        // that turn: uncached prompt, cache it re-read, and cache it wrote.
        exact = count(usage.input) + count(cache.read) + count(cache.write)
        end = index
    }
    // Messages after the newest counted assistant message — a prompt waiting on
    // the next turn — are not part of any context yet. A compaction that
    // landed after it still has to be inside the window, or its summary would
    // never be counted. With no counted assistant message at all there is no
    // reported window to cut at, so the retained history is measured whole and
    // the caller gets an estimate with nothing to anchor it to.
    const stop = end === -1 ? messages.length : Math.max(end, start - 1) + 1
    for (const message of messages.slice(start, stop)) measureMessage(message, chars)
    return { chars, exact }
}

// One rendered row: the bucket it came from, the label shown for it, and the
// tokens the split assigned it. The origin is carried alongside the label so the
// row can identify itself when asked to explain itself.
type Slice = { origin: Origin; label: string; tokens: number }

type Split = {
    rows: Slice[]
    // Rows always sum to this. It is the provider's own prompt size once one has
    // been reported, and the bare estimate until then.
    total: number
}

// Everything the character walk cannot reach lands in the prefix residual, which
// is worth naming precisely: the system prompt, the instruction files, and the
// tool schemas are re-sent every turn and are usually the largest single slice
// of a context window.
const split = (messages: readonly unknown[]): Split => {
    const { chars, exact } = compose(messages)
    const measured = ORIGINS.reduce((sum, origin) => sum + chars[origin], 0)
    const anchored = exact > 0
    // Nothing in the history is measurable, yet the provider still reported a
    // prompt. All of it is therefore prefix — the system prompt, the instruction
    // files, and the tool schemas — and saying so beats showing a total above
    // an empty table.
    if (measured === 0) {
        const rows = exact > 0 ? [{ origin: "prefix" as Origin, label: ORIGIN_LABEL.prefix, tokens: exact }] : []
        return { rows, total: exact }
    }
    const estimate = Math.round(measured / CHARS_PER_TOKEN)
    // A character walk can overshoot, because opencode prunes older tool output
    // out of the prompt while the messages stay on disk. Rather than report a
    // breakdown larger than the context it describes, the walk is scaled into
    // whatever the provider reported. Either way the rows add up to the total.
    const scaled = anchored && estimate > exact
    const body = scaled ? exact : estimate
    const prefix = anchored ? Math.max(0, exact - body) : 0
    const rows: Slice[] = []
    let carried = 0
    let previous = 0
    for (const origin of ORIGINS) {
        // Rounding the running total and subtracting the previous row, rather
        // than rounding each row on its own, keeps the column summing to the
        // body instead of drifting by a token per row.
        carried += chars[origin]
        const through = Math.round((carried / measured) * body)
        rows.push({ origin, label: ORIGIN_LABEL[origin], tokens: through - previous })
        previous = through
    }
    rows.sort((a, b) => b.tokens - a.tokens || ORIGINS.indexOf(a.origin) - ORIGINS.indexOf(b.origin))
    if (prefix > 0) rows.unshift({ origin: "prefix", label: ORIGIN_LABEL.prefix, tokens: prefix })
    return { rows: rows.filter((row) => row.tokens > 0), total: anchored ? exact : body }
}

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

// A stat line pairs two numbers that mean something together, so the pair is
// what a click explains: throughput with its cache rate, prompt with
// completion, cache read with cache write, spend with turn count.
//
// The target is the line, not the individual number. A per-number target needs
// two boxes nested inside the line box to keep both halves side by side, and
// that third level of nesting is what made the whole section fail to render. The
// line box here is shaped exactly like a context row, which is known to work.
type Pair = "throughput" | "tokens" | "cache" | "spend"

const PAIR_LABEL: Record<Pair, string> = {
    throughput: "throughput and cache rate",
    tokens: "prompt and completion",
    cache: "cache read and write",
    spend: "spend and turns",
}

// Same shape as ORIGIN_NOTE: what each number is, what moves it, and what is
// normal. One paragraph per line, because opencode's dialog wraps the message
// to whatever width it is rendered at.
const PAIR_NOTE: Record<Pair, string> = {
    throughput: `Left is output plus reasoning tokens over the span the provider actually streamed, not the whole message lifetime. Low is not automatically bad: a long generation, a reasoning-heavy turn, and a rate-limited provider all stretch it out.

Right is cache reads as a share of everything the provider had to hold for the turn, which is fresh input plus cache read plus cache write. Around 80% and above means opencode is re-reading a stable prefix instead of re-sending it; near zero means every turn pays full price for input it has already seen.

A provider that caches implicitly reports zero for every field, which is indistinguishable from a cache that never hit, so those read as a dash rather than 0%.`,
    tokens: `Left is prompt tokens the provider actually computed: the uncached remainder after cache reads. Read it against the cache rate above rather than on its own, because a large number beside a high cache rate is a large prompt being read cheaply, and the same number beside a low rate is the expensive case.

Right is completion tokens billed for the turn, reasoning included. Reasoning is folded in because the provider reports both in the same stream, so there is no way to separate them here. On a reasoning model this is usually mostly thinking rather than answer text.`,
    cache: `Left is prompt tokens served from the cache instead of being computed again. This is the discount, it grows turn over turn as the same prefix comes back, and it is what makes a long session affordable. It is also why the context can be enormous without being expensive.

Right is prompt tokens written into the cache so that later turns can read them back. That is charged above the ordinary input rate and usually with a minimum lifetime, so a session that ends early can pay to fill a cache it never gets to reuse.

A large write number is normal on a session that has just started, because the early turns are almost all writes. A large one on a session that has been running a while means the prefix keeps changing and almost nothing is being reused.`,
    spend: `Left is what the provider charged for this model across the whole session, in US dollars. It moves with the model, the cache rate, and the reasoning tokens, and a pricier model at a similar cache rate is the usual cause of a jump. Because cache reads are discounted heavily, the cache rate above accounts for most of the difference between two otherwise similar runs.

Right is the number of assistant turns this model produced, counted across all of its messages. A turn is one model response, however many tool calls it made inside it.

Turns is the divisor behind the throughput figure and the multiplier behind the cost, so many turns at a low total means cheap turns rather than few of them.`,
}

// One stat line, with the pair it explains.
type StatLine = { pair: Pair; text: string }

const statLines = (row: Row): StatLine[] => {
    const pairs: [Pair, string, string][] = [
        ["throughput", perSecond(row), `cache ${hitRate(row)}`],
        ["tokens", `in ${compact(row.tokens.input)}`, `out ${compact(row.tokens.output + row.tokens.reasoning)}`],
        ["cache", `cache r ${compact(row.tokens.cacheRead)}`, `w ${compact(row.tokens.cacheWrite)}`],
        ["spend", `$${row.cost.toFixed(2)}`, `${row.messages} msg`],
    ]
    const width = Math.min(
        LABEL,
        pairs.reduce((widest, [, left]) => Math.max(widest, left.length), 0),
    )
    return pairs.map(([pair, left, right]) => ({
        pair,
        text: clip(`  ${left.padEnd(width)}${" ".repeat(GAP)}${right}`, WIDTH),
    }))
}

// The context table is a single column of values, so it sizes its own label
// column to the labels actually in play rather than borrowing LABEL from the
// per-model block, which is far wider than anything here needs.
const share = (tokens: number, total: number): string =>
    total > 0 ? `${((tokens / total) * 100).toFixed(0)}%` : "—"

// The whole row travels with its line rather than being recovered from a
// parallel array by index, so a row can never end up explaining a neighbouring
// bucket.
type ContextLine = { row: Slice; text: string }

const contextLines = (value: Split): ContextLine[] => {
    const width = value.rows.reduce((widest, row) => Math.max(widest, row.label.length), 0)
    return value.rows.map((row) => ({
        row,
        text: clip(
            `  ${row.label.padEnd(width)}  ${compact(row.tokens).padStart(7)}  ${share(row.tokens, value.total).padStart(5)}`,
            WIDTH,
        ),
    }))
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
    explain: (pair: Pair, model: string) => (event: MouseEvent) => void
    describe: (row: Row) => (event: MouseEvent) => void
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
                        <box
                            flexDirection="row"
                            flexShrink={1}
                            minWidth={0}
                            onMouseDown={props.stop}
                            onMouseUp={props.describe(row)}
                        >
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
                        {statLines(row).map((line) => (
                            <box
                                flexDirection="row"
                                flexShrink={0}
                                onMouseDown={props.stop}
                                onMouseUp={props.explain(line.pair, row.label)}
                            >
                                <text fg={surface.text.muted} wrapMode="none" truncate={true}>{line.text}</text>
                            </box>
                        ))}
                    </box>
                ))}
        </box>
    )
}

// Collapsed headline carries the total and whatever is filling it most, so the
// section only expands when the answer to "what is eating my window" needs more
// than one glance. Expanded, it shows the whole split. Every row is also a
// click target that explains what that category is.
const ContextPanel = (props: {
    split: Split
    surface: Surface
    open: boolean
    toggle: (event: MouseEvent) => void
    stop: (event: MouseEvent) => void
    explain: (row: Slice, total: number) => (event: MouseEvent) => void
}) => {
    // As with Panel, no prop may be read in the body; see the note there.
    const surface = props.surface
    const headline = (): string => {
        const total = compact(props.split.total)
        if (props.split.rows.length === 0) return ` (${total})`
        if (props.open) return ` (${total} · ${props.split.rows.length} parts)`
        const top = props.split.rows[0]
        return ` (${total} · ${top.label} ${compact(top.tokens)})`
    }
    return (
        <box flexDirection="column" gap={0}>
            <box flexDirection="row" flexShrink={0} onMouseDown={props.toggle} onMouseUp={props.stop}>
                <text fg={surface.text.base}>{`${props.open ? "▾" : "▸"} Context`}</text>
                {props.split.total > 0 && <text fg={surface.text.muted}>{headline()}</text>}
            </box>
            {props.open &&
                contextLines(props.split).map((line) => (
                    <box
                        flexDirection="row"
                        flexShrink={0}
                        onMouseDown={props.stop}
                        onMouseUp={props.explain(line.row, props.split.total)}
                    >
                        <text fg={surface.text.muted} wrapMode="none" truncate={true}>{line.text}</text>
                    </box>
                ))}
        </box>
    )
}

export default Plugin.define({
    id: "dotfiles.tokens.tui",
    setup(context) {
        // Both panels start collapsed: each collapsed headline still carries its
        // one headline number, so neither expands without being asked to.
        const [state, setState] = context.storage.memory("panel", {
            initial: { open: false, context: false },
        })

        // One handler for both sections; the storage key decides which one moves.
        const toggle = (key: "open" | "context") => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            setState((draft) => {
                draft[key] = !draft[key]
            })
        }
        const stop = (event: MouseEvent) => event.stopPropagation()

        // Clicking a category opens what that category means. The share goes in
        // the title, because the number the reader is asking about is the one
        // they were already looking at when they asked.
        const explainCategory = (row: Slice, total: number) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            void context.ui.dialog.alert({
                title: `${row.label} · ${share(row.tokens, total)} of context`,
                message: ORIGIN_NOTE[row.origin],
            })
        }

        // Clicking a stat line opens what both of its numbers mean. The model leads
        // the title because a mid-run switch gives the same line to two blocks,
        // and the reader has one of them in front of them.
        const explainPair = (pair: Pair, model: string) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            void context.ui.dialog.alert({
                title: `${model} · ${PAIR_LABEL[pair]}`,
                message: PAIR_NOTE[pair],
            })
        }

        // Clicking a model name opens what opencode knows about the model itself: the
// registry entry behind it, not what this session spent on it. The provider
        // supplies that entry, so the note drops any paragraph the provider did
        // not report instead of showing a blank.
        const describeModel = (row: Row) => (event: MouseEvent) => {
            event.stopPropagation()
            event.preventDefault()
            void context.ui.dialog.alert({
                title: row.label,
                message: modelNote(row),
            })
        }

        const read = (sessionID: string | undefined): Row[] => {
            if (!sessionID) return []
            const messages = context.data.session.message.list(sessionID) ?? []
            const session = context.data.session.get(sessionID)
            const models = context.data.location.model.list(session?.location) ?? []
            const find = (providerID: string, modelID: string) => models.find((model) => matchesModel(model, providerID, modelID))
            const label = (providerID: string, modelID: string, variant: string): string => {
                const entry = record(find(providerID, modelID))
                const base = optional(String(entry.name ?? "")) ?? `${providerID}/${modelID}`
                return variant === "" || variant === "default" ? base : `${base} (${variant})`
            }
            // Attached after the walk, so one lookup serves both the label and
            // the dialog and collect() stays a pure function of the messages.
            return collect(messages, label).map((row) => ({
                ...row,
                info: summary(find(row.providerID, row.modelID)),
            }))
        }

        const readContext = (sessionID: string | undefined): Split => {
            if (!sessionID) return { rows: [], total: 0 }
            return split(context.data.session.message.list(sessionID) ?? [])
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
                    toggle={toggle("open")}
                    stop={stop}
                    explain={explainPair}
                    describe={describeModel}
                />
            ),
        })

        // Registered after Tokens so the section lands directly below it.
        // Several claims can share one slot, and each owns its own disclosure.
        context.ui.slot({
            append: "sidebar.content",
            render: (props) => (
                <ContextPanel
                    split={readContext(props.sessionID)}
                    surface={context.theme}
                    open={state.context}
                    toggle={toggle("context")}
                    stop={stop}
                    explain={explainCategory}
                />
            ),
        })
    },
})
