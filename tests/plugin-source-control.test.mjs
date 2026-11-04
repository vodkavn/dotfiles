import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run panel.ts and git.ts's pure parser with no opencode, no git, and no
// service. Both modules are loaded the same way: types stripped by node, the
// import removed, and the exports collected.
//
// The parser is the part worth pinning. The fixtures below are real
// `git status --porcelain=v2 --branch -z` output, captured from git 2.43 --
// not hand-written -- because the field counts and the NUL framing are exactly
// the details a hand-written fixture gets wrong in the direction of passing.

const load = async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            .replace(/^import .*$/gm, "")
            .replace(/^export /gm, "") +
        `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({})
    vm.runInContext(code, scope)
    return scope.exports
}

const git = await load("../config/opencode/plugins/source-control/git.ts")
const panel = await load("../config/opencode/plugins/source-control/panel.ts")

// Values built inside the vm context carry that realm's prototypes, which
// deepEqual refuses to compare against this realm's. Round-tripping through
// JSON puts everything back in this one. Same helper the sibling plugin tests
// use, for the same reason.
const plain = (value) => JSON.parse(JSON.stringify(value))

// One modified file, one added, one rename, one untracked, and one with a space
// in its path. The records are copied from real `git status --porcelain=v2
// --branch -z` output on git 2.43, trimmed only of the object ids. A record has
// **two** 40-character hashes before the path, not one -- hand-writing this
// fixture is how that gets wrong.
const FIXTURE = [
    "# branch.oid 52b676ac13c86a23ec23d685b80f97e80105c654",
    "# branch.head main",
    "# branch.upstream origin/main",
    "# branch.ab +2 -1",
    "1 .M N... 100644 100644 100644 5626abf0f72e58d7a153368ba57db4c673c0e171 5626abf0f72e58d7a153368ba57db4c673c0e171 a.txt",
    "1 A. N... 000000 100644 100644 0000000000000000000000000000000000000000 587be6b4c3f93f93c489c0111bba5596147a26cb d/e.txt",
    "2 R. N... 100644 100644 100644 79c53955ef856f16f2107446bc721c8879a1bd2e 79c53955ef856f16f2107446bc721c8879a1bd2e R100 sub/renamed.txt",
    "sub/b.txt",
    "1 .M N... 100644 100644 100644 b68025345d5301abad4d9ec9166f455243a0d746 b68025345d5301abad4d9ec9166f455243a0d746 with space.txt",
    "? c.txt",
].join("\u0000")

test("branch headers are read, including upstream and drift", () => {
    const status = git.parseStatus("/repo", "repo", 0, FIXTURE)
    assert.equal(status.branch.name, "main")
    assert.equal(status.branch.upstream, "origin/main")
    assert.equal(status.branch.ahead, 2)
    assert.equal(status.branch.behind, 1)
})

test("a branch with no upstream omits it rather than inventing one", () => {
    const status = git.parseStatus("/repo", "repo", 0, "# branch.head main\u0000")
    assert.equal(status.branch.name, "main")
    assert.equal(status.branch.upstream, undefined)
    assert.equal(status.branch.ahead, 0)
})

test("each record kind becomes a change with the working-tree letter", () => {
    const changes = git.parseStatus("/repo", "repo", 0, FIXTURE).changes
    const byPath = new Map(changes.map((change) => [change.path, change]))
    assert.equal(byPath.get("a.txt").status, "M")
    assert.equal(byPath.get("d/e.txt").status, "A")
    assert.equal(byPath.get("c.txt").status, "?")
})

test("a rename carries its original path and consumes its own record", () => {
    const changes = git.parseStatus("/repo", "repo", 0, FIXTURE).changes
    const renamed = changes.find((change) => change.path === "sub/renamed.txt")
    assert.equal(renamed.status, "R")
    assert.equal(renamed.from, "sub/b.txt")
    // The original path must not survive as a change of its own.
    assert.equal(changes.some((change) => change.path === "sub/b.txt"), false)
})

