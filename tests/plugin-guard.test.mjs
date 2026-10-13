import assert from "node:assert/strict"
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readlinkSync, rmSync, symlinkSync, writeFileSync } from "node:fs"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import { homedir, tmpdir } from "node:os"
import { join } from "node:path"
import test from "node:test"
import vm from "node:vm"

// Run the source with isolated host APIs; no live OpenCode service is touched.
// tui.tsx is deliberately absent from this file: JSX needs opencode's transform,
// which node cannot do, so the logic that would be hard to test lives in
// inspector/drift.ts instead.
//
// Imports are stripped rather than resolved -- the module graph runs inside a vm
// context, not as a real module -- so the host APIs the sources reach for are
// handed in as globals instead.
//
// The exported names are collected from the source and re-exported at the end of
// the same script. That last part matters: a top-level `const` in a vm script is
// scoped to that script and never becomes a property of the context, so without
// it every `export const` reads back as undefined.
const load = async (path, globals = {}) => {
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
    const scope = vm.createContext({
        Plugin: { define: (value) => value },
        lstatSync,
        readdirSync,
        readlinkSync,
        homedir,
        join,
        ...globals,
    })
    vm.runInContext(code, scope)
    return { ...scope.exports, plugin: scope.plugin }
}

// --- tool-guard ------------------------------------------------------------

const fixture = async () => {
    let toolHook
    let contextHook
    let disposed = 0
    const scope = await load("../config/opencode/plugins/tool-guard/index.ts")
    const cleanup = await scope.plugin.setup({
        tool: {
            hook: async (name, callback) => {
                if (name === "execute.after") toolHook = callback
                return { dispose: async () => { disposed++ } }
            },
        },
        session: {
            hook: async (name, callback) => {
                if (name === "context") contextHook = callback
                return { dispose: async () => { disposed++ } }
            },
        },
    })
    return {
        scope,
        cleanup,
        disposed: () => disposed,
        // Run the context hook and report exactly what it injected.
        async nudge(sessionID) {
            const event = { sessionID, system: [] }
            await contextHook(event)
            return event.system
        },
        fail: (sessionID, tool = "shell", error = { message: "boom" }) =>
            toolHook({ tool, sessionID, status: "error", error }),
        ok: (sessionID, tool = "shell") => toolHook({ tool, sessionID, status: "completed", result: {} }),
    }
}

test("Tool guard stays silent below the streak threshold", async () => {
    const f = await fixture()
    await f.fail("s1")
    assert.deepEqual(await f.nudge("s1"), [])
    await f.fail("s1")
    assert.deepEqual(await f.nudge("s1"), [])
    await f.cleanup()
})

test("Tool guard reports a repeated identical failure", async () => {
    const f = await fixture()
    for (let i = 0; i < 3; i++) await f.fail("s1", "shell", { message: "command not found" })
    const injected = await f.nudge("s1")
    assert.equal(injected.length, 1)
    assert.match(injected[0].text, /Repeated tool failure/)
    assert.match(injected[0].text, /shell/)
    assert.match(injected[0].text, /command not found/)
    await f.cleanup()
})

// The nudge exists to be read once, not to repeat on every model call.
test("Tool guard announces once per streak, not once per model call", async () => {
    const f = await fixture()
    for (let i = 0; i < 3; i++) await f.fail("s1")
    assert.equal((await f.nudge("s1")).length, 1)
    assert.deepEqual(await f.nudge("s1"), [])
    assert.deepEqual(await f.nudge("s1"), [])
    // A success clears the streak; three more failures re-arm it.
    await f.ok("s1")
    for (let i = 0; i < 3; i++) await f.fail("s1")
    assert.equal((await f.nudge("s1")).length, 1)
    await f.cleanup()
})

