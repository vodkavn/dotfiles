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
// This complements, and does not replace, the experimental compaction hook: the
// goal here is continuity of intent, not a custom summarizer.

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

        const compactionHook = await ctx.session.hook("compaction", async (event) => {
            const sessionID = event.sessionID
            if (!sessionID) return

            const note = record(await ctx.storage.get(key(sessionID)))
            if (typeof note.task !== "string" || note.task === "") return

            // System parts, not messages: this is standing context for the next
            // model call, not a fabricated turn in the conversation.
            const system = event.system ?? (event.system = [])
            system.push({ type: "text", text: render(note as Note) })
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
                do {
                    const page = await ctx.storage.scan({ prefix: "session/", limit: 200, after })
                    if (stopped) return
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
            clearInterval(prune)
            await Promise.all([promptHook.dispose(), compactionHook.dispose()])
        }
    },
})
