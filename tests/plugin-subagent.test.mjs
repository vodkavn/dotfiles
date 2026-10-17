import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run panel.ts with no opencode at all; nothing here contacts a service.
//
// tui.tsx is absent by construction: JSX needs opencode's transform, so the
// decisions a row makes -- which sessions are subagents of which, in what order,
// which of them are still running, how long ago, what a status name is, how wide
// a line may get -- live in panel.ts and are exercised here. See
// plugin-layout.test.mjs for the rule that keeps them there.

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

const { buildRows, childrenOf, elapsed, isRunning, rowBody, rowHead, runningRows, spinFrame, SPIN_FRAMES, SPIN_MS, statusName } = await load(
    "../config/opencode/plugins/subagent-watch/panel.ts",
)

// Measured against opencode v2.0.28: a 42-column sidebar box, 2 columns of
// padding either side, and one more on the right from the box that carries the
// sidebar.content slot. Pinned here rather than imported, so a change to the
// plugin's constant has to be made deliberately in two places -- the plugin must
// not be the only thing that agrees with itself.
const SIDEBAR_BOX = 42
const SIDEBAR_PADDING = 2
const SLOT_PADDING = 1
const WIDTH = SIDEBAR_BOX - 2 * SIDEBAR_PADDING - SLOT_PADDING

// A fixed clock, so no assertion depends on the wall clock.
const AT = 1_000_000
const MINUTE = 60_000

// One store, described the way opencode describes it: a flat family list plus a
// per-session record carrying parentID and time.
const tree = (current, sessions, running = []) => {
    const byID = new Map(sessions.map((session) => [session.id, session]))
    return {
        current,
        family: sessions.map((session) => session.id),
        info: (id) => byID.get(id),
        running: (id) => running.includes(id),
    }
}

const session = (id, parentID, extra = {}) => ({
    id,
    parentID,
    agent: "reviewer",
    title: id,
    time: { created: AT, updated: AT },
    ...extra,
})

// Arrays built inside the vm carry that realm's Array prototype, which
// assert.deepStrictEqual rejects even when the contents match. Array.from
// re-enters this realm, so the assertions below stay ordinary ones.
const ids = (source) => Array.from(buildRows(source), (row) => row.id)
const shape = (source) => Array.from(buildRows(source), (row) => [row.id, row.depth])

test("A session lists its newest subagents first", () => {
    const source = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_old", "ses_root", { time: { created: AT + MINUTE, updated: AT } }),
        session("ses_new", "ses_root", { time: { created: AT + 2 * MINUTE, updated: AT } }),
    ])
    assert.deepEqual(ids(source), ["ses_new", "ses_old"])
})

test("A subagent with no created time sorts to the bottom rather than the top", () => {
    // clock() yields 0 for an absent or unreadable time, and descending order
    // would otherwise put "unknown" above every real session.
    const source = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_undated", "ses_root", { time: {} }),
        session("ses_dated", "ses_root", { time: { created: AT, updated: AT } }),
    ])
    assert.deepEqual(ids(source), ["ses_dated", "ses_undated"])
})

test("The session on screen is never listed as its own subagent", () => {
    // opencode's own list subtracts the session from family(); that same
    // subtraction is what would report ses_root as a child of ses_a once you
    // have clicked into one.
    const inside = tree("ses_a", [
        session("ses_root", undefined),
        session("ses_a", "ses_root"),
        session("ses_b", "ses_root"),
    ])
    assert.deepEqual(ids(inside), [])

    const root = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_a", "ses_root"),
        session("ses_b", "ses_root"),
    ])
    assert.deepEqual(ids(root), ["ses_a", "ses_b"])
})

test("A parent outside the family is not a child of anything on screen", () => {
    // family() is keyed on the root of the session, so a stale entry can name a
    // parent that was never returned. Following it would walk out of the tree.
    const source = tree("ses_a", [session("ses_a", "ses_root"), session("ses_ghost", "ses_root")])
    assert.deepEqual(ids(source), [])
})

