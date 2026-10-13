import { Plugin } from "@opencode/plugin/tui"

// How close the session is to needing a compaction.
//
// Derived the way opencode derives its own figure: the last assistant message
// carries `tokens.total` for the call it made, and the model carries
// `limit.context`. Neither is an estimate, so this is a real percentage and not a
// guess at one. Messages without a modelID, and models without a limit, simply
// yield no percentage rather than a fabricated one.
const contextPercent = (messages: readonly unknown[]): number | undefined => {
    let latest: Record<string, unknown> | undefined
    for (const message of messages) {
        if (record(message).role !== "assistant") continue
        latest = record(message)
    }
    if (latest === undefined) return undefined

    const total = record(record(latest.tokens).total)
    if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return undefined

    const providerID = latest.providerID
    const modelID = latest.modelID
    if (typeof providerID !== "string" || typeof modelID !== "string") return undefined

    return { total, providerID, modelID }
}

// Session vitals: what the running session is spending, how close it is to a
// compaction, and what it is blocked on -- none of which the transcript shows.
//
//   context    The user cannot see context filling up, so a session that suddenly
//              forgets detail after a compaction looks arbitrary. The percentage
//              is derived from the last assistant message's tokens.total against
//              the model's limit.context, which is how opencode derives its own.
//
//   subagents  Delegation is invisible from the sidebar. A subagent runs as a
//              session of its own, so its messages never appear in the one on
//              screen, and a long-running one looks exactly like a hang.
//
//              Only *live* ones are listed. A subagent that has finished is
//              history, already visible in the session list, and reporting "3
//              subagents" after the fact says nothing the user can act on. What
//              is worth a line is which one is running, doing what, and for how
//              long -- and a retry is worth more still, because a subagent
//              stuck retrying is the stuck-loop case tool-guard watches for.
//
//              Cost is deliberately absent: session.cost() returns a currency
//              figure, not tokens, and there is no documented way to reach a
//              child session's token total without reading its whole message
//              list. A number with the wrong unit is worse than no number.
//
//   waiting    Permission prompts block the agent until you answer them, and
//              nothing in the UI says one is outstanding. This counts them.
//
// Why this is not a denial log. opencode does not tell plugins about configured
// denies: the permission hook is documented as firing for `allow` and `ask` only,
// because "an explicit configured deny is final and does not invoke the hook".
// So there is no honest way to record which rule refused a command. What there
// *is* to record is the prompt you are being asked to answer right now, which is
// the friction you can actually do something about.
//
// Everything here is a read. No value is accumulated: each figure comes from the
// stores on this render, and the one cache holds a single session key.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

type Child = { id: string; agent: string; kind: "busy" | "retry"; detail: string; startedAt: number }

// How long something has been going, at the coarsest unit that still says
// something. Sub-second is noise; hours mean it is stuck, not slow.
const elapsed = (since: number, now: number): string => {
    if (since <= 0) return ""
    // Capped, and coarse once it passes an hour: a subagent that has been
    // running that long is stuck, not slow, and "2h+" says that in four
    // characters where "2h 14m" reads like a duration worth planning around.
    const seconds = Math.max(0, Math.min(Math.round((now - since) / 1000), 7200))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return minutes < 120 ? "1h+" : "2h+"
}

// 1234567 -> "1.2M", 15000 -> "15k".
const compact = (value: number): string => {
    if (!Number.isFinite(value) || value <= 0) return ""
    if (value < 1000) return String(Math.round(value))
    if (value < 1_000_000) return `${Math.round(value / 1000)}k`
    return `${(value / 1_000_000).toFixed(1)}M`
}

