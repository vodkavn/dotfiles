// Provider adapters: what to call, where, and how to read the answer.
//
// This is the only file that names a provider. panel.ts holds the presentation
// and the freshness policy on top of it and never mentions a provider itself,
// so adding one is an edit to this file alone.
//
// Each entry is matched to opencode's stored credential by integration id and
// declares only a path and a parser. The host comes from the provider's own
// `settings.baseURL` in opencode (see panel.ts's usageUrl), so a region variant
// or a proxy needs no second declaration; `origin` is the fallback for a
// provider opencode does not report.
//
// Two response shapes are supported today:
//
//   windows   a subscription plan that meters by rolling windows and reports a
//             remaining or used percentage per window (MiniMax, OpenCode Go)
//   credit    a pay-as-you-go account that holds a money balance (DeepSeek)
//
// Every route is first-party but not stable API surface. The Go route is
// namespaced `zen/` yet reads the Go ("lite") subscription table and answers
// 403 for a workspace without one. Each field is therefore read defensively and
// a window that does not decode is skipped rather than allowed to fail the
// panel.
//
// Shapes verified against live responses on 2026-10-15, not inferred:
//
//   MiniMax   {"model_remains":[{"model_name":"general",
//             "current_interval_remaining_percent":83,"current_weekly_remaining_percent":53,
//             "end_time":<ms>,"weekly_end_time":<ms>, ...}],"base_resp":{"status_code":0}}
//   Go        {"usage":{"rolling":{"status":"ok","percent":4,"resetsAt":"<iso>"},
//             "weekly":{...},"monthly":{...}}}
//   DeepSeek  {"is_available":true,"balance_infos":[{"currency":"USD",
//             "total_balance":"1.52", ...}]}
//
// MiniMax reports the percent *remaining*, Go the percent *used*, and DeepSeek a
// balance inside a string; each quirk is handled by its own parser below.

export type Window = {
    readonly label: string
    /** Percent of the window left, 0-100. */
    readonly remaining: number
    /** Epoch milliseconds of the reset, where the provider reports one. */
    readonly resetsAt?: number
    readonly status: "ok" | "exhausted" | "unlimited" | "unknown"
}

export type Credit = { readonly amount: number; readonly currency: string }

// What a provider reports: a set of percent windows, or a single credit
// balance, because the two families of endpoint differ — a subscription plan
// meters by windows, a pay-as-you-go account holds a balance.
export type Reading =
    | { readonly kind: "windows"; readonly windows: readonly Window[] }
    | { readonly kind: "credit"; readonly credit: Credit }

export type Usage =
    | ({ readonly id: string; readonly label: string } & Reading)
    | { readonly id: string; readonly label: string; readonly error: string }

export type Provider = {
    /** The integration id opencode stores the credential under. */
    readonly id: string
    readonly label: string
    /** The usage path, appended to the provider's origin. */
    readonly path: string
    /** The origin used when opencode reports no base URL for the provider. */
    readonly origin: string
    /**
     * The hosts this provider's usage endpoint may be reached on.
     *
     * The panel sends the provider's raw credential to whatever host it ends
     * up calling, so the host has to be one this file vouches for. opencode's
     * own `settings.baseURL` is *not* that: a project's own opencode.json can
     * set it, and a repository is not trusted the way a provider is.
     */
    readonly hosts: readonly string[]
    /** The reading, or a thrown Error when the body does not decode. */
    readonly parse: (body: string) => Reading
}

export const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

const num = (value: unknown): number | undefined =>
    typeof value === "number" && Number.isFinite(value) ? value : undefined

// A percent that survives a provider sending a fraction, a negative, or 101.
export const clampPct = (value: number): number => Math.max(0, Math.min(100, Math.round(value)))

// MiniMax's `current_*_status`: 1 normal, 2 exhausted, 3 unlimited.
const mmStatus = (value: unknown): Window["status"] =>
    value === 1 ? "ok" : value === 2 ? "exhausted" : value === 3 ? "unlimited" : "unknown"