test("A nested subagent is indented under the one that spawned it", () => {
    const source = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_a", "ses_root", { time: { created: AT, updated: AT } }),
        session("ses_b", "ses_root", { time: { created: AT + MINUTE, updated: AT } }),
        session("ses_c", "ses_a", { time: { created: AT + 2 * MINUTE, updated: AT } }),
    ])
    assert.deepEqual(shape(source), [
        ["ses_b", 1],
        ["ses_a", 1],
        ["ses_c", 2],
    ])
})

test("A family listing the same session twice draws one row, not two", () => {
    // What a re-remembered session looks like before the store coalesces it.
    // Both copies pass the push-time test, so the pop-time one is what holds.
    const twice = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_a", "ses_root"),
        session("ses_a", "ses_root"),
    ])
    assert.deepEqual(ids(twice), ["ses_a"])
})

test("A family entry with no record, or a self-parent, is dropped", () => {
    const broken = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_orphan", "ses_root"),
        session("ses_loop", "ses_loop"),
    ])
    broken.info = (id) => (id === "ses_loop" ? { parentID: "ses_loop" } : undefined)
    assert.deepEqual(ids(broken), [])
})

test("A session with no subagents produces no rows at all", () => {
    assert.deepEqual(ids(tree(undefined, [])), [])
    assert.deepEqual(ids(tree("ses_root", [session("ses_root", undefined)])), [])
})

test("A running subagent reports time since it started, a finished one its duration", () => {
    const source = tree(
        "ses_root",
        [
            session("ses_root", undefined),
            session("ses_live", "ses_root", { time: { created: AT, updated: AT } }),
            session("ses_done", "ses_root", {
                time: { created: AT, updated: AT + 90 * MINUTE, idle: AT + 90 * MINUTE },
            }),
        ],
        ["ses_live"],
    )
    const [live, done] = buildRows(source)
    assert.equal(live.running, true)
    assert.equal(elapsed(live, AT + 12_000), "12s")
    assert.equal(elapsed(done, AT + 10 * MINUTE), "1h+")
})

test("Only running subagents are listed, so a finished one disappears", () => {
    // buildRows still describes the whole tree; runningRows is the section's
    // filter, applied after the walk rather than inside it.
    const source = tree(
        "ses_root",
        [session("ses_root", undefined), session("ses_live", "ses_root"), session("ses_done", "ses_root")],
        ["ses_live"],
    )
    assert.deepEqual(ids(source), ["ses_live", "ses_done"])
    assert.deepEqual(Array.from(runningRows(buildRows(source)), (row) => row.id), ["ses_live"])
})

test("A running subagent under a finished parent is still listed", () => {
    // Dropping the subtree under a stopped parent would hide work that is
    // genuinely in flight, so the grandchild is kept at its own depth.
    const source = tree(
        "ses_root",
        [
            session("ses_root", undefined),
            session("ses_a", "ses_root"),
            session("ses_c", "ses_a", { time: { created: AT + MINUTE, updated: AT } }),
        ],
        ["ses_c"],
    )
    assert.deepEqual(Array.from(runningRows(buildRows(source)), (row) => [row.id, row.depth]), [["ses_c", 2]])
})

test("No running subagent leaves the section with nothing to draw", () => {
    const source = tree("ses_root", [session("ses_root", undefined), session("ses_done", "ses_root")])
    assert.equal(runningRows(buildRows(source)).length, 0)
})

test("Age goes coarse and caps, so a stuck subagent is four characters", () => {
    const row = { depth: 1, id: "x", agent: "a", title: "", running: true, startedAt: AT, finishedAt: 0 }
    assert.equal(elapsed(row, AT + 45_000), "45s")
    assert.equal(elapsed(row, AT + 2 * MINUTE), "2m")
    assert.equal(elapsed(row, AT + 59 * MINUTE), "59m")
    assert.equal(elapsed(row, AT + 90 * MINUTE), "1h+")
    assert.equal(elapsed(row, AT + 3 * 60 * MINUTE), "2h+")
    assert.equal(elapsed(row, AT + 9 * 24 * 60 * MINUTE), "2h+")
})

