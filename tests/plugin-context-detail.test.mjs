import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run panel.ts with no opencode at all; nothing here contacts a service.
//
// tui.tsx is absent by construction: JSX needs opencode's transform, so the
// decisions this panel makes -- which totals it reads, how the rates are
// computed, and what each row says -- live in panel.ts and are exercised here.
//
// panel.ts imports nothing, so the scope under test is empty.

const load = async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            .replace(/^import .*$/gm, "")
            .replace(/export default /g, "globalThis.plugin = ")
            .replace(/^export /gm, "") +
        `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({})
    vm.runInContext(code, scope)
    return scope.exports
}

const { buildSection, cacheRateOf, latestSpeed, row, speedOf, usageOf, WIDTH } = await load(
    "../config/opencode/plugins/context-detail/panel.ts",
)

// The shapes the host's data has, reduced to the fields this panel reads.
const session = (tokens) => ({
    tokens: {
        input: 0,
        output: 0,
        reasoning: 0,
        ...tokens,
        // Merged rather than spread: a partial cache record is a missing
        // field, not a cache without a write.
        cache: { read: 0, write: 0, ...(tokens.cache ?? {}) },
    },
})

const assistant = (id, tokens, time) => ({
    id,
    type: "assistant",
    tokens: { input: 0, output: 0, reasoning: 0, ...tokens },
    time,
})

const text = (line) => line.segments.map((segment) => segment.text).join("")

// This machine's own totals for a long session, from /api/session: cumulative,
// with a cache hit rate near 97% and no cache writes at all.
const spent = session({
    input: 808_334,
    output: 43_536,
    reasoning: 99_765,
    cache: { read: 25_030_845, write: 0 },
})

// A generation of 55 output + 43 reasoning tokens over 496 ms.
const generation = assistant("m1", { output: 55, reasoning: 43 }, { created: 1_000, streamed: 1_496 })

test("The panel reads the session's cumulative totals", () => {
    const usage = usageOf(spent, [generation])
    // Spread into this realm's object: the one under test was made inside the
    // VM, and a strict comparison rejects it for its prototype.
    assert.deepEqual({ ...usage?.tokens }, {
        input: 808_334,
        output: 43_536,
        reasoning: 99_765,
        cacheRead: 25_030_845,
        cacheWrite: 0,
    })
})

test("A session that has not spent anything gets no panel", () => {
    assert.equal(usageOf(undefined, []), undefined)
    assert.equal(usageOf(session({}), []), undefined)
    assert.equal(usageOf(session({ cache: { read: 0 } }), []), undefined)
})

test("A token field the host did not report counts as zero, not as a broken total", () => {
    // A record without a cache at all: the total is still the tokens that were
    // reported, rather than NaN. None of the prompt came from the cache, so the
    // rate is a real 0% rather than a missing one.
    const usage = usageOf({ tokens: { input: 1_000 } }, [])
    assert.equal(usage?.tokens.cacheRead, 0)
    assert.equal(usage?.tokens.cacheWrite, 0)
    assert.equal(usage?.cacheRate, 0)
})

test("The cache rate is the share of prompt tokens read back from the cache", () => {
    // The real session: 25,030,845 of (808,334 + 25,030,845).
    const tokens = { input: 808_334, output: 0, reasoning: 0, cacheRead: 25_030_845, cacheWrite: 0 }
    assert.equal(cacheRateOf(tokens), (25_030_845 / (808_334 + 25_030_845)) * 100)
    // A written cache is part of the prompt too, so it counts in the
    // denominator even though it was not a hit.
    assert.equal(cacheRateOf({ input: 1_000, output: 0, reasoning: 0, cacheRead: 500, cacheWrite: 500 }), 25)
    // No prompt tokens is no rate, rather than a division by zero.
    assert.equal(cacheRateOf({ input: 0, output: 0, reasoning: 10, cacheRead: 0, cacheWrite: 0 }), undefined)
})

test("The speed counts output and reasoning over the streaming window", () => {
    // 55 output + 43 reasoning over 496 ms, the sample's 197.6 t/s.
    assert.equal(speedOf(generation), (55 + 43) / 0.496)
    // A step that did not stream has no speed to report.
    assert.equal(speedOf(assistant("m1", { input: 10 }, { created: 1_000 })), undefined)
    assert.equal(speedOf({ type: "assistant" }), undefined)
    // A streaming window that did not advance cannot divide.
    assert.equal(speedOf(assistant("m1", { output: 10 }, { created: 1_000, streamed: 1_000 })), undefined)
    // Nothing generated is no speed, rather than zero tokens per second.
    assert.equal(speedOf(assistant("m1", { input: 10 }, { created: 1_000, streamed: 2_000 })), undefined)
})

test("The speed shown is the latest generation's", () => {
    // Scanning back for the last streamed assistant step: a step interrupted
    // before its first token has no window, and a message of another kind is
    // not a generation.
    const messages = [
        assistant("m1", { output: 10 }, { created: 0, streamed: 1_000 }),
        assistant("m2", { output: 20 }, { created: 0, streamed: 500 }),
        { id: "m3", type: "assistant", tokens: { output: 99 } },
        { id: "u1", type: "user" },
    ]
    assert.equal(latestSpeed(messages), 40)
    assert.equal(latestSpeed([]), undefined)
    assert.equal(latestSpeed([{ id: "u1", type: "user" }]), undefined)
})

test("Every row is one panel width, the label inset by two and the value flush right", () => {
    const line = row("Input", "808,334")
    assert.equal(text(line).length, WIDTH)
    assert.ok(text(line).startsWith("  Input"))
    assert.ok(text(line).endsWith("808,334"))
    // The label carries the padding, so the value is one segment that never
    // wraps away from its number.
    assert.equal(line.segments.length, 2)
    // A pair too long for the panel keeps one space between them rather than
    // running the words together; the row simply runs past the width.
    const long = row("Generation speed", "1234567890123456789012 t/s")
    assert.equal(text(long), "  Generation speed 1234567890123456789012 t/s")
})

test("The rows are the counts and the two rates, in Kilo's order", () => {
    const usage = usageOf(spent, [generation])
    const rows = buildSection(usage)
    assert.deepEqual(
        [...rows.map((line) => text(line).trimStart().split(/\s{2,}/)[0])],
        ["Input", "Output", "Reasoning", "Cache read", "Cache write", "Cache rate", "Generation speed"],
    )
    // Every row is drawn, including a zero: the panel keeps its shape from one
    // session to the next.
    assert.equal(rows.length, 7)
})

test("A count is drawn with thousands separators and a rate to one decimal", () => {
    const usage = usageOf(spent, [generation])
    const values = buildSection(usage).map((line) => line.segments[1].text)
    assert.deepEqual([...values], ["808,334", "43,536", "99,765", "25,030,845", "0", "96.9%", "197.6 t/s"])
})

test("A missing rate is drawn as a dash rather than a zero", () => {
    // No streaming window and no prompt tokens: two dashes, so the panel does
    // not claim a speed or a cache rate it does not have.
    const lines = buildSection(usageOf({ tokens: { output: 10, reasoning: 5 } }, []))
    assert.equal(lines[5].segments[1].text, "-")
    assert.equal(lines[6].segments[1].text, "-")
})
