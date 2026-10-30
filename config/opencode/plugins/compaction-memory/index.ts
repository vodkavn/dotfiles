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
// It is published as a session instruction entry, keyed per session. The host
// keeps that entry across compaction and reverts, adds it as a small update at
// the next step rather than editing the system prompt, and does not start an
// extra model turn -- so the note does not have to be carried by the summary if
// it survives the summary.
//
// ctx.session.hook("compaction") is the fallback, not the route. It runs
// immediately before the summary call with the transcript in event.messages, so
// putting the note in event.system hands it to the summariser -- which is what
// makes the original task land in the summary instead of being summarised away
// as a side quest. That is where the note goes when the entry is missing, which
// is a failure the documented behaviour does not cover: the fallback is additive,
// so the worst case is the note appearing twice rather than not at all.
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
// Upper bound on the notes one pass removes. The walk is bounded by the page
// count, but the removals were not: a store holding thousands of stale notes
// spent the whole pass removing them one at a time, which is a long run of
// writes for a background chore. The rest is left for the next tick.
const MAX_PRUNE_REMOVALS = 500
// How many sessions the pre-compaction warning remembers having warned. Bounded
// for the same reason the tokens plugin leaked: this map is fed by a hook that
// fires for every model call in every session the server sees.
const MAX_WARNED_SESSIONS = 16

// The key the note is delivered under. Lowercase letters, dots and dashes only,
// which is the shape opencode accepts for a session instruction entry.
const ENTRY = "dotfiles.session-memory"

// Whether two file lists name the same files in the same order. Used to decide
// whether the note has changed enough to be worth publishing again.
const sameFiles = (a: readonly string[], b: readonly string[]): boolean =>
    a.length === b.length && a.every((name, index) => name === b[index])

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

        // Publish the note as a session instruction entry.
        //
        // A failed write is not fatal, and is not rethrown: the compaction hook
        // below falls back to the system text when the entry is not there, so
        // the note is delivered either way. Throwing here would fail the prompt
        // that happened to be the first one in the session.
        const publish = async (sessionID: string, text: string) => {
            try {
                await ctx.session.instructions.entry.put({ sessionID, key: ENTRY, value: text })
            } catch {
                // Left to the fallback.
            }
        }

        // Whether the note's entry is still attached to the session.
        //
        // A list that cannot be read is treated as "not there": the fallback is
        // additive, so the cost of being wrong in that direction is the note
        // appearing twice, and the cost of the other direction is losing the ask.
        const present = async (sessionID: string): Promise<boolean> => {
            try {
                const entries = await ctx.session.instructions.entry.list({ sessionID })
                return entries.some((entry) => entry.key === ENTRY)
            } catch {
                return false
            }
        }

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

            const kept = files.slice(0, FILES_LIMIT)
            const previous = Array.isArray(existing.files) ? existing.files.map(String) : []
            const note: Note = { task, files: kept, updated: Date.now() }

            await ctx.storage.set(key(sessionID), note)

            // Only when it changed. A put on every prompt would add an update to
            // every turn for text that has not moved, which is the cost the
            // entry mechanism exists to avoid.
            const changed = task !== existing.task || !sameFiles(previous, kept)
            if (changed && task !== "") await publish(sessionID, render(note))
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

            // The note is normally already standing context: it was published as
            // a session instruction entry on the prompt that captured it, and the
            // host keeps that entry across the compaction. There is nothing to
            // add in that case, and adding nothing is the point -- a note that
            // survives the summary does not have to be carried by it.
            if (await present(sessionID)) return

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
                let removed = 0
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
                        // The pass is bounded by what it removes as well as by
                        // what it walks: the next tick picks up where this
                        // one stopped.
                        if (removed >= MAX_PRUNE_REMOVALS) return
                        const note = record(entry.value)
                        if (typeof note.updated === "number" && note.updated < cutoff) {
                            await ctx.storage.remove(entry.key)
                            removed++
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