test("the index and working-tree columns are kept apart", () => {
    // `1 .M` -- modified in the tree only, so it is staged-not and unstaged-yes.
    const unstaged = git.parseStatus("/repo", "repo", 0, "1 .M N... 100644 100644 100644 aaa bbb a.txt\u0000").changes[0]
    assert.equal(unstaged.index, "none")
    assert.equal(unstaged.worktree, "modified")

    // `1 AM` -- added to the index, modified again since. Both, which is the
    // case one boolean got wrong.
    const both = git.parseStatus("/repo", "repo", 0, "1 AM N... 100644 100644 100644 aaa bbb a.txt\u0000").changes[0]
    assert.equal(both.index, "added")
    assert.equal(both.worktree, "modified")

    // A rename is staged by construction; --no-index and untracked never are.
    const renamed = git.parseStatus("/repo", "repo", 0, "2 R. N... 100644 100644 100644 aaa bbb R100 new.txt\u0000old.txt\u0000").changes[0]
    assert.equal(renamed.index, "renamed")
    assert.equal(renamed.worktree, "none")

    const untracked = git.parseStatus("/repo", "repo", 0, "? new.txt\u0000").changes[0]
    assert.equal(untracked.index, "none")
    assert.equal(untracked.worktree, "untracked")
})

test("a path containing a space is kept verbatim", () => {
    // The reason for v2 -z over v1: v1 would quote or percent-encode this.
    const changes = git.parseStatus("/repo", "repo", 0, FIXTURE).changes
    assert.ok(changes.some((change) => change.path === "with space.txt"))
})

test("changes are sorted so an unchanged tree yields identical rows", () => {
    const first = plain(git.parseStatus("/repo", "repo", 0, FIXTURE).changes.map((change) => change.path))
    const second = plain(git.parseStatus("/repo", "repo", 0, FIXTURE).changes.map((change) => change.path))
    assert.deepEqual(first, second)
    assert.deepEqual(first, [...first].sort())
})

