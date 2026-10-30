import { Plugin } from "@opencode/plugin"

// Stuck-loop guard: notices when the agent is repeating a failing tool call and
// says so, once, in the one place the agent actually reads.
//
// Why this exists. A tool that fails does not end a run. The model sees the
// error, tries again, sees the error, tries a third time. That loop is invisible
// from the outside: the transcript fills with near-identical errors, nothing
// raises, and the session simply stops making progress. opencode's own analytics
// count tool calls and their outcomes but do not act on them.
//
// The nudge is deliberately weak. It adds one line to the system context when a
// tool has failed the same way several times running, and it never blocks,
// because blocking a tool the agent is retrying would remove the very signal
// that would let it recover.
//
// Bounded by construction, which is the whole design constraint here.
//
//   The removed `tokens` plugin leaked because it kept a per-session Map fed by
//   global server events and nothing ever evicted it. So the store below:
//     - caps how many sessions it tracks and evicts the least recently used,
//     - caps the failures kept per session and drops the oldest,
//     - never creates an entry on a read, so a context hook for an unknown
//       session costs nothing rather than allocating.
//   The ceiling is a pair of literals, and a test asserts the *retained count*
//   under a flood of unrelated sessions rather than trusting the code.
//
// A success from a tool clears that tool's failures, so "consecutive" means what
// it should: no success since the first failure. An agent trying three different
// commands and failing at each is exploring, not stuck, and is left alone.
//
// It also notices the loop that never fails: the same tool, the same input, the
// same result, three times running. That is the quiet one -- nothing raises, the
// transcript fills with identical answers, and from outside it looks like work.
// Both the input and the result are hashed into the run key, so "the same answer
// to the same question" is one comparison and the store holds no transcript.
//
// What this does NOT do:
//
//   - notice a loop that keeps making *different* calls without progress: only
//     an identical call is a signal here, because a heuristic over dissimilar
//     calls would fire on every honest exploration
//   - notice a stall with no tool calls at all (a thinking loop, or a hang)
//   - know whether a failure is the agent's fault, the user's, or transient
//
// The first two need a progress signal the agent does not currently emit. Treat silence
// from this plugin as "no loop detected", never as "the agent is fine".

// How many sessions are tracked at once. Past this, the least recently used goes.
export const MAX_SESSIONS = 16
// Failures remembered per session. Past this, the oldest is dropped.
export const MAX_FAILURES = 8
// Same failure this many times in a row before the agent is told.
export const STREAK = 3
// Cap on a retained message: only equality after normalisation matters, so the
// rest of a long message is weight the store never needed to keep.
export const MAX_MESSAGE = 200
// How long a failure still counts. A streak is a live phenomenon; one from an
// hour ago is history, and re-raising it would be noise.
export const FRESH_MS = 10 * 60 * 1000

// Exported for testing; opencode only reads the default export.
export type Failure = { tool: string; message: string; at: number }

// A run of identical calls: the same tool, the same input, the same result, back
// to back. `key` and `result` are hashes rather than the text itself — the store
// must not become a second copy of the transcript, and it must not hold a value
// that secret-guard was asked to mask.
export type Repeat = { key: string; tool: string; result: string; count: number }

// Exported for testing; opencode only reads the default export.
export type Entry = {
    failures: Failure[]
    // The loop already announced to this session, if any. Identity plus count,
    // because a *different* tool starting its own loop is news: a bare counter
    // would let the first loop silence every later one.
    announced?: { tool: string; message: string; reached: number }
    // The current run of identical calls, if the last call completed.
    repeat?: Repeat
    // The repeat loop already announced, and how many multiples of STREAK it had
    // reached when it was said.
    announcedRepeat?: { key: string; reached: number }
}

// opencode wraps the throwable rather than exposing it directly: its own builtin
// plugins read event.error.error, and replace event.error wholesale. Both shapes
// are accepted so this keeps working if either moves.
const reasonOf = (failure: unknown): string => {
    if (failure === undefined || failure === null) return ""
    if (typeof failure !== "object") return String(failure)
    const outer = failure as Record<string, unknown>
    if (typeof outer.message === "string") return outer.message
    const inner = outer.error
    if (inner && typeof inner === "object" && typeof (inner as { message?: unknown }).message === "string") {
        return String((inner as { message: string }).message)
    }
    if (typeof inner === "string") return inner
    return ""
}

// Digits and long runs differ between repeats of the same error -- exit codes,
// durations, offsets, line numbers -- and would otherwise split one streak into
// several. Everything past the first line is dropped for the same reason: the
// stack is not what makes two failures "the same".
export const normalize = (message: string): string =>
    (message.split("\n", 1)[0] ?? "").replace(/\d+/g, "#").trim().slice(0, MAX_MESSAGE)