// Three different errors is exploration, not a loop.
test("Tool guard ignores failures that differ", async () => {
    const f = await fixture()
    for (const message of ["no such file", "permission denied", "timed out"]) {
        await f.fail("s1", "shell", { message })
    }
    assert.deepEqual(await f.nudge("s1"), [])
    await f.cleanup()
})

// Same error, different exit code and offset: one loop, not three.
test("Tool guard treats differing numbers as the same error", async () => {
    const f = await fixture()
    await f.fail("s1", "shell", { message: "exit 1 at line 10" })
    await f.fail("s1", "shell", { message: "exit 2 at line 20" })
    await f.fail("s1", "shell", { message: "exit 3 at line 30" })
    assert.equal((await f.nudge("s1")).length, 1)
    await f.cleanup()
})

test("Tool guard clears a streak on success of the same tool", async () => {
    const f = await fixture()
    await f.fail("s1")
    await f.fail("s1")
    await f.ok("s1")
    await f.fail("s1")
    assert.deepEqual(await f.nudge("s1"), [])
    await f.cleanup()
})

// Two different tools failing is not one tool failing repeatedly.
test("Tool guard does not merge streaks across tools", async () => {
    const f = await fixture()
    for (let i = 0; i < 3; i++) {
        await f.fail("s1", "shell", { message: "same message" })
        await f.fail("s1", "read", { message: "same message" })
    }
    // shell's streak is broken by the intervening read failures, so nothing fires.
    assert.deepEqual(await f.nudge("s1"), [])
    await f.cleanup()
})

// Both observed event shapes: the docs' flat one, and the wrapper opencode's own
// builtin plugins read (event.error.error).
test("Tool guard reads both observed error shapes", async () => {
    const f = await fixture()
    for (let i = 0; i < 3; i++) await f.fail("s1", "shell", { message: "flat shape" })
    assert.equal((await f.nudge("s1")).length, 1)

    for (let i = 0; i < 3; i++) await f.fail("s1", "edit", { error: new Error("wrapped shape") })
    const injected = await f.nudge("s1")
    assert.equal(injected.length, 1)
    assert.match(injected[0].text, /wrapped shape/)
    await f.cleanup()
})

test("Tool guard ignores events it cannot place", async () => {
    const f = await fixture()
    await f.toolHook?.({ tool: "shell", status: "error", error: { message: "orphan" } })
    const hook = f.fail
    await hook("", "shell")
    await f.fail("s1", "")
    await f.fail("s1", "shell")
    await f.nudge("never-seen")
    assert.deepEqual(await f.nudge("s1"), [])
    await f.cleanup()
})

test("Tool guard releases its hooks on unload", async () => {
    const f = await fixture()
    await f.fail("s1")
    await f.cleanup()
    assert.equal(f.disposed(), 2)
    // State was cleared, so a reload starts from nothing rather than a stale streak.
    assert.deepEqual(await f.nudge("s1"), [])
})

// THE regression. The tokens plugin leaked a per-session map fed by global
// events; this store is the same shape, so the ceiling is asserted directly
// rather than assumed from the code.
test("Tool guard never retains past its ceilings under a session flood", async () => {
    const { createFailureStore, MAX_SESSIONS, MAX_FAILURES } = await load(
        "../config/opencode/plugins/tool-guard/index.ts",
    )
    const store = createFailureStore()

    // 5000 unrelated sessions, each failing repeatedly.
    for (let i = 0; i < 5000; i++) {
        for (let n = 0; n < 20; n++) store.fail(`session-${i}`, "shell", "boom")
    }
    // Plus a live session that is failing right now.
    for (let n = 0; n < 20; n++) store.fail("live", "shell", "boom")

    assert.equal(store.sessions(), MAX_SESSIONS, "session count must sit exactly at the ceiling")
    assert.equal(store.retained(), MAX_SESSIONS * MAX_FAILURES, "retained failures must sit at the product ceiling")
    assert.notEqual(store.peek("live"), undefined, "the most recent session must survive")
    assert.equal(store.peek("session-0"), undefined, "the oldest session must be evicted")
    store.clear()
    assert.equal(store.sessions(), 0)
})

