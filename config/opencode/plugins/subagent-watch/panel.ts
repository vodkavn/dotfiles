// The subagent list, as data.
//
// Kept out of tui.tsx for the same reason inspector's drift.ts is separate from
// its panel: node can load a plain module and call its exports, but JSX needs
// opencode's transform. plugin-layout.test.mjs enforces the split.
//
// Everything here takes what it needs as arguments and returns rows. Nothing in
// this module reaches for opencode, so a test can describe a session tree and
// check the shape that comes back without a terminal or a running service.

export type Row = {
    id: string
    // 1 for a subagent of the session on screen, 2 for a subagent of that, and
    // so on. A subagent is not supposed to delegate, but the tree does not
    // forbid it and the depth is what the indent draws from.
    depth: number
    agent: string
    title: string
    running: boolean
    startedAt: number
    // 0 while running. Otherwise the moment the subagent went idle, or its last
    // update when the server never recorded an idle for it.
    finishedAt: number
}

// What the caller can tell the panel about the session on screen. Passed in
// rather than reached for, which is the only reason this file has no import.
export type Tree = {
    current: string | undefined
    family: readonly string[]
    info: (id: string) => unknown
}

// A Tree plus the one live reading the panel cannot make from stored info.
export type Source = Tree & { running: (id: string) => boolean }

// How wide one line may get.
//
// Measured against opencode v2.0.28 rather than derived: the sidebar box is a
// fixed 42 columns with 2 columns of padding on each side, and the box that
// carries the sidebar.content slot adds one more on the right. That leaves 37 to
// draw in, and a line budgeted at the box width loses the ellipsis to the host's
// clip -- or, before the text elements were given wrapMode="none", wrapped and
// turned every two-line row into three.
//
// The width is not exposed to a sidebar.content slot -- its input carries only
// sessionID -- so this is a constant rather than a measurement, and the test
// pins the arithmetic. It is a preference, not a correctness requirement:
// wrapMode="none" means a wrong constant costs the ellipsis, never the layout.
const WIDTH = 42 - 2 - 2 - 1
const ELLIPSIS = "…"

// Code points, not UTF-16 units. A title cut mid-surrogate renders as a
// replacement character, which is worse than the ellipsis it replaced.
const size = (value: string): number => Array.from(value).length
const clip = (value: string, limit: number): string => Array.from(value).slice(0, limit).join("")

const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

const text = (value: unknown): string => (typeof value === "string" ? value : "")

const clock = (value: unknown): number =>
    typeof value === "number" && Number.isFinite(value) && value > 0 ? value : 0

// parentID -> the children the family map can prove.
//
// opencode's own subagent list is `family(sessionID)` minus the session itself,
// which is only right while the session on screen is the root of the family;
// once you have clicked into a subagent, the same subtraction reports the
// *parent* as a child. Linking on parentID instead costs one map and stays
// correct at any depth.
//
// A link is kept only when the parent is also in the family, so the walk cannot
// escape the subtree it was given.
const links = (source: Tree): Map<string, string[]> => {
    const children = new Map<string, string[]>()
    if (source.current === undefined) return children

    const known = new Set(source.family)
    for (const id of source.family) {
        if (id === source.current) continue
        const parent = text(record(source.info(id)).parentID)
        if (parent === "" || !known.has(parent)) continue
        const bucket = children.get(parent)
        if (bucket === undefined) children.set(parent, [id])
        else bucket.push(id)
    }

    // Newest first, so the subagent just delegated is the one at the top rather
    // than the one you have already read.
    //
    // Sorted on a decorated array rather than by a comparator that re-reads the
    // store. source.info() is context.data.session.get() in the real plugin, and
    // a comparator calls it ~2·n·log2(n) times for a bucket of n -- tens of
    // thousands of store reads per repaint at a few thousand children, against
    // one pass for the loop above. The created time is read once per child here.
    const created = new Map<string, number>()
    for (const bucket of children.values()) {
        for (const id of bucket) created.set(id, clock(record(record(source.info(id)).time).created))
        bucket.sort((a, b) => (created.get(b) ?? 0) - (created.get(a) ?? 0))
    }
    return children
}

