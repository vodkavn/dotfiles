import {
    PROVIDERS,
    clampPct,
    record,
    type Credit,
    type Provider,
    type Usage,
    type Window,
} from "./providers"

// Presentation and freshness for the provider-usage panel.
//
// The provider adapters — endpoints, parsers, and what counts as a window or a
// credit — live in ./providers.ts, the only file that names a provider. This
// file turns their readings into rows and decides when to refetch; it never
// names a provider itself.
//
// Everything a row decides lives here rather than in tui.tsx: JSX needs
// opencode's transform and node cannot execute it, so the formatting, the tone
// a window wears, and the freshness policy are kept in a plain module that
// tests/plugin-usage.test.mjs loads and calls directly.

export type Tone = "label" | "normal" | "muted" | "warn" | "error" | "ok"

export type Segment = { readonly text: string; readonly tone: Tone }

// A row is one or more coloured segments. Only a window's bar carries a
// severity tone; its label, percentage and countdown stay in the body colour,
// so the colour reads as the gauge rather than tinting the whole row.
export type Line = { readonly segments: readonly Segment[] }

// The usage URL for one provider, given opencode's base URL for it.
//
// The host is the one thing that decides where the provider's raw credential
// goes, so it is not taken on trust from opencode's `settings.baseURL`.
// That field is project configuration: a repository's own opencode.json can
// set it, and a repository is not trusted the way a provider is. A host this
// repository has not vouched for is refused, and the adapter's own origin is
// used instead -- the request then fails, which is the correct outcome for a
// key that was never going to be read by the provider anyway.
//
// The path always comes from the adapter, so a base URL can move the endpoint
// between the provider's own regions (`api.minimax.io` and `api.minimaxi.com`
// share one declaration) without changing what is asked for.
export function usageUrl(provider: Provider, baseURL: string | undefined): string {
    if (typeof baseURL === "string" && baseURL !== "") {
        try {
            const candidate = new URL(baseURL)
            // https only, and a host the adapter vouches for. A key sent over
            // plain http, or to a host nobody checked, is a key handed out.
            if (candidate.protocol === "https:" && provider.hosts.includes(candidate.hostname.toLowerCase())) {
                return new URL(provider.path, candidate.origin).toString()
            }
        } catch {
            // A malformed base URL is not worth failing the panel over.
        }
    }
    return new URL(provider.path, provider.origin).toString()
}

// The base URL opencode reports for each provider, keyed by both its id and its
// integration id, because the two are equal today but need not stay so.
export function baseURLs(providers: readonly unknown[]): Map<string, string> {
    const map = new Map<string, string>()
    for (const entry of providers) {
        const row = record(entry)
        const base = record(row.settings).baseURL
        if (typeof base !== "string" || base === "") continue
        if (typeof row.integrationID === "string") map.set(row.integrationID, base)
        if (typeof row.id === "string") map.set(row.id, base)
    }
    return map
}

// A credit balance as money. USD gets its symbol; anything else is spelled out,
// because a bare number under a currency the panel cannot draw is a guess.
export function money(credit: Credit): string {
    const symbol = credit.currency === "USD" ? "$" : `${credit.currency} `
    return `${symbol}${credit.amount.toFixed(2)}`
}

// opencode's credential store as `client.credential.list()` returns it: one
// entry per connected account, each carrying the raw key. Take the active key
// for one integration; an oauth or inactive connection is not something a
// bearer call can use, so it is not a fallback.
export function selectCredential(entries: unknown, integrationID: string): string | undefined {
    const rows = Array.isArray(entries)
        ? entries
        : Array.isArray(record(entries).data)
          ? (record(entries).data as unknown[])
          : []
    for (const entry of rows) {
        const row = record(entry)
        if (row.integrationID !== integrationID || row.active !== true) continue
        const value = record(row.value)
        if (value.type === "key" && typeof value.key === "string" && value.key !== "") return value.key
    }
    return undefined
}

export type Connection = { readonly provider: Provider; readonly key: string }

// Split providers by whether opencode holds an active key for them. `absent`
// names the ones not connected here, so the caller can drop any row a previous
// connection left behind. The key comes back with its provider so the lookup
// happens once. This is the rule that keeps the section to connected providers
// only: the adapter registry is a superset.
export function connections(
    credentials: unknown,
    providers: readonly Provider[],
): { readonly ready: readonly Connection[]; readonly absent: readonly string[] } {
    const ready: Connection[] = []
    const absent: string[] = []
    for (const provider of providers) {
        const key = selectCredential(credentials, provider.id)
        if (key === undefined) absent.push(provider.id)
        else ready.push({ provider, key })
    }
    return { ready, absent }
}

// A non-2xx body is usually a JSON error document. Surface its message when it
// has one — Cloudflare and the Go route both put the useful text in a field —
// and fall back to the status line otherwise.
export function describeError(body: string, status: number): string {
    let data: unknown
    try {
        data = JSON.parse(body)
    } catch {
        return `HTTP ${status}`
    }
    const row = record(data)
    for (const key of ["message", "error", "detail", "title", "status_msg"]) {
        const value = row[key]
        if (typeof value === "string" && value !== "") return value
    }
    return `HTTP ${status}`
}

export const describeThrown = (error: unknown): string =>
    error instanceof Error && error.message !== "" ? error.message : String(error)

// How long a fetched answer is trusted before the panel refetches it on its own.
//
// Also the auto-refresh period: tui.tsx runs its timer at this interval and
// refetches whatever has lapsed, so the two are equal by construction rather
// than by two constants agreeing. Five minutes keeps a quota reading current
// without spending a request per provider every couple of minutes.
export const TTL_MS = 300_000

