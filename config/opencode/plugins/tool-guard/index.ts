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
// What this does NOT do:
//
//   - notice a loop where every call *succeeds* but makes no progress
//   - notice a stall with no tool calls at all (a thinking loop, or a hang)
//   - know whether a failure is the agent's fault, the user's, or transient
//
// Those need a progress signal the agent does not currently emit. Treat silence
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

// Exported for testing; opencode only reads the default export.
export type Entry = {
    failures: Failure[]
    // The loop already announced to this session, if any. Identity plus count,
    // because a *different* tool starting its own loop is news: a bare counter
    // would let the first loop silence every later one.
    announced?: { tool: string; message: string; reached: number }
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

            const run = streak(entry, Date.now())
            if (run === undefined) return

            // Announced once per distinct loop, and again only if that same loop
            // grows by another STREAK. That keeps the nudge off every model call
            // without letting the first loop silence a later, different one.
            const already = entry.announced
            if (
                already !== undefined &&
                already.tool === run.tool &&
                already.message === run.message &&
                run.reached <= already.reached
            ) {
                return
            }
            entry.announced = { tool: run.tool, message: run.message, reached: run.reached }

            // System parts, not messages: standing context for this call, not a
            // fabricated turn in the conversation.
            const system = event.system ?? (event.system = [])
            system.push({ type: "text", text: render(run.tool, run.message) })
        })

        return async () => {
            store.clear()
            await Promise.all([toolHook.dispose(), contextHook.dispose()])
        }
    },
})