// Exported because the sync in tui.tsx needs the same link the walk uses.
// family() lists the whole root family, so syncing "everything in family(id)"
// would refetch siblings the walk would discard anyway.
export const childrenOf = (source: Tree, id: string): readonly string[] => links(source).get(id) ?? []

const describe = (source: Source, id: string, depth: number): Row => {
    const info = record(source.info(id))
    const running = source.running(id)
    const times = record(info.time)
    return {
        id,
        depth,
        // Names here are read defensively: a session with no agent set is a
        // real shape, and "agent" beats an empty row.
        agent: text(info.agent) === "" ? "agent" : text(info.agent),
        title: text(info.title),
        running,
        startedAt: clock(times.created),
        finishedAt: running ? 0 : clock(times.idle) || clock(times.updated),
    }
}

export const buildRows = (source: Source): Row[] => {
    const rows: Row[] = []
    if (source.current === undefined) return rows

    const children = links(source)
    // Depth-first over an explicit stack. The `seen` test is on the pop, not the
    // push, and what it guards is a family that lists the same session twice --
    // which is what a re-remembered session looks like before the store
    // coalesces it. Both copies pass the push-time test (neither is marked yet),
    // so without the pop-time test the row would be drawn twice.
    //
    // A parentID *cycle* is not what this defends against, because there cannot
    // be one: links() only draws an edge when a child names that parent, so
    // every node has exactly one parent, and a set of nodes forming a cycle is
    // unreachable from `current` by construction. The test is cheap and stays,
    // but the duplicate is the case that actually occurs.
    const seen = new Set<string>([source.current])
    const stack: { id: string; depth: number }[] = [{ id: source.current, depth: 0 }]

    while (stack.length > 0) {
        const step = stack.pop()
        if (step === undefined) break
        if (step.depth > 0) {
            if (seen.has(step.id)) continue
            seen.add(step.id)
            rows.push(describe(source, step.id, step.depth))
        }
        const bucket = children.get(step.id)
        if (bucket === undefined) continue
        // Reversed, because the stack pops from the end and a depth-first walk
        // has to take this level's oldest child next.
        for (let index = bucket.length - 1; index >= 0; index--) {
            const child = bucket[index]
            if (!seen.has(child)) stack.push({ id: child, depth: step.depth + 1 })
        }
    }

    return rows
}

// Only the subagents that are still going.
//
// The section is a monitor, not a transcript. A finished subagent is history you
// read in the session list; what this list is for is answering "what is running
// right now, and for how long". Keeping the finished rows pushed the live ones
// down the sidebar and filled the section with `○` lines that never changed
// again, so the one row worth watching was the one hardest to find.
//
// The filter is applied to the rows, not to the walk: a running subagent whose
// parent has finished is still drawn, because dropping the subtree under a
// stopped parent would hide work that is genuinely in flight. Its indent is
// then deeper than anything visible above it, which is the lesser oddity -- a
// missing row is worse than one drawn at the wrong depth.
export const runningRows = (rows: readonly Row[]): Row[] => rows.filter((row) => row.running)

// How long something has been going, at the coarsest unit that still says
// something. Sub-second is noise; past an hour it is stuck rather than slow,
// and "2h+" says that in four characters where "2h 14m" reads like a duration
// worth planning around.
export const elapsed = (row: Row, now: number): string => {
    const end = row.running ? now : row.finishedAt
    if (row.startedAt <= 0 || end <= row.startedAt) return ""
    const seconds = Math.max(0, Math.min(Math.round((end - row.startedAt) / 1000), 7200))
    if (seconds < 60) return `${seconds}s`
    const minutes = Math.round(seconds / 60)
    if (minutes < 60) return `${minutes}m`
    return minutes < 120 ? "1h+" : "2h+"
}