// Whether a fetch last attempted at `at` is old enough to try again. Attempt
// time, not success time: a provider that keeps failing would otherwise be
// retried on every repaint.
export const stale = (at: number | undefined, now: number): boolean =>
    at === undefined || now - at >= TTL_MS

// How soon a provider becomes due again after a refresh pass that never reached
// the network — a credential store that did not answer. Short, because nothing
// was actually attempted, but not zero, so a burst of repaints cannot become a
// burst of credential reads.
export const CREDENTIAL_RETRY_MS = 5_000

// The attempt stamp that makes a provider due again after CREDENTIAL_RETRY_MS:
// stale(at, now) is `now - at >= TTL_MS`, so backing the stamp off by the
// difference is what schedules the sooner retry.
export const retrySoon = (now: number): number => now - (TTL_MS - CREDENTIAL_RETRY_MS)

// The providers a refresh pass should fetch: all of them when forced, the
// lapsed ones otherwise. Living here keeps the render free of a decision.
export const dueProviders = (attempts: ReadonlyMap<string, number>, now: number, force: boolean): Provider[] =>
    PROVIDERS.filter((provider) => force || stale(attempts.get(provider.id), now))

// Width of the window-label field, in cells: wide enough for the longest label
// ("monthly"). Fixed rather than measured from the rows in hand, so every bar
// starts in one column even as the providers arrive one at a time.
export const LABEL_WIDTH = 7

// Width of the remaining-quota bar, in cells. Ten cells put one cell at about
// ten percent, which is what makes the length readable at a glance.
export const BAR_WIDTH = 10

export function bar(remaining: number, width: number): string {
    const filled = Math.round((clampPct(remaining) / 100) * width)
    return "█".repeat(filled) + "·".repeat(Math.max(0, width - filled))
}

const MINUTE_MS = 60_000
const HOUR_MS = 3_600_000
const DAY_MS = 86_400_000

const UNITS: readonly (readonly [string, number])[] = [
    ["d", DAY_MS],
    ["h", HOUR_MS],
    ["m", MINUTE_MS],
]

// A reset instant as a compact countdown: "1h28m", "22h", "4d", "now". At most
// two units, so a monthly window does not widen the row past the sidebar.
export function resetText(resetsAt: number | undefined, now: number): string {
    if (resetsAt === undefined) return ""
    const left = resetsAt - now
    if (!Number.isFinite(left)) return ""
    if (left <= 0) return "now"
    const parts: string[] = []
    let rest = left
    for (const [unit, size] of UNITS) {
        const count = Math.floor(rest / size)
        if (count > 0) {
            parts.push(`${count}${unit}`)
            rest -= count * size
        }
        if (parts.length === 2) break
    }
    return parts.join("") || "now"
}

// A completed-fetch instant as a compact age: "now", "3m", "2h", "1d". One
// unit only — the age is a hint that a refresh landed, not a measurement, and
// it is what makes a no-change refresh visible on the row.
export function elapsed(at: number | undefined, now: number): string {
    if (at === undefined) return ""
    const ago = now - at
    if (!Number.isFinite(ago) || ago < 0) return ""
    if (ago < MINUTE_MS) return "now"
    if (ago < HOUR_MS) return `${Math.round(ago / MINUTE_MS)}m`
    if (ago < DAY_MS) return `${Math.round(ago / HOUR_MS)}h`
    return `${Math.round(ago / DAY_MS)}d`
}

// The refresh row's text: a spinner while a fetch is in flight, otherwise the
// age of the last one in parentheses. Built here rather than in the JSX because
// "now" is an age, not a duration, and appending "ago" to it reads as "now ago";
// a fresh age therefore reads "(recent)" instead.
export function refreshText(fetching: boolean, frame: string, at: number | undefined, now: number): string {
    if (fetching) return `${frame} refreshing…`
    const age = elapsed(at, now)
    if (age === "") return "⟳ refresh"
    return age === "now" ? "⟳ refresh (recent)" : `⟳ refresh (${age} ago)`
}

// Colour by how close a window is to empty. A bar alone reads too flat at a
// glance; the tone is what makes a nearly-spent allowance visible.
export const toneFor = (window: Window): Tone =>
    window.status === "exhausted" || window.remaining <= 15
        ? "error"
        : window.remaining <= 30
          ? "warn"
          : "normal"

// The panel body, in provider order. A provider with no result yet is left out
// entirely rather than drawn as a placeholder: the section appears once the
// first fetch lands, and the fetches usually land together. A provider that
// failed is drawn, because a silent absence reads as "not connected".
export function buildPanel(usages: ReadonlyMap<string, Usage>, now: number, barWidth: number): Line[] {
    const lines: Line[] = []
    for (const provider of PROVIDERS) {
        const usage = usages.get(provider.id)
        if (usage === undefined) continue
        lines.push({ segments: [{ text: provider.label, tone: "label" }] })
        if ("error" in usage) {
            lines.push({ segments: [{ text: `  ${usage.error}`, tone: "error" }] })
            continue
        }
        if (usage.kind === "credit") {
            lines.push({ segments: [{ text: `  ${money(usage.credit)}`, tone: "normal" }] })
            continue
        }
        for (const window of usage.windows) {
            const percent = `${String(window.remaining).padStart(3, " ")}%`
            const reset = resetText(window.resetsAt, now)
            lines.push({
                segments: [
                    { text: `  ${window.label.padEnd(LABEL_WIDTH, " ")} `, tone: "normal" },
                    { text: bar(window.remaining, barWidth), tone: toneFor(window) },
                    { text: ` ${percent}${reset === "" ? "" : `  ${reset}`}`, tone: "normal" },
                ],
            })
        }
    }
    return lines
}
