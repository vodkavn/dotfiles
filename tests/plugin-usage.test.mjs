import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run providers.ts and panel.ts with no opencode at all; nothing here contacts
// a service.
//
// tui.tsx is absent by construction: JSX needs opencode's transform, so the
// decisions a row makes -- which window a provider reports, how much of it is
// left, when it resets, what the row says, and when a cached answer lapses --
// live in providers.ts and panel.ts and are exercised here.
//
// The fixtures are the live shapes, captured 2026-10-15. They are pinned rather
// than fetched, so a provider changing its payload is caught here as a failure
// rather than silently rendering nothing.

const load = async (path, globals = {}) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            // Static imports, single- or multi-line. The sibling modules and
            // host APIs are handed in as globals instead, so the import lines
            // are removed rather than resolved.
            .replace(/^import[\s\S]*?from\s+["'][^"']*["'];?[^\S\n]*$/gm, "")
            .replace(/^import\s+["'][^"']*["'];?[^\S\n]*$/gm, "")
            .replace(/export default /g, "globalThis.plugin = ")
            .replace(/^export /gm, "") +
        `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({ URL, ...globals })
    vm.runInContext(code, scope)
    return scope.exports
}

// panel.ts imports the adapters from ./providers.ts. The loader strips imports,
// so the provider module's exports are handed in as globals instead -- the same
// convention the other plugin tests use for host APIs.
const providers = await load("../config/opencode/plugins/provider-usage/providers.ts")
const panel = await load("../config/opencode/plugins/provider-usage/panel.ts", providers)

const { PROVIDERS, parseDeepseek, parseMinimax, parseOpencodeGo } = providers
const {
    bar,
    BAR_WIDTH,
    baseURLs,
    buildPanel,
    connections,
    CREDENTIAL_RETRY_MS,
    describeError,
    dueProviders,
    elapsed,
    LABEL_WIDTH,
    money,
    refreshText,
    resetText,
    retrySoon,
    selectCredential,
    stale,
    TTL_MS,
    toneFor,
    usageUrl,
} = panel

// A fixed clock, so no assertion depends on the wall clock.
const NOW = 1_800_000_000_000
const MINUTE = 60_000
const HOUR = 3_600_000
const DAY = 86_400_000
const iso = (ms) => new Date(ms).toISOString()

// Values built inside the vm carry that realm's prototypes, which
// assert.deepStrictEqual rejects even when the contents match. A JSON round
// trip re-enters this realm, so the assertions below stay ordinary ones.
const plain = (value) => JSON.parse(JSON.stringify(value))

// A row's segments joined back into the plain string it draws.
const textOf = (line) => line.segments.map((segment) => segment.text).join("")

// --- MiniMax ---------------------------------------------------------------

// The general bucket plus a second bucket, which must be ignored: the per-model
// buckets view the same quota, and counting them would report it twice.
const MINIMAX = JSON.stringify({
    model_remains: [
        {
            model_name: "general",
            current_interval_remaining_percent: 83,
            current_weekly_remaining_percent: 53,
            current_interval_status: 1,
            current_weekly_status: 1,
            end_time: NOW + 88 * MINUTE,
            weekly_end_time: NOW + 22 * HOUR,
        },
        {
            model_name: "video",
            current_interval_remaining_percent: 4,
            current_weekly_remaining_percent: 4,
        },
    ],
    base_resp: { status_code: 0, status_msg: "success" },
})

test("MiniMax decodes its two remaining-percent windows off the general bucket", () => {
    const windows = plain(parseMinimax(MINIMAX))
    assert.deepEqual(
        windows.map((window) => [window.label, window.remaining]),
        [
            ["5h", 83],
            ["weekly", 53],
        ],
    )
    // MiniMax reports the reset instants directly, so no window length is assumed.
    assert.equal(windows[0].resetsAt, NOW + 88 * MINUTE)
    assert.equal(windows[1].resetsAt, NOW + 22 * HOUR)
    assert.equal(windows[0].status, "ok")
})

test("MiniMax treats a non-zero base_resp as the real failure", () => {
    // MiniMax answers HTTP 200 even for a rejected key; the body is the signal.
    const rejected = JSON.stringify({ base_resp: { status_code: 1004, status_msg: "invalid api key" } })
    assert.throws(() => parseMinimax(rejected), /invalid api key/)
    const coded = JSON.stringify({ model_remains: [], base_resp: { status_code: 7 } })
    assert.throws(() => parseMinimax(coded), /status_code 7/)
})

test("MiniMax refuses a body with no usable window", () => {
    assert.throws(() => parseMinimax(JSON.stringify({ base_resp: { status_code: 0 } })), /no quota bucket/)
    assert.throws(
        () => parseMinimax(JSON.stringify({ model_remains: [{ model_name: "general" }], base_resp: { status_code: 0 } })),
        /no quota windows/,
    )
})

// --- OpenCode Go -----------------------------------------------------------

// The Go route reports *used* percent; the panel reports what remains.
const GO = JSON.stringify({
    usage: {
        rolling: { status: "ok", percent: 4, resetsAt: iso(NOW + 88 * MINUTE) },
        weekly: { status: "ok", percent: 77, resetsAt: iso(NOW + 4 * DAY) },
        monthly: { status: "rate-limited", percent: 100, resetsAt: iso(NOW + 15 * DAY) },
    },
})

test("OpenCode Go turns used percent into remaining and keeps the reset instants", () => {
    const windows = plain(parseOpencodeGo(GO))
    assert.deepEqual(
        windows.map((window) => [window.label, window.remaining, window.status]),
        [
            ["5h", 96, "ok"],
            ["weekly", 23, "ok"],
            ["monthly", 0, "exhausted"],
        ],
    )
    assert.equal(windows[1].resetsAt, NOW + 4 * DAY)
})

test("OpenCode Go skips a window it cannot decode rather than defaulting it", () => {
    const partial = JSON.stringify({
        usage: {
            rolling: { percent: 10 },
            weekly: { status: "ok" },
            monthly: { percent: "nonsense" },
        },
    })
    assert.deepEqual(
        plain(parseOpencodeGo(partial)).map((window) => window.remaining),
        [90],
    )
    assert.throws(() => parseOpencodeGo(JSON.stringify({ usage: {} })), /no usage windows/)
})

// --- DeepSeek, and the host-derivation the adapters share -------------------

const DEEPSEEK = JSON.stringify({
    is_available: true,
    balance_infos: [{ currency: "USD", total_balance: "1.52", granted_balance: "0.00", topped_up_balance: "1.52" }],
})

test("DeepSeek decodes its prepaid balance as a credit", () => {
    assert.deepEqual(plain(parseDeepseek(DEEPSEEK)), { amount: 1.52, currency: "USD" })
    // A missing or non-numeric balance is refused rather than shown as zero.
    assert.throws(() => parseDeepseek(JSON.stringify({ balance_infos: [] })), /no balance/)
    assert.throws(() => parseDeepseek(JSON.stringify({ balance_infos: [{ total_balance: "abc" }] })), /no balance/)
})

test("usageUrl takes the host from opencode's base URL and the path from the adapter", () => {
    const minimax = PROVIDERS.find((provider) => provider.id === "minimax-coding-plan")
    // One declaration covers the global host, its China sibling, and a proxy:
    // only the origin of opencode's base URL is used.
    assert.equal(usageUrl(minimax, "https://api.minimax.io/anthropic/v1"), "https://api.minimax.io/v1/token_plan/remains")
    assert.equal(usageUrl(minimax, "https://api.minimaxi.com/anthropic/v1"), "https://api.minimaxi.com/v1/token_plan/remains")
    // No base URL, or one that will not parse, falls back to the adapter origin.
    assert.equal(usageUrl(minimax, undefined), "https://api.minimax.io/v1/token_plan/remains")
    assert.equal(usageUrl(minimax, "not a url"), "https://api.minimax.io/v1/token_plan/remains")
    // The Go usage path is not a suffix of its base URL, so deriving the origin
    // is what makes it work without a second hardcoded host.
    const go = PROVIDERS.find((provider) => provider.id === "opencode-go")
    assert.equal(usageUrl(go, "https://opencode.ai/inference/go/v1"), "https://opencode.ai/zen/go/v1/usage")
})

test("baseURLs keys each provider by its id and its integration id", () => {
    const map = baseURLs([
        { id: "deepseek", integrationID: "deepseek", settings: { baseURL: "https://api.deepseek.com" } },
        { id: "minimax-coding-plan", settings: { baseURL: "https://api.minimax.io/anthropic/v1" } },
        { id: "no-base", settings: {} },
        { id: "not-an-object" },
    ])
    assert.equal(map.get("deepseek"), "https://api.deepseek.com")
    assert.equal(map.get("minimax-coding-plan"), "https://api.minimax.io/anthropic/v1")
    assert.equal(map.get("no-base"), undefined)
    assert.equal(map.size, 2)
})

test("money renders USD with a symbol and other currencies spelled out", () => {
    assert.equal(money({ amount: 1.5, currency: "USD" }), "$1.50")
    assert.equal(money({ amount: 0, currency: "USD" }), "$0.00")
    assert.equal(money({ amount: 12.345, currency: "EUR" }), "EUR 12.35")
})

// --- credentials -----------------------------------------------------------

test("selectCredential takes only the active key for the named integration", () => {
    const entries = [
        { integrationID: "opencode-go", active: true, value: { type: "key", key: "go-key" } },
        { integrationID: "minimax-coding-plan", active: true, value: { type: "oauth", key: "ignored" } },
        { integrationID: "minimax-coding-plan", active: false, value: { type: "key", key: "stale" } },
        { integrationID: "minimax-coding-plan", active: true, value: { type: "key", key: "mm-key" } },
    ]
    assert.equal(selectCredential(entries, "minimax-coding-plan"), "mm-key")
    assert.equal(selectCredential(entries, "opencode-go"), "go-key")
    assert.equal(selectCredential(entries, "absent"), undefined)
    // The same list wrapped in the client's envelope.
    assert.equal(selectCredential({ data: entries }, "opencode-go"), "go-key")
    assert.equal(selectCredential(undefined, "opencode-go"), undefined)
})

test("connections keeps only the providers with an active key", () => {
    // The adapter registry is a superset: a provider with no active key here is
    // not connected, and is named in `absent` so the caller can drop its row.
    const providers = [{ id: "minimax-coding-plan" }, { id: "opencode-go" }, { id: "deepseek" }]
    const credentials = [
        { integrationID: "opencode-go", active: true, value: { type: "key", key: "go-key" } },
        { integrationID: "deepseek", active: false, value: { type: "key", key: "off" } },
    ]
    const { ready, absent } = plain(connections(credentials, providers))
    assert.deepEqual(ready.map((entry) => [entry.provider.id, entry.key]), [["opencode-go", "go-key"]])
    assert.deepEqual(absent, ["minimax-coding-plan", "deepseek"])
})

// --- formatting ------------------------------------------------------------

test("bar fills in proportion and never leaves the row ragged", () => {
    assert.equal(bar(0, 8), "········")
    assert.equal(bar(100, 8), "████████")
    assert.equal(bar(50, 8), "████····")
    // Clamped: a provider that overshoots must not widen or shorten the bar.
    assert.equal(bar(140, 8), "████████")
    assert.equal(bar(-5, 8), "········")
    // The shipped width is ten cells, so one cell is about ten percent.
    assert.equal(BAR_WIDTH, 10)
    assert.equal(bar(80, BAR_WIDTH), "████████··")
    // Half a cell rounds up, so a window just under ten percent still shows one.
    assert.equal(bar(5, BAR_WIDTH), "█·········")
})

test("resetText counts down in at most two units", () => {
    assert.equal(resetText(NOW + (HOUR + 28 * MINUTE), NOW), "1h28m")
    assert.equal(resetText(NOW + 22 * HOUR, NOW), "22h")
    assert.equal(resetText(NOW + 4 * DAY, NOW), "4d")
    assert.equal(resetText(NOW, NOW), "now")
    assert.equal(resetText(NOW - MINUTE, NOW), "now")
    assert.equal(resetText(undefined, NOW), "")
})

test("elapsed ages in one unit, so a refresh that changed nothing still shows", () => {
    assert.equal(elapsed(undefined, NOW), "")
    assert.equal(elapsed(NOW, NOW), "now")
    assert.equal(elapsed(NOW - 30_000, NOW), "now")
    assert.equal(elapsed(NOW - 3 * MINUTE, NOW), "3m")
    assert.equal(elapsed(NOW - 2 * HOUR, NOW), "2h")
    assert.equal(elapsed(NOW - 4 * DAY, NOW), "4d")
    // A clock that runs backwards is not an age.
    assert.equal(elapsed(NOW + MINUTE, NOW), "")
})

test("refreshText wraps the age in parentheses and shows 'recent' for a fresh age", () => {
    assert.equal(refreshText(false, "", undefined, NOW), "⟳ refresh")
    assert.equal(refreshText(false, "", NOW, NOW), "⟳ refresh (recent)")
    assert.equal(refreshText(false, "", NOW - 3 * MINUTE, NOW), "⟳ refresh (3m ago)")
    assert.equal(refreshText(true, "⠹", NOW, NOW), "⠹ refreshing…")
})

test("toneFor escalates as a window empties", () => {
    assert.equal(toneFor({ remaining: 80, status: "ok" }), "normal")
    assert.equal(toneFor({ remaining: 20, status: "ok" }), "warn")
    assert.equal(toneFor({ remaining: 10, status: "ok" }), "error")
    assert.equal(toneFor({ remaining: 90, status: "exhausted" }), "error")
})

// --- the panel -------------------------------------------------------------

test("buildPanel draws connected providers in order and skips those with no result", () => {
    const usages = new Map([
        ["opencode-go", { id: "opencode-go", label: "OpenCode Go", kind: "windows", windows: parseOpencodeGo(GO) }],
        ["minimax-coding-plan", { id: "minimax-coding-plan", label: "MiniMax", kind: "windows", windows: parseMinimax(MINIMAX) }],
    ])
    const lines = plain(buildPanel(usages, NOW, 8))
    // MiniMax first, by PROVIDERS order, not by insertion order.
    assert.equal(textOf(lines[0]), "MiniMax Coding Plan")
    assert.equal(lines[0].segments[0].tone, "label")
    assert.match(textOf(lines[1]), /^ {2}5h +█+·+ +83% {2}1h28m$/)
    // Two MiniMax windows and three Go windows, plus a name row per provider.
    assert.equal(lines.length, 7)

    // A provider with no result contributes nothing at all.
    assert.deepEqual(plain(buildPanel(new Map(), NOW, 8)), [])
})

test("only a window's bar carries the severity tone; the rest of the row stays body colour", () => {
    const usages = new Map([["opencode-go", { id: "opencode-go", label: "OpenCode Go", kind: "windows", windows: parseOpencodeGo(GO) }]])
    const lines = plain(buildPanel(usages, NOW, 10))
    // lines[0] is the provider name; then 5h (96%, normal), weekly (23%, warn),
    // monthly (0%, exhausted). Only the middle segment is toned on each.
    assert.deepEqual(lines[2].segments.map((segment) => segment.tone), ["normal", "warn", "normal"])
    assert.match(lines[2].segments[1].text, /^[█·]{10}$/)
    assert.equal(lines[3].segments[1].tone, "error")
})

test("every window bar starts in one column, aligned with the monthly label", () => {
    // MiniMax has no monthly window and "monthly" is the longest label, so a
    // label field measured per row would leave its bar a column short of the
    // Go rows. The field is fixed, so all five bars share a column.
    const usages = new Map([
        ["minimax-coding-plan", { id: "minimax-coding-plan", label: "MiniMax", kind: "windows", windows: parseMinimax(MINIMAX) }],
        ["opencode-go", { id: "opencode-go", label: "OpenCode Go", kind: "windows", windows: parseOpencodeGo(GO) }],
    ])
    const lines = plain(buildPanel(usages, NOW, 8))
    const starts = lines
        .filter((line) => /[█·]/.test(textOf(line)))
        .map((line) => {
            const text = textOf(line)
            const filled = text.indexOf("█")
            return filled >= 0 ? filled : text.indexOf("·")
        })
    assert.equal(new Set(starts).size, 1, `bars start at different columns: ${starts.join(", ")}`)
    // Two leading spaces, the label field, then the separating space.
    assert.equal(starts[0], 2 + LABEL_WIDTH + 1)
})

test("buildPanel draws a failed provider as an error line rather than nothing", () => {
    const usages = new Map([["opencode-go", { id: "opencode-go", label: "OpenCode Go", error: "HTTP 403" }]])
    const lines = plain(buildPanel(usages, NOW, 8))
    assert.equal(textOf(lines[0]), "OpenCode Go")
    assert.equal(lines[0].segments[0].tone, "label")
    assert.deepEqual(lines[1], { segments: [{ text: "  HTTP 403", tone: "error" }] })
})

test("buildPanel draws a credit provider as a money row", () => {
    const usages = new Map([
        ["deepseek", { id: "deepseek", label: "DeepSeek", kind: "credit", credit: { amount: 1.52, currency: "USD" } }],
    ])
    const lines = plain(buildPanel(usages, NOW, 10))
    assert.equal(textOf(lines[0]), "DeepSeek")
    assert.deepEqual(lines[1], { segments: [{ text: "  $1.52", tone: "normal" }] })
})

test("describeError surfaces a JSON message and falls back to the status", () => {
    assert.equal(describeError(JSON.stringify({ detail: "Access denied" }), 403), "Access denied")
    assert.equal(describeError(JSON.stringify({ status_msg: "bad key" }), 200), "bad key")
    assert.equal(describeError("<html>", 502), "HTTP 502")
})

// --- freshness -------------------------------------------------------------

test("stale gates a refetch on attempt time, not success time", () => {
    assert.equal(stale(undefined, NOW), true)
    assert.equal(stale(NOW, NOW), false)
    assert.equal(stale(NOW - TTL_MS, NOW), true)
})

test("a failed credential read retries soon instead of burning the TTL", () => {
    // Nothing was asked of the network, so the provider is stamped to come due
    // again after CREDENTIAL_RETRY_MS rather than the full TTL.
    const at = retrySoon(NOW)
    assert.equal(stale(at, NOW + 1), false)
    assert.equal(stale(at, NOW + CREDENTIAL_RETRY_MS), true)
    assert.ok(CREDENTIAL_RETRY_MS < TTL_MS)
})

test("dueProviders returns the lapsed providers, or all of them when forced", () => {
    const attempts = new Map([
        ["minimax-coding-plan", NOW],
        ["opencode-go", NOW - TTL_MS],
    ])
    assert.deepEqual(plain(dueProviders(attempts, NOW, false)).map((provider) => provider.id), [
        "opencode-go",
        "deepseek",
    ])
    assert.deepEqual(plain(dueProviders(attempts, NOW, true)).map((provider) => provider.id), [
        "minimax-coding-plan",
        "opencode-go",
        "deepseek",
    ])
})
