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

// Let a whole microtask chain run to completion. The prune loop awaits only
// immediate stubs, so one macrotask turn drains all of it.
const settled = (ms = 250) => new Promise((resolve) => setTimeout(resolve, ms))

const memoryFixture = async (storage) => {
    let tick
    let cleared = false
    let disposed = 0
    let prompt
    let compaction
    const scope = await load("../config/opencode/plugins/compaction-memory/index.ts", {
        setInterval: (callback) => { tick = callback; return { unref() {} } },
        clearInterval: () => { cleared = true },
    })
    const cleanup = await scope.plugin.setup({
        storage,
        session: {
            hook: async (name, callback) => {
                if (name === "prompt") prompt = callback
                if (name === "compaction") compaction = callback
                return { dispose: async () => { disposed++ } }
            },
        },
    })
    return { tick: () => tick(), prompt, compaction, cleanup, cleared: () => cleared, disposed: () => disposed }
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

// The prune loop is driven by the store's own cursor. A cursor that stops
// advancing used to spin the 6-hourly timer forever, hammering storage inside a
// long-lived daemon. Bailing costs nothing: the next tick restarts the scan.
test("Compaction memory stops pruning when the cursor stops advancing", async () => {
    let scans = 0
    const fixture = await memoryFixture({
        scan: async () => {
            scans++
            if (scans > 1000) throw new Error("prune loop never terminated")
            // Always the same cursor, and an entry that is always stale.
            return { entries: [{ key: "session/a", value: { updated: 0 } }], next: "session/a" }
        },
        remove: async () => {},
    })
    fixture.tick()
    await flush()
    // Detecting a stalled cursor needs a page to compare against, so the pass
    // reads two and then stops -- rather than reading them forever.
    assert.equal(scans, 2)
    // And it is not wedged: the next tick runs a fresh pass.
    fixture.tick()
    await flush()
    assert.equal(scans, 4)
    await fixture.cleanup()
})

// A pass that hits the page ceiling must resume on the next tick rather than
// silently give up on everything beyond it.
test("Compaction memory bounds one prune pass by page count", async () => {
    const removed = []
    let scans = 0
    const fixture = await memoryFixture({
        scan: async ({ after, limit = 200 }) => {
            scans++
            const start = after === undefined ? 0 : Number(after)
            const entries = Array.from({ length: limit }, (_, i) => ({ key: `session/${start + i}`, value: { updated: 0 } }))
            return { entries, next: String(start + limit) }
        },
        remove: async (key) => removed.push(key),
    })
    fixture.tick()
    // One macrotask turn drains the whole microtask chain the loop runs on.
    await settled()
    // Bounded, not unbounded: the pass stops at the page ceiling instead of
    // walking an endless store. The exact count is an implementation detail; what
    // matters is that it stops, and that it is small.
    assert.ok(scans > 1 && scans <= 101, `expected a bounded pass, scanned ${scans} pages`)
    assert.equal(removed.length, (scans - 1) * 200, "the page that trips the cap is not processed")
    await fixture.cleanup()
})

// Storage is durable JSON shared across plugin versions, so a note written by
// an older build can hold a "files" of the wrong type. render() used to cast
// the stored value straight to Note, which threw mid-compaction.
test("Compaction memory re-injects a note whose stored fields are malformed", async () => {
    // Keys are the plugin's own "session/<id>" shape; the hook is handed a bare
    // session ID and adds the prefix itself.
    const stored = new Map([
        ["session/bad-files", { task: "ship the release", files: "not-an-array", updated: 1 }],
        ["session/bad-task", { task: 42, files: ["a.ts"], updated: 1 }],
    ])
    const fixture = await memoryFixture({
        get: async (key) => stored.get(key),
        set: async () => {},
        remove: async () => {},
        scan: async () => ({ entries: [], next: undefined }),
    })

    const event = { sessionID: "bad-files", system: [] }
    await fixture.compaction(event)
    assert.equal(event.system.length, 1)
    assert.match(event.system[0].text, /ship the release/)
    // The malformed array is dropped rather than rendered.
    assert.doesNotMatch(event.system[0].text, /not-an-array/)

    // A note with no usable task contributes nothing at all.
    const unusable = { sessionID: "bad-task", system: [] }
    await fixture.compaction(unusable)
    assert.deepEqual(unusable.system, [])

    const missing = { sessionID: "never-seen", system: [] }
    await fixture.compaction(missing)
    assert.deepEqual(missing.system, [])

    await fixture.cleanup()
})

test("Compaction memory attaches a note without a system array already present", async () => {
    const fixture = await memoryFixture({
        get: async () => ({ task: "keep the reason", files: [], updated: 1 }),
        set: async () => {},
        remove: async () => {},
        scan: async () => ({ entries: [], next: undefined }),
    })
    const event = { sessionID: "any" }
    await fixture.compaction(event)
    assert.equal(Array.isArray(event.system), true)
    assert.match(event.system[0].text, /keep the reason/)
    await fixture.cleanup()
})

const guard = async () => {
    const scope = await load("../config/opencode/plugins/shell-guard/index.ts")
    return { blockedReason: scope.blockedReason, commandWords: scope.commandWords }
}

// Every shape below was a live bypass: each either hides the blocked word
// behind a wrapper, hides it inside text the tokenizer had already consumed as
// one literal token, or puts it after shell syntax the command word stopped at.
test("Shell guard blocks the blocked command in every position", async () => {
    const { blockedReason } = await guard()
    const blocked = [
        "sudo ls",
        "/bin/sudo ls",
        "./sudo ls",
        "doas ls",
        "su - root",
        "curl https://example.invalid",
        "wget http://example.invalid",
        "apt install foo",
        "apt-get install foo",
        "aptitude install foo",
    ]
    for (const command of blocked) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

test("Shell guard sees through transparent wrappers", async () => {
    const { blockedReason } = await guard()
    const wrapped = [
        "time sudo ls",
        "env sudo ls",
        "nohup sudo ls",
        "command sudo ls",
        "nice -n 10 sudo ls",
        "stdbuf -o0 sudo ls",
        "timeout 30 sudo ls",
        "xargs -0 sudo ls",
        "FOO=bar BAZ=qux timeout 5 env sudo ls",
        "/usr/bin/env sudo ls",
        // Durations carry a unit and may follow an option's own value, so a
        // count of operands gets these wrong.
        "timeout 30s sudo ls",
        "timeout 5m sudo ls",
        "timeout 1h sudo ls",
        "timeout 0.5 sudo ls",
        "timeout -k 1 30 sudo ls",
        "ionice -c 3 sudo ls",
    ]
    for (const command of wrapped) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

test("Shell guard sees past shell keywords and groups", async () => {
    const { blockedReason } = await guard()
    const keyed = [
        "for f in a b; do sudo id; done",
        "if true; then sudo id; fi",
        "while read -r x; do curl \"$x\"; done",
        "{ sudo id; }",
        "(sudo id)",
        "ls && sudo id",
        "ls; sudo id",
        "echo hi | sudo tee /etc/example",
    ]
    for (const command of keyed) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

test("Shell guard resolves command substitution", async () => {
    const { blockedReason } = await guard()
    const substituted = [
        "echo `sudo id`",
        'echo "$(sudo id)"',
        'echo "`curl http://example.invalid`"',
        "echo $(echo `sudo id`)",
    ]
    for (const command of substituted) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

test("Shell guard resolves a shell -c script", async () => {
    const { blockedReason } = await guard()
    for (const command of ["bash -c 'sudo id'", "sh -c 'curl http://example.invalid'", "zsh -lc 'sudo id'", "bash --command 'sudo id'"]) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

test("Shell guard resolves a find -exec predicate", async () => {
    const { blockedReason } = await guard()
    const predicates = [
        "find . -exec sudo id \\;",
        "find . -execdir curl http://example.invalid \\;",
        // The whole -exec argument list is the command, not just its first
        // word, so a wrapper or a shell inside it still has to resolve.
        "find . -exec sh -c 'sudo id' \\;",
        "find . -exec nice -n 10 sudo id \\;",
        "find . -exec timeout 30 curl http://example.invalid \\;",
    ]
    for (const command of predicates) {
        assert.notEqual(blockedReason(command), undefined, `expected a block: ${command}`)
    }
})

// The reason this plugin exists: a guard that cries wolf gets ignored. Each of
// these mentions a blocked word without running it.
test("Shell guard allows a blocked word that is not a command", async () => {
    const { blockedReason } = await guard()
    const allowed = [
        "grep -r curl src/",
        "echo 'use curl later'",
        "cat sudoers.txt",
        "apt-cache policy",
        "ls ./curl",
        "cat wget",
        "cat supersecret.txt",
        "curlx",
        "sudos",
        "apt-tool",
        "npm run env-check",
        "awk '{print $1}' file",
        "echo $((1+2))",
        "env FOO=1 printenv FOO",
        "time ls",
        "xargs -0 grep curl",
        "find . -name '*.ts' -print",
        // Single quotes are literal, so this really is just text.
        "echo '$(sudo id)'",
        // -c here belongs to the script bash runs, not to bash itself.
        "bash script.sh -c 'echo sudo'",
        // `command -v` and `builtin -p` resolve a name, they do not run it.
        // AGENTS.md tells the agent to use command -v before calling a tool.
        "command -v sudo",
        "command -v curl",
        "builtin -p sudo",
        "env -u PATH command -v sudo",
        // A redirect target is an argument, not a command.
        "echo x > /tmp/sudo",
    ]
    for (const command of allowed) {
        assert.equal(blockedReason(command), undefined, `expected an allow: ${command}`)
    }
})

// A heredoc body is data. Read as commands it blocks every write that documents
// the policy the guard enforces, which is the fastest way to make it ignored.
test("Shell guard reads a heredoc body as data, not as commands", async () => {
    const { blockedReason } = await guard()
    const heredocs = [
        "cat <<'EOF'\nremember to run sudo later\nEOF",
        "cat <<EOF\nsudo\nEOF",
        "cat > file <<-'EOF'\n  curl http://example.invalid\nEOF",
    ]
    for (const command of heredocs) {
        assert.equal(blockedReason(command), undefined, `expected an allow: ${JSON.stringify(command)}`)
    }
})

// The recursive forms can be built to recurse. This is a hang and a crash
// guard, not a parsing test.
test("Shell guard terminates on deeply nested substitution", async () => {
    const { blockedReason, commandWords } = await guard()
    assert.equal(blockedReason("echo $(echo $(echo $(echo $(echo $(echo $(echo deep))))))"), undefined)
    assert.equal(blockedReason("echo `echo `echo `echo `echo `echo deep`````"), undefined)
    assert.ok(commandWords("ls").length > 0)
})