test("the section header counts every change across repositories", () => {
    const rows = panel.buildRows([
        { repo: { root: "/a", label: "a", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [{ path: "x", status: "M" }] },
        { repo: { root: "/b", label: "b", depth: 1 }, branch: { name: "dev", ahead: 0, behind: 0 }, changes: [{ path: "y", status: "?" }, { path: "z", status: "A" }] },
    ])
    assert.equal(panel.totalChanges(rows), 3)
})

test("drift arrows are drawn only in the direction that has drift", () => {
    const row = { root: "/a", label: "a", branch: "main", ahead: 2, behind: 0, changes: [] }
    assert.equal(panel.branchLine(row), "main ↑2")
    assert.equal(panel.branchLine({ ...row, ahead: 0, behind: 3 }), "main ↓3")
    assert.equal(panel.branchLine({ ...row, ahead: 0, behind: 0 }), "main")
})

test("a clean repository still draws its header but no change rows", () => {
    const rows = panel.buildRows([
        { repo: { root: "/a", label: "a", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [] },
    ])
    assert.equal(rows.length, 1)
    assert.equal(panel.headLine(rows[0], false).detail, "main")
})

test("a long path keeps its file name and truncates the directory", () => {
    // The name is what you scan for, so it is the last thing cut. Clipping the
    // whole path from the left instead dropped the directory entirely and made
    // every row under a deep folder read the same.
    const long = panel.changeLine({ path: "src/components/very/deeply/nested/Thing.tsx", status: "M" })
    assert.equal(long.name, "Thing.tsx")
    assert.ok(long.directory.endsWith("…"), long.directory)

    // A path that fits keeps both cells, name first.
    assert.deepEqual(plain(panel.changeLine({ path: "doc/ai.md", status: "M" })), { letter: "M", name: "ai.md", directory: "doc" })
    // A bare file name has no directory to draw.
    assert.deepEqual(plain(panel.changeLine({ path: "run.sh", status: "M" })), { letter: "M", name: "run.sh", directory: "" })
})

test("push is offered only when there is something to push", () => {
    const base = { root: "/a", label: "a", branch: "main", behind: 0, changes: [{ path: "x", status: "M" }] }
    const enabled = (row) => panel.actions(row).find((action) => action.id === "push").enabled
    assert.equal(enabled({ ...base, ahead: 1 }), true)
    assert.equal(enabled({ ...base, ahead: 0 }), false)
    // A detached HEAD has nothing to push to, whatever the count says.
    assert.equal(enabled({ ...base, ahead: 4, branch: "HEAD" }), false)
})

test("commit needs a change, and says so when it has one but nothing is staged", () => {
    const clean = { root: "/a", label: "a", branch: "main", ahead: 0, behind: 0, changes: [] }
    const dirty = { ...clean, changes: [{ path: "new.txt", status: "?" }] }
    const commit = (row) => panel.actions(row).find((action) => action.id === "commit").enabled
    assert.equal(commit(clean), false)
    assert.equal(commit(dirty), true)
    assert.match(panel.hintFor(dirty), /untracked/)
    assert.equal(panel.hintFor(clean), "")
})

test("a failed repository is drawn with its error, not dropped", () => {
    const row = { root: "/a", label: "a", branch: "HEAD", ahead: 0, behind: 0, changes: [], error: "index.lock exists" }
    assert.equal(panel.hintFor(row), "index.lock exists")
    assert.equal(panel.totalChanges([row]), 0)
    const view = panel.buildView(row)
    assert.ok(view.some((line) => line.tone === "error" && line.text === "index.lock exists"))
})

test("a nested repository's directory entry is not counted as a change", () => {
    // The parent reports `? infra/` for the checkout one level down. That
    // repository is a row of its own, so the entry is dropped from the count.
    const rows = panel.buildRows([
        { repo: { root: "/a", label: ".", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [{ path: "infra/", status: "?" }, { path: "x.ts", status: "M" }] },
        { repo: { root: "/a/infra", label: "infra", depth: 1 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [] },
    ])
    assert.deepEqual(plain(rows[0].changes.map((change) => change.path)), ["x.ts"])
    assert.equal(panel.totalChanges(rows), 1)
})

test("a file staged and edited again appears under both headings", () => {
    // porcelain=v2 reports `AM`: added to the index, modified since. One
    // boolean cannot say that; the two columns can.
    const rows = panel.buildRows([
        {
            repo: { root: "/a", label: ".", depth: 0 },
            branch: { name: "main", ahead: 0, behind: 0 },
            changes: [
                { path: "both.txt", status: "M", index: "added", worktree: "modified" },
                { path: "staged.txt", status: "A", index: "added", worktree: "none" },
                { path: "loose.txt", status: "M", index: "none", worktree: "modified" },
            ],
        },
    ])
    const groups = plain(panel.groupChanges(rows[0]))
    assert.deepEqual(groups.map((group) => group.title), ["Staged Changes", "Changes"])
    assert.deepEqual(groups[0].changes.map((change) => change.path), ["both.txt", "staged.txt"])
    assert.deepEqual(groups[1].changes.map((change) => change.path), ["both.txt", "loose.txt"])
    // Each group reads its own column as the letter -- `AM` is `A` staged and
    // `M` unstaged, which is the pair VS Code draws and the pair one shared
    // letter got wrong.
    assert.deepEqual(groups[0].changes.map((change) => change.letter), ["A", "A"])
    assert.deepEqual(groups[1].changes.map((change) => change.letter), ["M", "M"])
    assert.equal(groups[0].staged, true)
    assert.equal(groups[1].staged, false)
})

test("the view splits into a list and a diff, and stays whole when narrow", () => {
    // Two panes from the width where both are usable, and a single pane below
    // it -- the list alone, which is the half you need to navigate with.
    // Below the sum of the narrowest useful list, the divider, and the
    // narrowest useful diff there is no split at all.
    assert.equal(panel.panes(40), undefined)
    assert.equal(panel.panes(59), undefined)
    // At exactly that width both halves are at their minimum.
    assert.deepEqual(plain(panel.panes(60)), { list: 26, diff: 32 })

    const wide = panel.panes(120)
    assert.ok(wide !== undefined)
    // The list keeps a fixed, readable width; the diff takes what is left.
    // The two plus the divider account for exactly the width given: a pane that
    // overflows by one clips the first character of every row, which is what
    // this pins.
    assert.equal(wide.list, 38)
    assert.equal(wide.diff, 80)
    assert.equal(wide.list + wide.diff + 2, 120)

    // A narrow two-pane width still gives the list its minimum and never a
    // negative diff.
    const narrow = panel.panes(80)
    assert.ok(narrow !== undefined)
    assert.ok(narrow.list >= panel.MIN_LIST)
    assert.ok(narrow.diff > 0)
})

test("an edit is paired into two columns, and a new file is not", () => {
    const patch = [
        "@@ -1,4 +1,5 @@",
        " context one",
        "-old a",
        "-old b",
        "+new a",
        " context two",
        "+added only",
        " context three",
    ].join("\n")
    const rows = plain(panel.diffPairs(patch))
    // Headers are dropped; the pairing is positional within the hunk.
    assert.deepEqual(
        rows.map((row) => [row.left, row.right, row.tone]),
        [
            ["", "", "hunk"],
            ["context one", "context one", "context"],
            ["old a", "new a", "changed"],
            ["old b", "", "removed"],
            ["context two", "context two", "context"],
            ["", "added only", "added"],
            ["context three", "context three", "context"],
        ],
    )
    // Line numbers advance on each side independently.
    assert.equal(rows[2].leftNo, "2")
    assert.equal(rows[2].rightNo, "2")
    // `context two` follows two removals and one addition: the old side has
    // advanced by two, the new side by one.
    assert.equal(rows[4].leftNo, "4")
    assert.equal(rows[4].rightNo, "3")
    assert.equal(rows[5].leftNo, "")
    assert.equal(rows[5].rightNo, "4")
})

test("a file is new for the group it is clicked in, not for the file", () => {
    // `AM`: added to the index, edited again. Under Staged there is no old
    // side, so the whole file is shown; under Changes the index *is* the old
    // side, so it is an ordinary two-column diff. Judging from the file alone
    // got this wrong in one of the two groups.
    const am = { index: "added", worktree: "modified" }
    assert.equal(git.isNewFile(am, true), true)
    assert.equal(git.isNewFile(am, false), false)

    // Never in the index: no old side anywhere, so both groups show the file.
    assert.equal(git.isNewFile({ index: "none", worktree: "untracked" }, false), true)

    // An ordinary staged edit is not a new file.
    assert.equal(git.isNewFile({ index: "modified", worktree: "none" }, true), false)
    assert.equal(git.isNewFile({ index: "none", worktree: "modified" }, false), false)
})

test("hunks are located by row, skipping the headers the diff view hides", () => {
    const patch = [
        "diff --git a/x b/x",
        "index 1..2 100644",
        "--- a/x",
        "+++ b/x",
        "@@ -1,2 +1,2 @@",
        " one",
        "-two",
        "+TWO",
        "@@ -20,1 +20,2 @@",
        " twenty",
        "+added",
    ].join("\n")
    // Rows the view draws: the headers are skipped, so the first hunk is at row
    // 0 and the second follows the four rows the first one occupies (`@@`,
    // `one`, `-two`, `+TWO`).
    assert.deepEqual(plain(git.hunkPositions(patch)), [0, 4])
    // A patch with no hunk has nowhere to jump.
    assert.deepEqual(plain(git.hunkPositions("")), [])
})

test("a file's tree-sitter language is read from its name", () => {
    assert.equal(panel.filetypeOf("a/b/tui.tsx"), "typescriptreact")
    assert.equal(panel.filetypeOf("git.ts"), "typescript")
    assert.equal(panel.filetypeOf("run.sh"), "bash")
    assert.equal(panel.filetypeOf("notes.md"), "markdown")
    // A dotfile has no extension but is still known.
    assert.equal(panel.filetypeOf(".bashrc"), "bash")
    assert.equal(panel.filetypeOf("home/.vimrc"), "vim")
    // Unknown, or genuinely extensionless, draws as plain text.
    assert.equal(panel.filetypeOf("Makefile"), undefined)
    assert.equal(panel.filetypeOf("a.unknownext"), undefined)
})

test("a row from an older snapshot is dropped rather than double-listed", () => {
    // A snapshot written before the two-column change has `staged` and no
    // columns. Filing it by `undefined !== "none"` would put every row under
    // both headings -- the bug this guards against.
    const stale = {
        root: "/a",
        label: ".",
        branch: "main",
        ahead: 0,
        behind: 0,
        changes: [{ path: "old.ts", status: "M", staged: true }],
    }
    assert.deepEqual(plain(panel.groupChanges(stale)), [])
})

test("an empty group is omitted rather than drawn as a bare heading", () => {
    const rows = panel.buildRows([
        { repo: { root: "/a", label: ".", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [{ path: "x", status: "M", index: "none", worktree: "modified" }] },
    ])
    assert.deepEqual(plain(panel.groupChanges(rows[0]).map((group) => group.title)), ["Changes"])
})

test("one glyph per row: nested repositories show the bullet instead of the fold", () => {
    const row = { root: "/a/infra", label: "infra", branch: "main", ahead: 0, behind: 0, changes: [] }
    // Nested: the bullet is the row's own glyph, not an extra one behind `▼`.
    assert.equal(panel.headLine(row, false, true).marker, "•")
    assert.equal(panel.headLine(row, true, true).marker, "•")
    assert.equal(panel.headLine(row, false, true).name, "infra")
    // The location's own repository keeps the fold marker, both ways round.
    assert.equal(panel.headLine(row, false, false).marker, "▼")
    assert.equal(panel.headLine(row, true, false).marker, "▶")
    // The view names a nested repository with the bullet, matching the sidebar.
    assert.equal(panel.viewHeader(row), "• infra  main")
    assert.equal(panel.viewHeader({ ...row, root: "/a", label: "." }), "/a  main")
})

test("a sole repository at the location skips its label row", () => {
    // The section header carries the branch instead, so the label row would
    // only repeat "." above a list of files.
    const sole = panel.buildRows([
        { repo: { root: "/a", label: ".", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [{ path: "x.ts", status: "M" }] },
    ])
    assert.equal(panel.soleRepository(sole), true)

    // A repository one level down keeps its name: it is what tells it apart.
    const nested = panel.buildRows([
        { repo: { root: "/a", label: ".", depth: 0 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [] },
        { repo: { root: "/a/infra", label: "infra", depth: 1 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [] },
    ])
    assert.equal(panel.soleRepository(nested), false)

    // One nested repository and no root repository still keeps its name.
    const onlyNested = panel.buildRows([
        { repo: { root: "/a/infra", label: "infra", depth: 1 }, branch: { name: "main", ahead: 0, behind: 0 }, changes: [] },
    ])
    assert.equal(panel.soleRepository(onlyNested), false)
})

test("a diff is split into hunks, additions, deletions, and context", () => {
    const patch = ["diff --git a/a.txt b/a.txt", "index 1..2 100644", "--- a/a.txt", "+++ b/a.txt", "@@ -1 +1,2 @@", " one", "+two", "-three", ""].join("\n")
    assert.deepEqual(plain(panel.diffLines(patch)), [
        { text: "@@ -1 +1,2 @@", tone: "hunk" },
        { text: " one", tone: "muted" },
        { text: "+two", tone: "added" },
        { text: "-three", tone: "removed" },
    ])
})

test("an empty diff draws no lines rather than one blank line", () => {
    assert.deepEqual(plain(panel.diffLines("")), [])
})

test("the view names the repository and its branch, and lists no rows when clean", () => {
    const row = { root: "/a", label: ".", branch: "main", ahead: 0, behind: 0, changes: [] }
    const view = panel.buildView(row)
    assert.equal(view[0].text, "/a  main")
    assert.ok(view.some((line) => line.text === "Working tree clean."))
})

test("untracked paths are identified so their diff is taken against the empty tree", () => {
    const row = { root: "/a", label: "a", branch: "main", ahead: 0, behind: 0, changes: [{ path: "n.txt", status: "?" }, { path: "m.txt", status: "M" }] }
    const untracked = panel.untrackedPaths(row)
    assert.equal(untracked.has("n.txt"), true)
    assert.equal(untracked.has("m.txt"), false)
})