// --- a loop that keeps succeeding -------------------------------------------
//
// The failure streak above needs a failure. The other loop is quieter: the agent
// calls the same tool with the same input, gets the same answer, and does it
// again. Nothing fails, nothing changes, and from outside it is indistinguishable
// from work. The signal is the repetition itself -- identical input *and*
// identical result -- which is why both are hashed into the run key.

// How much of an input or a result a fingerprint may cover. The store keeps
// hashes, but hashing is linear, and a tool input can carry a whole file.
const MAX_FINGERPRINT = 4_000

// FNV-1a, 32-bit. Not a security hash and not used as one: the only question
// asked of it is whether two runs of text are the same, and a collision costs one
// false "unchanged" against a store that must stay small and must not retain the
// text it was asked to compare.
export const hash = (value: string): string => {
    let state = 0x811c9dc5
    for (let index = 0; index < value.length; index++) {
        state ^= value.charCodeAt(index)
        state = Math.imul(state, 0x01000193) >>> 0
    }
    return state.toString(16)
}

// JSON with its keys in a fixed order, so the same call fingerprints the same way
// whatever order the object was built in. Depth is capped for the same reason
// length is: this runs on every completed tool call.
const stable = (value: unknown, depth = 0): string => {
    if (depth > 4) return "…"
    if (value === null || value === undefined) return "null"
    if (typeof value !== "object") return JSON.stringify(value) ?? String(value)
    if (Array.isArray(value)) return `[${value.map((item) => stable(item, depth + 1)).join(",")}]`
    const entries = Object.entries(value as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
    return `{${entries.map(([key, item]) => `${JSON.stringify(key)}:${stable(item, depth + 1)}`).join(",")}}`
}

// What the model was given, as one string. A content array is joined; a result
// carrying no text at all fingerprints to nothing, which no repeat can match.
export const resultText = (result: unknown): string => {
    const content = (result as { content?: unknown } | undefined)?.content
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return ""
    const parts: string[] = []
    for (const part of content) {
        const entry = part !== null && typeof part === "object" ? (part as Record<string, unknown>) : {}
        if (entry.type === "text" && typeof entry.text === "string") parts.push(entry.text)
    }
    return parts.join("\n")
}

// The identity of one call: the tool and everything it was asked to do.
export const fingerprint = (tool: string, input: unknown): string =>
    hash(`${tool}\u0000${stable(input).slice(0, MAX_FINGERPRINT)}`)

// The result a call produced, reduced to something comparable and non-retaining.
//
// Empty when the result carries no text at all. A result with nothing to compare
// cannot be "the same answer twice", and treating it as one would fire on every
// tool that returns only metadata.
export const resultKey = (result: unknown): string => {
    const text = resultText(result)
    return text === "" ? "" : hash(text.slice(0, MAX_FINGERPRINT))
}

// The nudge for a run of identical calls.
export const renderRepeat = (tool: string, count: number): string =>
    [
        "## Repeated identical tool call",
        "",
        `The \`${tool}\` tool has now returned the same result ${count} times in a row for`,
        "the same input. Nothing has changed since the first call, so repeating it",
        "cannot change anything either.",
        "",
        "The answer is already above, or it needs a different call. Read what you",
        "have, or change the approach -- do not run this one again unchanged.",
    ].join("\n")

// The trailing run of identical failures, if it is recent. Returns the run and
// the multiple of STREAK it has reached, or undefined when there is no streak.
export const streak = (
    entry: Entry,
    now: number,
): { tool: string; message: string; reached: number } | undefined => {
    const failures = entry.failures
    if (failures.length < STREAK) return undefined

    const last = failures[failures.length - 1]
    if (now - last.at > FRESH_MS) return undefined

    let run = 0
    for (let index = failures.length - 1; index >= 0; index--) {
        const failure = failures[index]
        if (failure.tool !== last.tool || failure.message !== last.message) break
        run++
    }
    if (run < STREAK) return undefined

    return { tool: last.tool, message: last.message, reached: Math.floor(run / STREAK) }
}

// Exported for testing; opencode only reads the default export.
export const render = (tool: string, message: string): string =>
    [
        "## Repeated tool failure",
        "",
        `The \`${tool}\` tool has failed ${STREAK}+ times in a row with the same result:`,
        "",
        `    ${message}`,
        "",
        "Something about this call is wrong, and retrying it unchanged will keep",
        "failing. Either change the approach, change the arguments, or stop and",
        "tell the user what is blocking you. Do not retry it a fourth time as-is.",
    ].join("\n")

// Exported for testing; opencode only reads the default export.
// Extracted so the ceiling can be asserted directly rather than inferred from
// behaviour, which is the difference between a test and an assumption.
export const createFailureStore = () => {
    // Insertion-ordered, and record() moves an entry to the end, so the first
    // key is always the least recently used. That is the eviction order.
    const sessions = new Map<string, Entry>()

    const evict = () => {
        while (sessions.size > MAX_SESSIONS) {
            const oldest = sessions.keys().next()
            if (oldest.done) break
            sessions.delete(oldest.value)
        }
    }

    const record = (sessionID: string): Entry => {
        const existing = sessions.get(sessionID)
        sessions.delete(sessionID)
        const entry = existing ?? { failures: [] }
        sessions.set(sessionID, entry)
        // Evict at insertion time, so the ceiling holds now rather than at the
        // moment of some later insert.
        evict()
        return entry
    }

    return {
        record,
        // Deliberately non-creating: the context hook runs on every model call,
        // and allocating an entry for a session with no failures would grow the
        // map for sessions this plugin has nothing to say about.
        peek: (sessionID: string): Entry | undefined => sessions.get(sessionID),
        fail: (sessionID: string, tool: string, message: string): Entry => {
            const entry = record(sessionID)
            entry.failures.push({ tool, message, at: Date.now() })
            if (entry.failures.length > MAX_FAILURES) {
                entry.failures = entry.failures.slice(-MAX_FAILURES)
            }
            return entry
        },
        succeed: (sessionID: string, tool: string): Entry => {
            const entry = record(sessionID)
            // A success ends that tool's streak. Other tools are left alone:
            // interleaved tools are not a loop.
            entry.failures = entry.failures.filter((failure) => failure.tool !== tool)
            if (entry.failures.length === 0) entry.announced = undefined
            return entry
        },
        // Record a completed call, and say how long the current run of identical
        // calls has been. The run is consecutive by construction: a different key
        // or a different result starts a new one at 1.
        repeat: (sessionID: string, key: string, tool: string, result: string): Entry => {
            const entry = record(sessionID)
            const previous = entry.repeat
            const count = previous !== undefined && previous.key === key && previous.result === result ? previous.count + 1 : 1
            entry.repeat = { key, tool, result, count }
            // A new run is a new question, so an earlier announcement no longer
            // applies to it.
            if (count === 1) entry.announcedRepeat = undefined
            return entry
        },
        clear: () => sessions.clear(),
        sessions: () => sessions.size,
        retained: () => {
            let total = 0
            for (const entry of sessions.values()) total += entry.failures.length
            return total
        },
    }
}

export default Plugin.define({
    id: "dotfiles.tool-guard",
    async setup(ctx) {
        const store = createFailureStore()

        const toolHook = await ctx.tool.hook("execute.after", (event) => {
            const sessionID = (event as { sessionID?: unknown }).sessionID
            if (typeof sessionID !== "string" || sessionID === "") return

            const tool = (event as { tool?: unknown }).tool
            if (typeof tool !== "string" || tool === "") return

            // Narrowed on the event itself rather than on a copy of its status:
            // the status is the discriminant, so reading it that way is what
            // gives the error branch its error.
            if (event.status === "completed") {
                store.succeed(sessionID, tool)
                // Tracked on the identical-call run: the input and the result are
                // both hashed, so "the same answer to the same question" is one
                // comparison rather than a retained transcript. A result with no
                // text has nothing to compare and is not counted.
                const result = resultKey(event.result)
                if (result !== "") store.repeat(sessionID, fingerprint(tool, event.input), tool, result)
                return
            }
            if (event.status !== "error") return

            store.fail(sessionID, tool, normalize(reasonOf(event.error)))
        })

        const contextHook = await ctx.session.hook("context", (event) => {
            const sessionID = event.sessionID
            if (!sessionID) return

            const entry = store.peek(sessionID)
            if (entry === undefined) return

            // System parts, not messages: standing context for this call, not a
            // fabricated turn in the conversation.
            const system = event.system ?? (event.system = [])

            const run = streak(entry, Date.now())
            if (run !== undefined) {
                // Announced once per distinct loop, and again only if that same
                // loop grows by another STREAK. That keeps the nudge off every
                // model call without letting the first loop silence a later,
                // different one.
                const already = entry.announced
                const stale =
                    already === undefined ||
                    already.tool !== run.tool ||
                    already.message !== run.message ||
                    run.reached > already.reached
                if (stale) {
                    entry.announced = { tool: run.tool, message: run.message, reached: run.reached }
                    system.push({ type: "text", text: render(run.tool, run.message) })
                }
            }

            // The loop that never fails: the same call, the same answer, again.
            // Same announcement rule -- once per run, and again if the run doubles
            // the threshold -- so a long repeat is not narrated on every call.
            const repeat = entry.repeat
            if (repeat !== undefined && repeat.count >= STREAK) {
                const reached = Math.floor(repeat.count / STREAK)
                const already = entry.announcedRepeat
                if (already === undefined || already.key !== repeat.key || reached > already.reached) {
                    entry.announcedRepeat = { key: repeat.key, reached }
                    system.push({ type: "text", text: renderRepeat(repeat.tool, repeat.count) })
                }
            }
        })

        return async () => {
            store.clear()
            await Promise.all([toolHook.dispose(), contextHook.dispose()])
        }
    },
})
