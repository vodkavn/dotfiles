import { Plugin } from "@opencode/plugin/tui"
import {
    BAR_WIDTH,
    baseURLs,
    buildPanel,
    connections,
    describeError,
    describeThrown,
    dueProviders,
    refreshText,
    retrySoon,
    TTL_MS,
    usageUrl,
    type Tone,
} from "./panel"
import type { Provider, Usage } from "./providers"

// A **Usage** section in the sidebar: what is left of the provider plans this
// machine is connected to, as a percentage per quota window with the reset
// countdown beside it, or as a money balance for a pay-as-you-go account.
//
// Which providers appear. Only the ones with an active credential — the
// adapters in providers.ts are a superset, and one that is not connected here is
// left out rather than drawn as "not connected". The detected set is the
// intersection of that registry and opencode's connected accounts.
//
// Why this exists. A plan meters by a rolling 5-hour window and a weekly window
// (and, for OpenCode Go, a month), and exposes the current figures only through a
// provider endpoint. Nothing in the TUI shows them, so the first symptom of
// running out is a request that fails. This puts the numbers in permanent
// chrome, next to the work they pay for.
//
// Where the numbers come from. `client.credential.list()` carries the raw
// subscription key for each connected account, so the panel reads the key from
// opencode's own store rather than a second copy on disk, then calls each
// provider directly. The endpoints, their response shapes, and every parse live
// in providers.ts; the host is derived from opencode's own `settings.baseURL`.
//
// What is drawn, and when. A connected provider appears once its first fetch
// lands; one whose fetch fails appears with the reason. Nothing is drawn at all
// until a fetch answers, so the sidebar is not given an empty "Usage" header to
// learn to skip.
//
// Freshness. Answers are cached for TTL_MS and refetched on a timer while the
// TUI is open, plus on a click of the refresh row. Attempt time, not success
// time, gates the timer, so a provider that keeps failing is not retried on
// every repaint. Every list is read inside render(), and the paint is driven by
// a memory-store version counter bumped when a fetch lands — never by capturing
// a value in setup().

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

// How long a provider has to answer before the request is abandoned. Both
// endpoints are small JSON documents behind a CDN; a slow answer is a failing
// one.
const REQUEST_TIMEOUT_MS = 10_000

// The most a provider's answer may be. These are small JSON documents behind
// a CDN, so a megabyte is already generous; anything larger is not the answer
// this panel asked for.
const MAX_BODY_BYTES = 1_000_000

// The body of a response, read with a cap.
//
// response.text() reads whatever the server sends, with no limit, so a server
// that never stops sending is a way to spend the memory it chose. The stream
// is read here instead and abandoned once the cap is passed.
const readBody = async (response: Response): Promise<string> => {
    const declared = Number(response.headers.get("content-length") ?? "")
    if (Number.isFinite(declared) && declared > MAX_BODY_BYTES) {
        throw new Error(`response larger than ${MAX_BODY_BYTES} bytes`)
    }
    const body = response.body
    if (body === null) return await response.text()
    const reader = body.getReader()
    const decoder = new TextDecoder()
    let text = ""
    let total = 0
    try {
        for (;;) {
            const { done, value } = await reader.read()
            if (done) break
            total += value.byteLength
            if (total > MAX_BODY_BYTES) {
                await reader.cancel()
                throw new Error(`response larger than ${MAX_BODY_BYTES} bytes`)
            }
            // stream: true, so a character split across two chunks is not
            // turned into two replacement characters.
            text += decoder.decode(value, { stream: true })
        }
    } finally {
        reader.releaseLock()
    }
    return text + decoder.decode()
}

// opencode.ai sits behind Cloudflare, which answers error 1010 to a request
// carrying no User-Agent at all. Any concrete one is served, so this names the
// caller rather than impersonating a browser.
const USER_AGENT = "opencode-provider-usage"

// The spinner turns only while a fetch is in flight; SPIN_MS is one frame.
const SPIN_MS = 120
const SPIN_FRAMES = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// Reset countdowns and the "updated … ago" stamp age on this clock even when
// nothing is being fetched, so a stale reading is visible as stale.
const HEARTBEAT_MS = 30_000

