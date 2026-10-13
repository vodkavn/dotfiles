import { Plugin } from "@opencode/plugin"

// Compaction memory: keeps a running note of the session's "why" so it is not
// the first thing lost when opencode compacts.
//
// Compaction summarizes the *transcript*. Everything a summary legitimately
// drops is whatever looked like a side quest: a stated goal, a constraint the
// user typed once, a decision already made and then superseded by more tool
// calls. After a compaction the agent keeps working, but the reason it started
// can be gone, so it re-derives a plan and the user re-explains.
//
// This plugin keeps a small structured note per session — the initial task and
// any files the user explicitly attached — and re-injects it on every
// compaction. The note is derived from prompts only, not from assistant output,
// so it stays small and is not itself compacted away.
//
// Rules that keep it honest:
//   - The task is captured once, on the first prompt, and never rewritten.
//     A compaction summary claiming "the user changed the goal" must not be able
//     to silently overwrite the original ask.
//   - Re-injection is additive system context, so it does not fight the
//     transcript; it is labelled as prior state to respect, not as new work.
//   - State lives in durable plugin storage keyed by session, so it survives a
//     plugin reload and a restart. Old sessions are pruned lazily to keep the
//     store bounded.
//
// How the note reaches the model.
//
// ctx.session.hook("compaction") runs immediately before the summary call, with
// the transcript in event.messages. Putting the note in event.system therefore
// hands it to the summariser, which is what makes the original task survive into
// the summary instead of being summarised away as a side quest. It is a nudge
// to the summariser, not a guarantee: if the summary still drops the task, the
// user still re-explains. The durable copy in storage is what the next prompt
// can fall back on.
//
// This is not a custom summariser — event.result is left unset, so opencode
// performs the compaction itself and this plugin only shapes what it reads.

// Exported for testing; opencode only reads the default export.
export type Note = {
    task: string
    files: string[]
    updated: number
}

const record = (value: unknown): Record<string, unknown> =>
    value && typeof value === "object" ? (value as Record<string, unknown>) : {}

// Exported for testing; opencode only reads the default export.
export const uri = (file: Record<string, unknown>): string => {
    const raw = String(file.uri ?? file.path ?? "")
    // Keep the tail only; a full path in a summary is noise.
    const parts = raw.split("/")
    return parts.length > 2 ? parts.slice(-2).join("/") : raw
}

// Cap the stored note. This is meant to be a reminder, not an archive.
const TASK_LIMIT = 400
const FILES_LIMIT = 20
// Sessions older than this are dropped on the next prompt we touch.
const STALE_MS = 14 * 24 * 60 * 60 * 1000
// Upper bound on pages walked in one prune pass, so a store with more sessions
// than expected costs one pass and resumes on the next tick rather than holding
// storage busy. At 200 per page this covers 20k sessions per pass.
const MAX_PRUNE_PAGES = 100
// How many sessions the pre-compaction warning remembers having warned. Bounded
// for the same reason the tokens plugin leaked: this map is fed by a hook that
// fires for every model call in every session the server sees.
const MAX_WARNED_SESSIONS = 16

// Exported for testing; opencode only reads the default export.
export const render = (note: Note): string =>
    [
        "## Session memory (prior state, not a new request)",
        "",
        "This was captured earlier in this session and may have been dropped from",
        "the conversation summary. Treat it as established context unless the user",
        "has since said otherwise.",
        "",
        `- Original task: ${note.task}`,
        note.files.length > 0 ? `- Files the user attached: ${note.files.join(", ")}` : "",
    ]
        .filter((line) => line !== "")
        .join("\n")

// Exported for testing; opencode only reads the default export.
// Said once per compaction, after the fact: the transcript is already a summary,
// so the point is to change what the agent does from here on, not to restore
// what is gone.
export const renderWarning = (compactions: number, messages: number): string =>
    [
        "## This session has been compacted",
        "",
        `The transcript above is a summary of ${compactions} summarisation${compactions === 1 ? "" : "s"} so far,`,
        `and it now holds ${messages} messages. Anything decided before the first compaction that`,
        "was not written into the transcript is gone, and will not be recovered.",
        "",
        "So from here, write decisions down as you make them, in the transcript",
        "itself: what you chose, and what you ruled out and why. A short written",
        "note survives the next compaction; something you merely concluded does not.",
    ].join("\n")