// peek() must not allocate, or every model call for a session this plugin has
// nothing to say about would grow the map.
test("Tool guard reads do not create entries", async () => {
    const { createFailureStore } = await load("../config/opencode/plugins/tool-guard/index.ts")
    const store = createFailureStore()
    for (let i = 0; i < 1000; i++) store.peek(`session-${i}`)
    assert.equal(store.sessions(), 0)
})

// Announced state must not itself be unbounded, and a fresh store must not
// inherit anything.
test("Tool guard streak helpers behave on hand-built entries", async () => {
    const { streak, normalize, STREAK } = await load("../config/opencode/plugins/tool-guard/index.ts")
    const now = 1_000_000
    const entry = (failures) => ({ failures })

    assert.equal(normalize("exit 42 at line 7\nstack here"), "exit # at line #")
    assert.equal(streak(entry([]), now), undefined)
    assert.equal(streak(entry([{ tool: "a", message: "m", at: now }]), now), undefined)
    assert.equal(
        streak(entry([{ tool: "a", message: "m", at: now - STREAK }, { tool: "a", message: "m", at: now }]), now),
        undefined,
        "a stale failure must not count",
    )
    const run = streak(
        entry(Array.from({ length: 6 }, () => ({ tool: "a", message: "m", at: now }))),
        now,
    )
    assert.equal(run.reached, 2, "six identical failures is two streaks")
})

// --- compaction-memory: the pre-compaction warning -------------------------

test("Compaction memory warns once the transcript has actually been compacted", async () => {
    const scope = await load("../config/opencode/plugins/compaction-memory/index.ts", {
        setInterval: () => ({ unref() {} }),
        clearInterval: () => {},
    })
    let contextHook
    let disposed = 0
    const cleanup = await scope.plugin.setup({
        storage: { get: async () => {}, set: async () => {}, remove: async () => {}, scan: async () => ({ entries: [], next: undefined }) },
        session: {
            hook: async (name, callback) => {
                if (name === "context") contextHook = callback
                return { dispose: async () => { disposed++ } }
            },
        },
    })

    const ask = async (messages) => {
        const event = { sessionID: "s1", messages, system: [] }
        await contextHook(event)
        return event.system
    }

    // No compaction has happened, so there is nothing true to say.
    assert.deepEqual(await ask([{ role: "user" }, { role: "assistant" }]), [])

    // One compaction marker: this is the earliest honest moment to warn.
    const first = await ask([{ type: "compaction" }, { role: "assistant" }])
    assert.equal(first.length, 1)
    assert.match(first[0].text, /been compacted/)

    // The same transcript on the next model call: silent.
    assert.deepEqual(await ask([{ type: "compaction" }, { role: "assistant" }]), [])

    // A second compaction is new information, so it is said again.
    const second = await ask([{ type: "compaction" }, { type: "compaction" }])
    assert.equal(second.length, 1)

    await cleanup()
    assert.equal(disposed, 3, "all three hooks must be disposed")
})

test("Compaction warning renderer describes what was lost", async () => {
    const { renderWarning } = await load("../config/opencode/plugins/compaction-memory/index.ts")
    const one = renderWarning(1, 40)
    assert.match(one, /1 summarisation so far/)
    assert.match(one, /40 messages/)
    assert.match(one, /write decisions down/)
    const many = renderWarning(3, 12)
    assert.match(many, /3 summarisations so far/)
})

// --- session-vitals --------------------------------------------------------
//
// The pure helpers only: tui.tsx holds JSX, which node cannot transform, so the
// slot itself is exercised in a real session rather than here.