export function parseMinimax(body: string): Window[] {
    const data = record(JSON.parse(body))

    // MiniMax answers HTTP 200 even for a rejected key, so base_resp is the
    // real success signal rather than the status line.
    const base = record(data.base_resp)
    const code = num(base.status_code)
    if (code !== undefined && code !== 0) {
        const message = base.status_msg
        throw new Error(
            typeof message === "string" && message !== "" ? message : `status_code ${code}`,
        )
    }

    const buckets = Array.isArray(data.model_remains) ? data.model_remains : []
    // "general" is the plan-wide bucket every chat model draws from. The other
    // buckets are per-model views of the same quota, so counting them too would
    // report one allowance several times. The first bucket is the fallback for
    // a plan that does not name its general one.
    const bucket = record(buckets.find((entry) => record(entry).model_name === "general") ?? buckets[0])
    if (buckets.length === 0) throw new Error("no quota bucket in response")

    const windows: Window[] = []
    const interval = num(bucket.current_interval_remaining_percent)
    if (interval !== undefined) {
        windows.push({
            label: "5h",
            remaining: clampPct(interval),
            resetsAt: num(bucket.end_time),
            status: mmStatus(bucket.current_interval_status),
        })
    }
    const weekly = num(bucket.current_weekly_remaining_percent)
    if (weekly !== undefined) {
        windows.push({
            label: "weekly",
            remaining: clampPct(weekly),
            resetsAt: num(bucket.weekly_end_time),
            status: mmStatus(bucket.current_weekly_status),
        })
    }
    if (windows.length === 0) throw new Error("no quota windows in response")
    return windows
}

// The Go route's windows, in the order the panel draws them, keyed to the short
// labels every window provider shares.
const GO_WINDOWS: readonly (readonly [string, string])[] = [
    ["rolling", "5h"],
    ["weekly", "weekly"],
    ["monthly", "monthly"],
]

export function parseOpencodeGo(body: string): Window[] {
    const usage = record(record(JSON.parse(body)).usage)
    const windows: Window[] = []
    for (const [key, label] of GO_WINDOWS) {
        const window = record(usage[key])
        const percent = num(window.percent)
        // A missing or malformed window is skipped, not defaulted: an absent
        // window means "the provider did not report it", which is not zero.
        if (percent === undefined) continue
        const reset = typeof window.resetsAt === "string" ? Date.parse(window.resetsAt) : Number.NaN
        windows.push({
            label,
            remaining: clampPct(100 - percent),
            resetsAt: Number.isFinite(reset) ? reset : undefined,
            status: window.status === "rate-limited" ? "exhausted" : "ok",
        })
    }
    if (windows.length === 0) throw new Error("no usage windows in response")
    return windows
}

// DeepSeek reports a prepaid balance rather than a metered window, so its
// adapter yields a credit. `total_balance` arrives as a string and may be
// negative (an overdrawn account), which `num` would reject, so it is parsed
// and checked here.
export function parseDeepseek(body: string): Credit {
    const data = record(JSON.parse(body))
    const infos = Array.isArray(data.balance_infos) ? data.balance_infos : []
    const info = record(infos[0])
    const amount = typeof info.total_balance === "string" ? Number(info.total_balance) : Number.NaN
    if (!Number.isFinite(amount)) throw new Error("no balance in response")
    const currency = typeof info.currency === "string" && info.currency !== "" ? info.currency : "USD"
    return { amount, currency }
}

export const PROVIDERS: readonly Provider[] = [
    {
        id: "minimax-coding-plan",
        label: "MiniMax Coding Plan",
        path: "/v1/token_plan/remains",
        origin: "https://api.minimax.io",
        // The two regions the plan is sold in. Nothing else may carry the key.
        hosts: ["api.minimax.io", "api.minimaxi.com"],
        parse: (body) => ({ kind: "windows", windows: parseMinimax(body) }),
    },
    {
        id: "opencode-go",
        label: "OpenCode Go",
        path: "/zen/go/v1/usage",
        origin: "https://opencode.ai",
        hosts: ["opencode.ai"],
        parse: (body) => ({ kind: "windows", windows: parseOpencodeGo(body) }),
    },
    {
        id: "deepseek",
        label: "DeepSeek",
        path: "/user/balance",
        origin: "https://api.deepseek.com",
        hosts: ["api.deepseek.com"],
        parse: (body) => ({ kind: "credit", credit: parseDeepseek(body) }),
    },
]