export default Plugin.define({
    id: "dotfiles.provider-usage.tui",
    setup(context) {
        // The repaint trigger and the collapse flag, in memory storage so both
        // survive a plugin reload and reset when the TUI exits. `version` has
        // no meaning beyond changing when a fetch lands; reading it in render is
        // what subscribes the panel to that change.
        const [state, setState] = context.storage.memory("usage", {
            initial: { collapsed: false, version: 0 },
        })

        // Fetched answers, keyed by provider id, and the last time a fetch was
        // attempted for each. Kept in the closure rather than a store: they are
        // not read reactively, only drawn once the version bump repaints.
        const results = new Map<string, Usage>()
        const attempts = new Map<string, number>()
        const inflight = new Set<string>()
        // The last credential list that answered, so a failed read can be told
        // apart from an honest "nothing connected".
        let credentials: unknown = []

        // Set on unload. A fetch already in flight still settles after the plugin
        // is disposed; writing to a disowned store, or starting a timer from a
        // dead generation, is the leak this guards. Every late continuation
        // checks it, and every timer this generation owns is cleared below.
        let stopped = false

        const bump = () => {
            if (!stopped) setState((draft) => { draft.version++ })
        }

        // What the refresh row needs to show that a click was received: how many
        // fetches are in flight, and when one last finished. Plain closure
        // variables, read only after a bump, so they are not reactive state.
        let busy = 0
        let updatedAt: number | undefined
        let spin: ReturnType<typeof setInterval> | undefined
        // The spinner runs only while busy: an idle pane repainting ten times a
        // second to animate nothing is waste. `bump` is the spinner's frame
        // advance; the glyph itself is derived from the clock in render.
        const animate = () => {
            if (stopped) return
            if (busy > 0 && spin === undefined) {
                spin = setInterval(bump, SPIN_MS)
                ;(spin as { unref?: () => void }).unref?.()
            } else if (busy === 0 && spin !== undefined) {
                clearInterval(spin)
                spin = undefined
            }
        }

        const fetchUsage = async (provider: Provider, key: string, base: string | undefined): Promise<Usage> => {
            const controller = new AbortController()
            const timer = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS)
            try {
                const response = await fetch(usageUrl(provider, base), {
                    headers: {
                        Authorization: `Bearer ${key}`,
                        Accept: "application/json",
                        "User-Agent": USER_AGENT,
                    },
                    signal: controller.signal,
                })
                const body = await readBody(response)
                if (!response.ok) {
                    return { id: provider.id, label: provider.label, error: describeError(body, response.status) }
                }
                return { id: provider.id, label: provider.label, ...provider.parse(body) }
            } finally {
                clearTimeout(timer)
            }
        }

        const load = async (provider: Provider, key: string, base: string | undefined) => {
            // Marked busy and repainted before the first await, so the click that
            // started this fetch is acknowledged immediately rather than when the
            // answer lands. Inside the try so the finally below always pairs the
            // increment, even if the repaint throws.
            busy += 1
            animate()
            try {
                bump()
                const usage: Usage = await fetchUsage(provider, key, base)
                if (!stopped) results.set(provider.id, usage)
            } catch (error) {
                if (!stopped) {
                    results.set(provider.id, { id: provider.id, label: provider.label, error: describeThrown(error) })
                }
            } finally {
                inflight.delete(provider.id)
                busy -= 1
                updatedAt = Date.now()
                animate()
                bump()
            }
        }

        // One refresh pass. The credential list is read once for every provider;
        // a provider with no active key is not fetched and is left out of the
        // section entirely, so only the providers actually connected here are
        // shown -- an unconnected one is not worth a row saying so.
        const refresh = (force: boolean) => {
            if (stopped) return
            const now = Date.now()
            const pending = dueProviders(attempts, now, force)
            if (pending.length === 0) return
            // Stamp before the await so a burst of repaints cannot start a second
            // pass over the same providers. A read that never reached the store
            // rewinds them below rather than spending the whole TTL.
            for (const provider of pending) attempts.set(provider.id, now)
            void (async () => {
                let answered = false
                try {
                    const client = context.client
                    if (client?.credential?.list) {
                        credentials = await client.credential.list()
                        answered = true
                    }
                } catch {
                    answered = false
                }
                // The plugin may have been disposed while the key list was read.
                if (stopped) return
                if (!answered) {
                    // Nothing was asked of any provider, so nothing should be
                    // treated as disconnected: keep the rows on screen and make
                    // these providers due again soon.
                    const soon = retrySoon(now)
                    for (const provider of pending) attempts.set(provider.id, soon)
                    return
                }
                const base = baseURLs(context.data.location.provider.list() ?? [])
                const { ready, absent } = connections(credentials, pending)
                let dropped = false
                for (const id of absent) {
                    // Not connected: draw nothing, and drop a row a previous
                    // connection left behind so it does not linger.
                    if (results.delete(id)) dropped = true
                }
                for (const { provider, key } of ready) {
                    // A provider already fetching is left to the fetch in
                    // flight; the click that forced this pass need not double it.
                    if (inflight.has(provider.id)) continue
                    inflight.add(provider.id)
                    void load(provider, key, base.get(provider.id))
                }
                if (dropped) bump()
            })()
        }

        // opencode's provider records carry the base URL the usage host is
        // derived from; sync them once so the first fetch has one. A store that
        // stays empty is not fatal — usageUrl falls back to the adapter origin.
        void context.data.location.provider.sync().catch(() => {})

        const ink = (tone: Tone) => {
            if (tone === "muted") return context.theme.text.muted
            if (tone === "error") return context.theme.text.feedback.error.base
            if (tone === "warn") return context.theme.text.feedback.warning.base
            if (tone === "ok") return context.theme.text.feedback.success.base
            return context.theme.text.base
        }

        const dispose = context.ui.slot({
            append: "sidebar.content",
            render: () => {
                // Stale-gated, so the first paint fetches and later repaints do
                // not. Reading `state.version` subscribes this render to the
                // bump a landed fetch makes.
                refresh(false)
                void state.version

                const collapsed = state.collapsed
                const lines = buildPanel(results, Date.now(), BAR_WIDTH)
                if (lines.length === 0) return null

                // The collapse toggle acts on the press, the way opencode's own
                // sidebar rows do; the release only stops propagation so the
                // host's own sidebar binding does not also fire.
                const toggle = (event: MouseEvent) => {
                    event.stopPropagation()
                    event.preventDefault()
                    if (!stopped) setState((draft) => { draft.collapsed = !draft.collapsed })
                }
                const hold = (event: MouseEvent) => event.stopPropagation()
                // The refresh acts on the release, so a press-and-drag-away is a
                // natural cancel rather than a refresh.
                const reload = (event: MouseEvent) => {
                    event.stopPropagation()
                    event.preventDefault()
                    refresh(true)
                }

                // What the refresh row says: a spinner while a fetch is in
                // flight, and otherwise the age of the last one in parentheses.
                // The age is what proves a click landed when the quota has not
                // moved.
                const frame = SPIN_FRAMES[Math.floor(Date.now() / SPIN_MS) % SPIN_FRAMES.length]
                const refreshLabel = refreshText(busy > 0, frame, updatedAt, Date.now())

                return (
                    <box flexDirection="column" gap={0}>
                        <box flexDirection="row" onMouseDown={toggle} onMouseUp={hold}>
                            <text>{`${collapsed ? "▶" : "▼"} Usage`}</text>
                        </box>
                        {!collapsed &&
                            lines.map((line, index) => (
                                <box key={index} flexDirection="row">
                                    {line.segments.map((segment, at) => (
                                        <text key={at} fg={ink(segment.tone)}>
                                            {segment.text}
                                        </text>
                                    ))}
                                </box>
                            ))}
                        {!collapsed && (
                            <box flexDirection="row" onMouseDown={hold} onMouseUp={reload}>
                                <text fg={context.theme.text.muted}>{`  ${refreshLabel}`}</text>
                            </box>
                        )}
                    </box>
                )
            },
        })

        // The timers are created last, and only after the slot is registered.
        // If slot registration throws, setup throws and this cleanup is never
        // handed back, so anything started before it would run for the life of
        // the process. `unref` keeps the timers from holding the TUI's event loop
        // open on their own.
        const timer = setInterval(() => refresh(false), TTL_MS)
        const heartbeat = setInterval(() => {
            // Only age the display when something is actually drawn; an empty
            // section has no countdown to tick.
            if (results.size > 0) bump()
        }, HEARTBEAT_MS)
        ;(timer as { unref?: () => void }).unref?.()
        ;(heartbeat as { unref?: () => void }).unref?.()

        return () => {
            stopped = true
            clearInterval(timer)
            clearInterval(heartbeat)
            if (spin !== undefined) clearInterval(spin)
            spin = undefined
            // Drop the closure's references so a disposed generation holds no
            // readings while it waits to be collected.
            results.clear()
            attempts.clear()
            inflight.clear()
            dispose?.()
        }
    },
})