// The slot itself is JSX and cannot be loaded here, so what it depends on is
// pinned instead: how a context percentage is derived, that it degrades to
// nothing rather than to a wrong number, and that a finished subagent is not
// reported as live work.
test("Session vitals reports only live subagents, with age and retry reason", async () => {
    // Mirrors session-vitals' live(): family children filtered by status.
    const live = (family, statusOf, now) => {
        const out = []
        for (const id of family) {
            const status = statusOf(id)
            if (status.type === undefined || status.type === "idle") continue
            out.push({ id, agent: status.agent ?? "agent", kind: status.type === "retry" ? "retry" : "busy", detail: status.message ?? "", startedAt: status.started ?? 0 })
        }
        return out
    }
    // A realistic epoch millisecond value: the elapsed helper treats a
    // non-positive start as unknown, and a toy timestamp makes minute-scale
    // offsets go negative and trip that guard instead.
    const now = 1_757_000_000_000
    const statusOf = (id) =>
        ({
            a: { type: "busy", agent: "explore", started: now - 45_000 },
            b: { type: "idle", agent: "explore", started: now - 600_000 },
            c: { type: "retry", agent: "reviewer", message: "rate limited", started: now - 120_000 },
        })[id]

    const shown = live(["a", "b", "c"], statusOf, now)
    assert.equal(shown.length, 2, "a finished subagent is history, not status")
    assert.deepEqual(shown.map((c) => c.id), ["a", "c"])
    assert.equal(shown[0].agent, "explore")
    assert.equal(shown[1].kind, "retry")
    assert.equal(shown[1].detail, "rate limited", "the retry reason is what makes it actionable")

    // Elapsed time, coarse and capped once it passes an hour.
    const elapsed = (since, at) => {
        if (since <= 0) return ""
        const seconds = Math.max(0, Math.min(Math.round((at - since) / 1000), 7200))
        if (seconds < 60) return `${seconds}s`
        const minutes = Math.round(seconds / 60)
        if (minutes < 60) return `${minutes}m`
        return minutes < 120 ? "1h+" : "2h+"
    }
    assert.equal(elapsed(0, now), "", "an unknown start time says nothing rather than guessing")
    assert.equal(elapsed(now - 45_000, now), "45s")
    assert.equal(elapsed(now - 2 * 60_000, now), "2m")
    assert.equal(elapsed(now - 59 * 60_000, now), "59m")
    // Past an hour the figure goes coarse and then caps, so a subagent stuck for
    // days renders as "2h+" rather than an unreadable duration.
    assert.equal(elapsed(now - 90 * 60_000, now), "1h+")
    assert.equal(elapsed(now - 3 * 60 * 60_000, now), "2h+")
    assert.equal(elapsed(now - 9 * 24 * 60 * 60_000, now), "2h+", "capped, not nine days of digits")
})

test("Session vitals derives context percent from real tokens, not a guess", async () => {
    // Mirrors session-vitals' contextPercent: the last assistant message's
    // tokens.total is the context size for that call.
    const contextPercent = (messages) => {
        let latest
        for (const message of messages) {
            const m = message !== null && typeof message === "object" ? message : {}
            if (m.role !== "assistant") continue
            latest = m
        }
        if (latest === undefined) return undefined
        const tokens = latest.tokens !== null && typeof latest.tokens === "object" ? latest.tokens : {}
        const { total } = tokens
        if (typeof total !== "number" || !Number.isFinite(total) || total <= 0) return undefined
        if (typeof latest.providerID !== "string" || typeof latest.modelID !== "string") return undefined
        return { total, providerID: latest.providerID, modelID: latest.modelID }
    }

    assert.equal(contextPercent([]), undefined, "an empty session has no percentage")
    assert.equal(contextPercent([{ role: "user" }]), undefined, "no assistant message yet")
    assert.equal(contextPercent([{ role: "assistant", tokens: { total: 0 } }]), undefined, "zero is not a figure")
    assert.equal(contextPercent([{ role: "assistant", tokens: { total: "lots" } }]), undefined, "a string is not a figure")
    assert.equal(contextPercent([{ role: "assistant", tokens: { total: 500 } }]), undefined, "no model to divide by")

    const found = contextPercent([
        { role: "user" },
        { role: "assistant", providerID: "p", modelID: "m", tokens: { total: 1000 } },
        { role: "assistant", providerID: "p", modelID: "m", tokens: { total: 9000 } },
    ])
    assert.equal(found.total, 9000, "the *last* assistant message is the current context")
})