test("A subagent with no clock at all reports no age rather than a wrong one", () => {
    const source = tree("ses_root", [session("ses_root", undefined), session("ses_a", "ses_root", { time: {} })])
    assert.equal(elapsed(buildRows(source)[0], AT), "")
})

test("A status is read as a name from either shape, and an absent one is not a throw", () => {
    // What the CLI store returns, verified against opencode v2.0.28.
    assert.equal(statusName("running"), "running")
    assert.equal(statusName("idle"), "idle")
    // What the server's session.status event carries, in case a host hands the
    // object through instead of the name.
    assert.equal(statusName({ type: "busy" }), "busy")
    assert.equal(statusName({ kind: "retry" }), "retry")

    // Absent or unreadable. This is the shape that used to throw a TypeError
    // from inside the render loop and take the whole sidebar down with it.
    assert.equal(statusName(undefined), "")
    assert.equal(statusName(null), "")
    assert.equal(statusName({}), "")
    assert.equal(statusName(42), "")

    assert.equal(isRunning("running"), true)
    assert.equal(isRunning({ type: "busy" }), true)
    assert.equal(isRunning("idle"), false)
    assert.equal(isRunning(""), false)
    assert.equal(isRunning(undefined), false)
})

test("The head line names the agent and the age, the body line the task", () => {
    const source = tree(
        "ses_root",
        [
            session("ses_root", undefined),
            session("ses_a", "ses_root", {
                agent: "general",
                title: "Investigate the deeply nested config drift in the plugin tree",
                time: { created: AT, updated: AT },
            }),
        ],
        ["ses_a"],
    )
    const row = buildRows(source)[0]
    const head = rowHead(row, AT + 5 * MINUTE)
    const body = rowBody(row)

    // The two fields you scan for are on the line the title cannot crowd out.
    // The head carries a spinner frame rather than a bullet, and the title sits
    // one step in, under the agent name rather than under the glyph.
    assert.equal(head, `${spinFrame(AT + 5 * MINUTE)} general 5m`)
    assert.equal(body, "  Investigate the deeply nested conf…")
    assert.ok(Array.from(head).length <= WIDTH, head)
    assert.ok(Array.from(body).length <= WIDTH, body)
})

test("A row with no title is one line, and a nameless agent falls back", () => {
    const source = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_a", "ses_root", { agent: "", title: "", time: { created: AT, updated: AT } }),
    ])
    const row = buildRows(source)[0]
    assert.equal(rowHead(row, AT), "○ agent")
    assert.equal(rowBody(row), "", "no title means no second line, not a blank one")
})

test("A row with no age draws its head alone, with no trailing space", () => {
    const row = { depth: 1, id: "x", agent: "general", title: "", running: false, startedAt: 0, finishedAt: 0 }
    const head = rowHead(row, AT)
    assert.equal(head, "○ general")
    assert.equal(head, head.trimEnd(), "an unknown age must not leave a dangling space")
})

test("A nested row is indented, and a deep one stops indenting", () => {
    // Depth 1 is flush with the section marker, so the indent a row shows is one
    // step per level of nesting below it.
    const row = { depth: 9, id: "x", agent: "general", title: "", running: true, startedAt: 0, finishedAt: 0 }
    assert.equal(rowHead(row, AT), `        ${spinFrame(AT)} general`)
    assert.equal(rowHead({ ...row, depth: 2 }, AT), `  ${spinFrame(AT)} general`)
    assert.equal(rowHead({ ...row, depth: 1 }, AT), `${spinFrame(AT)} general`)
})