export default Plugin.define({
    id: "dotfiles.session-vitals.tui",
    setup(context) {
        // Only the three expensive, one-shot-per-session reads are cached, like
        // the inspector's registry sync. A child's *status* is deliberately not
        // cached: it is a local store read, and caching it would freeze the panel
        // showing "running" long after the subagent finished -- which is the bug
        // this replaces.
        let synced = ""
        let family: readonly string[] = []
        let used: number | undefined
        let limit: number | undefined
        let waiting = 0

        const refresh = (sessionID: string | undefined) => {
            if (sessionID === undefined) {
                family = []
                used = undefined
                limit = undefined
                waiting = 0
                return
            }
            if (sessionID === synced) return
            synced = sessionID

            // A store that has not caught up is normal on a cold server, and the
            // docs say a first query can come back empty. Swallowing the failure
            // shows nothing rather than taking the TUI down over a count.
            void (async () => {
                const ids = context.data.session.family(sessionID)
                family = Array.isArray(ids) ? ids.filter((id) => id !== sessionID) : []

                const latest = contextPercent(context.data.session.message.list(sessionID) ?? [])
                used = latest?.total
                limit = undefined
                if (latest !== undefined) {
                    const session = context.data.session.get(sessionID)
                    const models = context.data.location.model.list(session?.location) ?? []
                    for (const model of models) {
                        const entry = record(model)
                        if (entry.providerID !== latest.providerID || entry.id !== latest.modelID) continue
                        const found = record(record(entry.limit).context)
                        if (typeof found === "number" && found > 0) limit = found
                    }
                }

                await context.data.session.permission.sync(sessionID)
                waiting = context.data.session.permission.list(sessionID)?.length ?? 0
            })().catch(() => {})
        }

        // Read fresh every render: a subagent that starts or finishes has to
        // show up and disappear without the user switching sessions.
        const live = (): Child[] => {
            const out: Child[] = []
            for (const id of family) {
                const status = record(context.data.session.status(id))
                // idle means finished, which is not news.
                if (status.type === undefined || status.type === "idle") continue
                const info = record(context.data.session.get(id))
                const started = record(record(info.time).created)
                out.push({
                    id,
                    agent: typeof info.agent === "string" && info.agent !== "" ? info.agent : "agent",
                    kind: status.type === "retry" ? "retry" : "busy",
                    detail: status.type === "retry" ? String(status.message ?? "") : "",
                    startedAt: typeof started === "number" ? started : 0,
                })
            }
            return out
        }

        // The comment about the empty case lives here rather than inside the JSX
        // below: opencode's transform can compile a comment inside a JSX
        // expression into a text node and fail the whole region with
        // "Orphan text error".
        return context.ui.slot({
            append: "sidebar.content",
            render: (current) => {
                refresh(current.sessionID)
                const children = live()

                const ratio = used !== undefined && limit !== undefined ? used / limit : undefined
                const percent = ratio === undefined ? undefined : Math.min(100, Math.round(ratio * 100))

                // Nothing to say is nothing to draw. A permanent "0 subagents"
                // row would only teach the eye to skip the section, which is the
                // opposite of what it is for.
                if (children.length === 0 && waiting === 0 && percent === undefined) return null

                const muted = context.theme.text.muted
                const warn = context.theme.text.feedback.warning.base
                const now = Date.now()
                // Warn before the compaction, not after it: compaction-memory's
                // warning is too late to be useful on its own.
                const contextTone = percent !== undefined && percent >= 85 ? warn : muted

                return (
                    <box flexDirection="column" gap={0}>
                        {percent !== undefined && (
                            <box flexDirection="column">
                                <box flexDirection="row">
                                    <text fg={contextTone}>{`  ${percent}% context`}</text>
                                    <text fg={muted}>{` · ${compact(used ?? 0)} of ${compact(limit ?? 0)}`}</text>
                                </box>
                            </box>
                        )}
                        {children.map((child) => {
                            const age = elapsed(child.startedAt, now)
                            const retrying = child.kind === "retry"
                            return (
                                <box key={child.id} flexDirection="column">
                                    <box flexDirection="row">
                                        <text fg={retrying ? warn : muted}>
                                            {`  ${retrying ? "retrying" : "running"} · ${child.agent}`}
                                        </text>
                                        {age !== "" && <text fg={muted}>{` · ${age}`}</text>}
                                    </box>
                                    {/* The retry reason is the whole point of
                                        noticing it, so it gets its own line when
                                        it says something. */}
                                    {retrying && child.detail !== "" && (
                                        <box flexDirection="column">
                                            <text fg={muted}>{`    ${child.detail.slice(0, 60)}`}</text>
                                        </box>
                                    )}
                                </box>
                            )
                        })}
                        {waiting > 0 && (
                            <box flexDirection="column">
                                <box flexDirection="row" onMouseDown={(e: MouseEvent) => e.stopPropagation()}>
                                    <text fg={warn}>{`  ${waiting} permission ${waiting === 1 ? "prompt" : "prompts"} waiting`}</text>
                                </box>
                            </box>
                        )}
                    </box>
                )
            },
        })
    },
})