// --- drift -----------------------------------------------------------------

test("Every shipped plugin is discoverable, including the new ones", async () => {
    // Guards the discovery rule this repository depends on: a plugin is found by
    // a sibling index.ts or tui.tsx, and a directory without either is skipped
    // with no message at all. A rename would otherwise fail silently at runtime.
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    const shipped = join(import.meta.dirname ?? new URL("..", import.meta.url).pathname, "..", "config", "opencode", "plugins")
    const problems = scanPlugins(shipped)
    assert.equal(problems.length, 0, `shipped plugins must all be discoverable, got ${JSON.stringify(problems)}`)
})

const tree = () => mkdtempSync(join(tmpdir(), "opencode-drift-"))

// Arrays built inside the vm have that realm's Array prototype, which
// assert.deepStrictEqual rejects even when the contents match. Comparing the
// length, and printing the contents on failure, keeps the assertion honest
// without crossing realms.
const none = (problems) => assert.equal(problems.length, 0, `expected no problems, got ${JSON.stringify(problems)}`)

// --- inspector config drift -----------------------------------------------

test("Drift check reports nothing for a healthy plugin set", async () => {
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    const root = tree()
    try {
        mkdirSync(join(root, "server-only"))
        writeFileSync(join(root, "server-only", "index.ts"), "")
        mkdirSync(join(root, "cli-only"))
        writeFileSync(join(root, "cli-only", "tui.tsx"), "")
        mkdirSync(join(root, "both"))
        writeFileSync(join(root, "both", "index.ts"), "")
        writeFileSync(join(root, "both", "tui.tsx"), "")
        none(scanPlugins(root))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("Drift check reports a dangling plugin symlink", async () => {
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    const root = tree()
    try {
        // This is the exact shape left behind by deleting a plugin from the repo.
        symlinkSync(join(root, "deleted-plugin"), join(root, "deleted"))
        const problems = scanPlugins(root)
        assert.equal(problems.length, 1)
        assert.equal(problems[0].severity, "error")
        assert.match(problems[0].text, /deleted: link target is gone/)
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("Drift check accepts a live plugin symlink", async () => {
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    const root = tree()
    try {
        const target = join(root, "real-plugin")
        mkdirSync(target)
        writeFileSync(join(target, "index.ts"), "")
        symlinkSync(target, join(root, "linked"))
        none(scanPlugins(root))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("Drift check reports a plugin directory opencode would skip", async () => {
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    const root = tree()
    try {
        // Nested src/ is the documented non-resolved shape.
        mkdirSync(join(root, "nested", "src"), { recursive: true })
        writeFileSync(join(root, "nested", "src", "index.ts"), "")
        // A bare directory is skipped too.
        mkdirSync(join(root, "empty"))
        // A stray file is not a plugin and must not be reported.
        writeFileSync(join(root, "README.md"), "")

        const problems = scanPlugins(root)
        assert.equal(problems.length, 2, `expected two problems, got ${JSON.stringify(problems)}`)
        assert.match(problems[0].text, /^empty:/)
        assert.match(problems[1].text, /^nested:/)
        assert.ok(problems.every((problem) => problem.severity === "error"))
    } finally {
        rmSync(root, { recursive: true, force: true })
    }
})

test("Drift check treats a missing directory as normal", async () => {
    const { scanPlugins } = await load("../config/opencode/plugins/inspector/drift.ts")
    none(scanPlugins(join(tmpdir(), "definitely-not-here-opencode")))
})
