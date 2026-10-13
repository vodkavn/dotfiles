import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run the source with isolated host APIs; no live OpenCode service is touched.
const load = async (path, globals = {}) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const code = stripTypeScriptTypes(source)
        .replace(/^import .* from "@opencode\/plugin"\n/m, "")
        .replace(/export default /g, "globalThis.plugin = ")
        .replace(/export /g, "")
    const scope = vm.createContext({ Plugin: { define: (value) => value }, ...globals })
    vm.runInContext(code, scope)
    return scope
}

// Drain the fire-and-forget promise chains without wall-clock sleeps.
const flush = async () => {
    for (let i = 0; i < 20; i++) await Promise.resolve()
}

const memoryFixture = async (storage) => {
    let tick
    let cleared = false
    let disposed = 0
    const scope = await load("../config/opencode/plugins/compaction-memory/index.ts", {
        setInterval: (callback) => { tick = callback; return { unref() {} } },
        clearInterval: () => { cleared = true },
    })
    const cleanup = await scope.plugin.setup({
        storage,
        session: { hook: async () => ({ dispose: async () => { disposed++ } }) },
    })
    return { tick: () => tick(), cleanup, cleared: () => cleared, disposed: () => disposed }
}

test("Compaction memory prunes beyond the first page of fresh notes", async () => {
    const scans = []
    const removed = []
    const fixture = await memoryFixture({
        scan: async ({ after }) => {
            scans.push(after)
            return after === undefined
                ? { entries: Array.from({ length: 200 }, (_, i) => ({ key: `session/${i}`, value: { updated: Date.now() } })), next: "session/199" }
                : { entries: [{ key: "session/stale", value: { updated: 0 } }] }
        },
        remove: async (key) => removed.push(key),
    })
    fixture.tick()
    await flush()
    assert.deepEqual(scans, [undefined, "session/199"])
    assert.deepEqual(removed, ["session/stale"])
    await fixture.cleanup()
    assert.equal(fixture.cleared(), true)
    assert.equal(fixture.disposed(), 2)
})

test("Compaction memory prevents overlapping scans and stops on unload", async () => {
    let resolve
    let scans = 0
    const removed = []
    const fixture = await memoryFixture({
        scan: () => {
            scans++
            return new Promise((done) => { resolve = done })
        },
        remove: async (key) => removed.push(key),
    })
    fixture.tick()
    fixture.tick()
    assert.equal(scans, 1)
    await fixture.cleanup()
    resolve({ entries: [{ key: "session/stale", value: { updated: 0 } }], next: "more" })
    await flush()
    fixture.tick()
    assert.equal(scans, 1)
    assert.deepEqual(removed, [])
})

test("Compaction memory retries pruning after a failed scan", async () => {
    let scans = 0
    const fixture = await memoryFixture({
        scan: async () => { scans++; throw new Error("offline") },
    })
    fixture.tick()
    await flush()
    fixture.tick()
    await flush()
    assert.equal(scans, 2)
    await fixture.cleanup()
})