test("A running subagent turns a spinner frame instead of a bullet", () => {
    const source = tree(
        "ses_root",
        [session("ses_root", undefined), session("ses_a", "ses_root", { title: "" })],
        ["ses_a"],
    )
    const head = rowHead(buildRows(source)[0], AT)
    assert.equal(head, `${spinFrame(AT)} reviewer`)
    assert.ok(SPIN_FRAMES.includes(head[0]), `expected a frame, got ${head[0]}`)
})

test("The spinner advances on its own clock and wraps", () => {
    // A counter would keep the animation smooth across a dropped repaint; a
    // clock keeps it honest, which is why the same instant always draws the same
    // frame and one frame period later it does not.
    assert.notEqual(spinFrame(AT), spinFrame(AT + SPIN_MS))
    assert.equal(spinFrame(AT), spinFrame(AT + SPIN_MS * SPIN_FRAMES.length))
    for (let step = 0; step < SPIN_FRAMES.length * 3; step++) {
        assert.ok(SPIN_FRAMES.includes(spinFrame(AT + step * SPIN_MS)), `step ${step}`)
    }
})

test("A clock that is not an instant still yields a frame rather than undefined", () => {
    // spinFrame is on the render path, where a wrong glyph is survivable and a
    // throw is not.
    assert.equal(spinFrame(Number.NaN), SPIN_FRAMES[0])
    assert.equal(spinFrame(Number.POSITIVE_INFINITY), SPIN_FRAMES[0])
    assert.equal(spinFrame(-1), SPIN_FRAMES[0])
})

test("A long agent name is clipped rather than overflowing the sidebar", () => {
    // The head line has no title to spend its budget on, so the agent name is
    // the only thing that can push a row past the width.
    const row = { depth: 4, id: "x", agent: "a".repeat(60), title: "", running: false, startedAt: 0, finishedAt: 0 }
    const head = rowHead(row, AT)
    assert.ok(Array.from(head).length <= WIDTH, head)
    assert.ok(head.endsWith("…"), head)
})

test("A long title is clipped on its own line, whatever the agent costs", () => {
    const row = {
        depth: 1,
        id: "x",
        agent: "explore",
        title: "x".repeat(200),
        running: false,
        startedAt: 0,
        finishedAt: 0,
    }
    assert.ok(Array.from(rowBody(row)).length <= WIDTH, rowBody(row))
    assert.ok(rowBody(row).endsWith("…"), rowBody(row))
})

test("childrenOf returns the direct children the walk is built on", () => {
    const source = tree("ses_root", [
        session("ses_root", undefined),
        session("ses_a", "ses_root"),
        session("ses_b", "ses_a"),
    ])
    assert.deepEqual(Array.from(childrenOf(source, "ses_root")), ["ses_a"])
    assert.deepEqual(Array.from(childrenOf(source, "ses_b")), [])
})

test("The walk reads the store a bounded number of times per session", () => {
    // buildRows runs on every repaint, and its source is a live store read in
    // the real plugin. Counting the calls pins that without a wall-clock
    // assertion, which would only ever measure this stub.
    const wide = new Map([["ses_root", session("ses_root", undefined)]])
    for (let n = 0; n < 500; n++) {
        wide.set(`ses_${n}`, session(`ses_${n}`, "ses_root", { time: { created: AT + n, updated: AT } }))
    }

    let reads = 0
    const source = {
        current: "ses_root",
        family: [...wide.keys()],
        info: (id) => {
            reads += 1
            return wide.get(id)
        },
        running: () => false,
    }

    assert.equal(buildRows(source).length, 500)
    // 500 to link parentID, 500 to read the sort key, 500 to describe a row.
    // A comparator that reached for source.info() would add roughly
    // 2 * 500 * log2(500), so about 9,000 reads instead of 1,500.
    assert.ok(reads <= 1_700, `${reads} store reads for 500 subagents`)
})