export default Plugin.define({
    id: "dotfiles.compaction-memory",
    async setup(ctx) {
        const key = (sessionID: string) => `session/${sessionID}`

        const promptHook = await ctx.session.hook("prompt", async (event) => {
            const sessionID = event.sessionID
            if (!sessionID) return

            const existing = record(await ctx.storage.get(key(sessionID)))
            const files = [...(Array.isArray(existing.files) ? existing.files : [])]

            for (const file of event.prompt?.files ?? []) {
                const name = uri(record(file))
                if (name && !files.includes(name)) files.push(name)
            }

            // Capture the task once. Later prompts update attachments only.
            const task =
                typeof existing.task === "string" && existing.task !== ""
                    ? existing.task
                    : String(event.prompt?.text ?? "").trim().slice(0, TASK_LIMIT)

            await ctx.storage.set(key(sessionID), {
                task,
                files: files.slice(0, FILES_LIMIT),
                updated: Date.now(),
            } satisfies Note)
        })

        // A session that has already been compacted has demonstrably lost detail
        // once. From that point on the agent is reasoning over a summary, and
        // anything it decided but did not write down is gone. This says so once
        // per compaction, which is the earliest honest moment to say it.
        //
        // The trigger is the count of compaction markers already in the
        // transcript, not a token estimate. Tokens would be a guess about a
        // number no hook here is given; a compaction marker is a fact.
        //
        // State is a capped map, not a durable one: this only needs to remember
        // what it last said in this process, and must not grow with the number
        // of sessions a long-lived server sees.
        const warned = new Map<string, number>()

        const warnHook = await ctx.session.hook("context", (event) => {
            const sessionID = event.sessionID
            if (!sessionID) return

            let compactions = 0
            for (const message of event.messages ?? []) {
                if (record(message).type === "compaction") compactions++
            }
            // Nothing has been lost yet, so there is nothing true to say.
            if (compactions === 0) return
            if (warned.get(sessionID) === compactions) return

            // Re-insert to move to the end, so the oldest is the first key.
            warned.delete(sessionID)
            warned.set(sessionID, compactions)
            while (warned.size > MAX_WARNED_SESSIONS) {
                const oldest = warned.keys().next()
                if (oldest.done) break
                warned.delete(oldest.value)
            }

            const system = event.system ?? (event.system = [])
            system.push({ type: "text", text: renderWarning(compactions, (event.messages ?? []).length) })
        })

        const compactionHook = await ctx.session.hook("compaction", async (event) => {
            const sessionID = event.sessionID
            if (!sessionID) return

            // Storage is durable and shared across plugin versions, so the note
            // is re-validated here rather than trusted. The prompt hook above
            // guards its own read the same way; without this a note whose
            // "files" is not an array makes render() throw mid-compaction.
            const stored = record(await ctx.storage.get(key(sessionID)))
            if (typeof stored.task !== "string" || stored.task === "") return
            const note: Note = {
                task: stored.task,
                files: (Array.isArray(stored.files) ? stored.files : []).map(String).slice(0, FILES_LIMIT),
                updated: typeof stored.updated === "number" ? stored.updated : 0,
            }

            // System parts, not messages: this is standing context for the next
            // model call, not a fabricated turn in the conversation.
            const system = event.system ?? (event.system = [])
            system.push({ type: "text", text: render(note) })
        })

        // Lazy prune so a long-lived server does not accumulate notes forever.
        let stopped = false
        let pruning = false
        const prune = setInterval(() => {
            if (stopped || pruning) return
            pruning = true
            void (async () => {
                const cutoff = Date.now() - STALE_MS
                let after: string | undefined
                let pages = 0
                do {
                    const page = await ctx.storage.scan({ prefix: "session/", limit: 200, after })
                    if (stopped) return

                    // The loop is driven by the store's own cursor, so a cursor
                    // that fails to advance would spin here forever -- inside a
                    // timer, in a long-lived daemon, hammering storage. A real
                    // ordered store always moves forward, but "always" is a
                    // property worth not depending on for termination. Bailing
                    // costs nothing: the next tick restarts the scan.
                    //
                    // Only from the second page. On the first pass `after` is
                    // undefined, and a store holding everything in one page also
                    // reports next as undefined -- so comparing them would match
                    // and abort before a single note was examined, which is the
                    // common case and the one that most needs pruning.
                    if (++pages > MAX_PRUNE_PAGES) return
                    if (pages > 1 && page.next === after) return

                    for (const entry of page.entries) {
                        if (stopped) return
                        const note = record(entry.value)
                        if (typeof note.updated === "number" && note.updated < cutoff) {
                            await ctx.storage.remove(entry.key)
                        }
                    }
                    after = page.next
                } while (after !== undefined && !stopped)
            })().catch(() => {}).finally(() => { pruning = false })
        }, 6 * 60 * 60 * 1000)
        // unref exists on Bun's Timer but not under a DOM/ES lib, where this
        // handle types as a number. The optional call keeps the interval from
        // holding the process open without needing either runtime's types.
        ;(prune as { unref?: () => void }).unref?.()

        return async () => {
            stopped = true
            warned.clear()
            clearInterval(prune)
            await Promise.all([promptHook.dispose(), compactionHook.dispose(), warnHook.dispose()])
        }
    },
})