// The status a session is in, as a name.
//
// context.data.session.status() returns the status *name* -- "running" or
// "idle" -- while the server's session.status event carries an object with a
// `type`. Reading `.type` off the name yields undefined, indistinguishable from
// "no status"; reading a name off the object yields the same. Both shapes are
// accepted here rather than trusting one.
//
// Anything absent yields "" rather than throwing. A session the store has never
// seen has no status, and a TypeError raised here is thrown from inside the
// render loop, which takes the whole sidebar down rather than this one section.
export const statusName = (value: unknown): string => {
    if (typeof value === "string") return value
    const entry = record(value)
    const named = entry.type ?? entry.kind
    return typeof named === "string" ? named : ""
}

export const isRunning = (value: unknown): boolean => {
    const name = statusName(value)
    return name !== "" && name !== "idle"
}

// The spinner that stands in for a running subagent's bullet.
//
// The same braille set provider-usage turns, repeated here rather than imported:
// opencode bundles a plugin directory's sibling files into one scope, and one
// directory's constants are not another's to reach for.
export const SPIN_FRAMES: readonly string[] = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"]

// One frame per SPIN_MS of wall clock, which is also the period tui.tsx repaints
// at while a row is on screen.
//
// The frame is picked from the clock rather than from a counter of repaints, so
// a coalesced or dropped repaint skips a frame instead of desyncing the
// animation from real time, and every row in one paint shows the same frame.
export const SPIN_MS = 120

// The frame due at `now`. A clock that is not a real instant yields the first
// frame rather than the string "undefined": this is called from the render path,
// where a wrong glyph is survivable and a throw is not.
export const spinFrame = (now: number): string => {
    if (!Number.isFinite(now) || now < 0) return SPIN_FRAMES[0]
    return SPIN_FRAMES[Math.floor(now / SPIN_MS) % SPIN_FRAMES.length]
}

// The row, as two lines.
//
// Line one carries identity -- state, agent, age -- and line two carries what
// the subagent was asked to do. Splitting them is not cosmetic: a single line
// truncating to a sidebar width spends its budget on the title, which is the
// one field you do not scan for, and drops the two you do.
//
// depth is 1-based, and the top level draws flush with the section header's
// marker: the spinner is that row's bullet rather than a thing indented under a
// label, so nesting is what adds indentation and depth 1 adds none. The clamp
// stops a deep tree from pushing the text off the side of a narrow sidebar, and
// it is the same ceiling as before the base indent was removed.
const indentOf = (row: Row): string => "  ".repeat(Math.max(0, Math.min(row.depth - 1, 4)))

// Line one: a spinner frame while the subagent is running, a hollow mark once it
// is finished, then the agent and the age. The glyph is drawn in the row's colour
// rather than as a cell of its own, because a clickable row has to be a single
// box holding a single text for the whole line to be one target.
//
// The frame comes from `now` rather than from state: tui.tsx repaints on the
// spinner's clock while a row is drawn, so reading the clock here is what makes
// the glyph turn, and there is no frame variable anyone can forget to advance.
export const rowHead = (row: Row, now: number): string => {
    const head = `${indentOf(row)}${row.running ? spinFrame(now) : "○"} ${row.agent}`
    const age = elapsed(row, now)
    const line = age === "" ? head : `${head} ${age}`
    return size(line) > WIDTH ? `${clip(line, Math.max(0, WIDTH - 1)).trimEnd()}${ELLIPSIS}` : line
}

// Line two: the task, indented one step under the agent it belongs to. Empty
// when opencode never gave the session a title, in which case the row is one
// line rather than a blank one.
export const rowBody = (row: Row): string => {
    if (row.title === "") return ""
    const indent = `${indentOf(row)}  `
    const budget = WIDTH - size(indent)
    if (size(row.title) > budget) {
        return `${indent}${clip(row.title, Math.max(0, budget - 1)).trimEnd()}${ELLIPSIS}`
    }
    return `${indent}${row.title}`
}
