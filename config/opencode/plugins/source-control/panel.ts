// Source control, as data.
//
// Kept out of tui.tsx for the reason loadout's drift.ts is kept out of its
// panel: node can load a plain module and call its exports, but JSX needs
// opencode's transform. plugin-layout.test.mjs enforces the split.
//
// Everything here takes what it needs as arguments and returns rows or lines.
// Nothing reaches for opencode, so a test can describe a set of repositories
// and check what comes back without a terminal or a git repository.

// The shapes this module reads, declared here rather than imported from
// `git.ts`.
//
// A `import type` should cost nothing at runtime, but opencode resolves the
// sibling anyway while bundling a plugin, and `git.ts` pulls in `node:child_process`
// and `node:fs/promises`. Whatever the bundler does with that, it was reaching
// this file: the whole module stopped exporting its names. Stating the three
// types locally removes the edge, and this file was always meant to have no
// dependencies -- a test loads it under plain node with nothing around it.
//
// Kept in step with `git.ts` by hand; the two are read together.
type StatusColumn = "none" | "added" | "deleted" | "modified" | "renamed" | "conflicted" | "untracked"

type RepoRef = {
    readonly root: string
    readonly label: string
    readonly depth: number
}

type RepoStatus = {
    readonly repo: RepoRef
    readonly branch: { readonly name: string; readonly ahead: number; readonly behind: number; readonly upstream?: string }
    readonly changes: readonly { readonly path: string; readonly status: string; readonly from?: string; readonly index: StatusColumn; readonly worktree: StatusColumn }[]
    readonly error?: string
}

// The sidebar box is 42 columns, with 2 of padding each side and one more on
// the right from the slot's own box, the same arithmetic subagent-watch uses.
// Absent from the slot's input, so it is a constant and the test pins it. A
// wrong value costs the ellipsis, never the layout: every line is wrapMode
// "none".
export const WIDTH = 42 - 2 - 2 - 1
// The indent every file row carries under its heading.
export const INDENT_WIDTH = 2
const ELLIPSIS = "…"

// Code points, not UTF-16 units: a title cut mid-surrogate draws a replacement
// character, which is worse than the ellipsis it replaced.
const size = (value: string): number => Array.from(value).length
const clip = (value: string, limit: number): string => Array.from(value).slice(0, limit).join("")

// --- sidebar ---------------------------------------------------------------

// What one repository contributes to the sidebar.
//
// A repository is drawn as one header line and, when it has changes, one line
// per file. That is the brief view: you should be able to tell "three repos, one
// has work" without opening anything.
export type RepoRow = {
    readonly root: string
    readonly label: string
    readonly branch: string
    readonly ahead: number
    readonly behind: number
    readonly changes: readonly ChangeRow[]
    readonly error?: string
}

// One file row, with the two columns kept apart.
//
// `status` is the letter the sidebar draws -- one glyph, so it has to pick a
// column. `index` and `worktree` are what the view groups by, because a glyph
// cannot say "staged and edited again".
export type ChangeRow = {
    readonly path: string
    readonly status: string
    readonly index: StatusColumn
    readonly worktree: StatusColumn
}

// What a file row's button does, and the glyph it shows.
//
// The answer comes from the group the row was drawn under: one under Staged
// Changes can be taken out of the index, one under Changes can be put in. An
// `AM` file appears under both and reads `━` in one and `✚` in the other.
//
// The glyphs are wide rather than the ASCII `+` and `-`: a one-column button
// made of a thin stroke is hard to see and harder to hit with a mouse, and the
// row already reserves the column either way. `✚` (U+271A) and `━` (U+2501) are
// both East-Asian-neutral, so both occupy exactly one cell in a terminal -- the
// emoji `➕`/`➖` would be two cells wide and break the row.
export type FileButton = {
    readonly glyph: "✚" | "━"
    readonly staged: boolean
    readonly title: string
}

export const fileButton = (staged: boolean): FileButton =>
    staged ? { glyph: "━", staged: true, title: "Unstage" } : { glyph: "✚", staged: false, title: "Stage" }

// What to ask the model for a commit message.
//
// The repository's own log is the style guide, and it is passed in rather than
// described: a model told "Conventional Commits" still guesses at the scope,
// the verb, and whether this project writes a body. Twenty real subjects answer
// all three at once.
//
// A body is allowed now. The dialog is a textarea, so a subject plus two or
// three lines of "why" fits where a single line did not, and a change that
// needs a reason is the case worth spending the lines on.
//
// The file list goes in front of the diff: a diff can be long and truncated,
// and the list is what keeps the message naming the right subsystem when the
// patch was cut.
export const commitPrompt = (files: readonly string[], diff: string, history: readonly string[] = []): string =>
    [
        "Write a commit message for the staged change below.",
        "",
        "Shape:",
        "- First line: subject, at most 72 characters, no trailing period.",
        "- Conventional Commits: `type(scope): summary`, where type is one of",
        "  feat, fix, refactor, docs, test, chore, perf, build, ci.",
        "- scope is the top-level area that changed, such as `plugins` or `docs`.",
        "- Imperative mood, lower case after the colon.",
        "- Then a blank line and a body of at most three short lines saying why,",
        "  in plain prose. Omit the body when the subject already says it.",
        "",
        "Reply with the message only. No quotes, no code fence, no explanation.",
        history.length === 0 ? "" : `Recent subjects in this repository, newest first:\n${history.map((line) => `  ${line}`).join("\n")}`,
        files.length === 0 ? "" : `Files changed:\n${files.map((file) => `  ${file}`).join("\n")}`,
        "",
        "Diff:",
        diff,
    ]
        .filter((line) => line !== "")
        .join("\n")

// The model's answer, as the text to put in the commit box.
//
// Models wrap the message in a fence, prefix it with "Here is a commit
// message:", or add a body that was not asked for. All three are trimmed here
// rather than in the dialog: the result is what the user edits, and a stray
// backtick in a commit subject is a mistake nobody notices until it is in the
// log.
//
// The body survives now that the box is a textarea. What does not survive is
// the preamble, the quoting, and the fence -- none of which belong in a commit.
export const cleanMessage = (text: string): string => {
    let body = text.trim()
    // A fenced block anywhere in the answer: keep what is inside it.
    const fence = /```[a-zA-Z]*\n([\s\S]*?)```/.exec(body)
    if (fence !== null) body = fence[1]!.trim()
    const lines = body.split("\n").map((line) => line.trimEnd())
    // Drop a preamble line such as "Here is the commit message:".
    const first = lines.findIndex((line) => line.trim() !== "" && !line.trim().endsWith(":"))
    if (first === -1) return ""
    const kept = lines.slice(first)
    // The subject, stripped of whatever quoting the model added.
    kept[0] = kept[0]!
        .trim()
        .replace(/^["'`]+/, "")
        .replace(/["'`]+$/, "")
        .trim()
    // At most a subject plus a short body: the dialog is not a scratchpad.
    const trimmed = kept.slice(0, 6)
    while (trimmed.length > 0 && trimmed[trimmed.length - 1]!.trim() === "") trimmed.pop()
    return trimmed.join("\n")
}

// The header for the section, which is also its toggle.
export const SECTION = "Source Control"

// Turn statuses into sidebar rows.
//
// Repositories with no changes still appear, because "which repository am I in
// and what branch" is half of what the section is for. Repositories that failed
// appear carrying their error: a repository silently missing from a list is
// indistinguishable from one that no longer exists.
//
// A nested repository shows up in its parent's status as an untracked
// directory -- `? infra/` for a `/a/infra` checkout. That entry is dropped: the
// repository it names is a row of its own further down this same list, and a
// change you cannot act on in this repository is noise in the count that says
// how much work there is.
export const buildRows = (statuses: readonly RepoStatus[]): RepoRow[] => {
    const roots = new Set(statuses.map((status) => status.repo.root))
    return statuses.map((status) => ({
        root: status.repo.root,
        label: status.repo.label,
        branch: status.branch.name,
        ahead: status.branch.ahead,
        behind: status.branch.behind,
        changes: status.changes
            .filter((change) => !roots.has(joinPath(status.repo.root, change.path.replace(/\/$/, ""))))
            .map((change) => ({ path: change.path, status: change.status, index: change.index, worktree: change.worktree })),
        ...(status.error === undefined ? {} : { error: status.error }),
    }))
}

// One path joined to another without importing node:path into a module the
// browser-side tests load. The separator is always "/" here: these are git
// paths, which are "/" regardless of platform.
const joinPath = (root: string, path: string): string => (root.endsWith("/") ? `${root}${path}` : `${root}/${path}`)

// Whether the section is the location's own repository and nothing else.
//
// When it is, the label row is skipped and the files hang straight under the
// section header. A single "." above a list of files names nothing: the section
// is already titled, and the location is where opencode is running. The label
// earns its line only when there is more than one repository to tell apart.
export const soleRepository = (rows: readonly RepoRow[]): boolean => rows.length === 1 && rows[0]!.label === "."

// The branch line: the branch name, then how far it has drifted from upstream.
//
// The arrows are the two directions of drift and are omitted at zero, so a
// clean, synced branch reads as just its name. `↓` is behind (the remote has
// commits you do not) and `↑` is ahead, matching the order git prints them and
// the order VS Code draws them.
export const branchLine = (row: RepoRow): string => {
    const drift: string[] = []
    if (row.behind > 0) drift.push(`↓${row.behind}`)
    if (row.ahead > 0) drift.push(`↑${row.ahead}`)
    return drift.length === 0 ? row.branch : `${row.branch} ${drift.join(" ")}`
}

// The head line: the leading glyph, name, and the change count or branch.
//
// The count is what makes the section scannable -- the number is what you look
// for, and the branch is what you check once. So the count leads when there is
// one and the branch takes the remaining width.
//
// There is one glyph per row, not two. The location's own repository shows the
// fold marker (`▼`/`▶`); a repository found one level down shows `•` instead,
// because its name is what tells it apart and the fold is the thing you reach
// for less. Drawing both was the stacking this avoids: `▼ • product` spends two
// cells saying what one cell says. The `•` is provider-usage's row marker, and a
// nested repository whose list is folded shows `•` too -- the fold is a detail,
// not the row's identity.
export const headLine = (row: RepoRow, collapsed: boolean, nested = false): { readonly marker: string; readonly name: string; readonly detail: string } => {
    const marker = nested ? "•" : collapsed ? "▶" : "▼"
    const count = row.error !== undefined ? "!" : row.changes.length > 0 ? String(row.changes.length) : ""
    return { marker, name: row.label, detail: count === "" ? branchLine(row) : count }
}

// One file's row in the sidebar, split into the cells that are drawn in
// different colours: the status letter, the file name, and the directory.
//
// The name comes before the directory, which is VS Code's order and the right
// one for a narrow column: the name is what you scan for, so it is the last
// thing that may be cut. Clipping the whole path from the left instead
// (`…/very/long/Thing.tsx`) drops the directory entirely and makes every row
// under a deep folder read the same.
//
// The name is never truncated. If it cannot fit there is nothing useful left to
// draw, so it takes the budget and the directory is omitted rather than being
// given a sliver that says `c…`.
export type FileCells = {
    readonly letter: string
    readonly name: string
    /** Empty when the path has no directory, or when none of it fits. */
    readonly directory: string
}

export const changeLine = (change: { readonly path: string; readonly status: string }, width = WIDTH): FileCells => {
    // What is left for the name and directory once the indent, the letter, and
    // the spaces between the cells are taken out of the row.
    const budget = width - INDENT_WIDTH - 1 - 1
    const slash = change.path.lastIndexOf("/")
    const name = slash === -1 ? change.path : change.path.slice(slash + 1)
    const directory = slash === -1 ? "" : change.path.slice(0, slash)

    if (directory === "") return { letter: change.status, name: clip(name, budget), directory: "" }
    // One space separates the cells, and the ellipsis needs a cell of its own.
    const room = budget - size(name) - 1
    if (room <= 2) return { letter: change.status, name: clip(name, budget), directory: "" }
    if (size(directory) <= room) return { letter: change.status, name, directory }
    return { letter: change.status, name, directory: `${clip(directory, room - 1)}${ELLIPSIS}` }
}

// The tree-sitter filetype for a path, so the pane can highlight it.
//
// A table rather than a dependency: the renderer's own `pathToFiletype` lives
// in an OpenTUI module this file must not import, because a test loads it under
// plain node. Only the languages worth naming are here; anything else falls
// back to plain text, which is what an unknown extension gets anyway.
//
// The keys are extensions, not full names, and the values are the names
// tree-sitter grammars register under -- `typescriptreact` for tsx, not `tsx`.
const FILETYPE: Record<string, string> = {
    ts: "typescript",
    tsx: "typescriptreact",
    js: "javascript",
    jsx: "javascriptreact",
    mjs: "javascript",
    cjs: "javascript",
    json: "json",
    jsonc: "json",
    md: "markdown",
    bash: "bash",
    sh: "bash",
    zsh: "bash",
    py: "python",
    rs: "rust",
    go: "go",
    c: "c",
    h: "c",
    cc: "cpp",
    cpp: "cpp",
    hpp: "cpp",
    java: "java",
    rb: "ruby",
    lua: "lua",
    vim: "vim",
    yml: "yaml",
    yaml: "yaml",
    toml: "toml",
    css: "css",
    scss: "scss",
    html: "html",
    sql: "sql",
    xml: "xml",
    tmux: "bash",
}

// The filetype for a path, or undefined when there is no grammar for it.
//
// A dotfile such as `.bashrc` has no extension but is a file the pane should
// still highlight, so the bare name is tried after the extension.
export const filetypeOf = (path: string): string | undefined => {
    const slash = path.lastIndexOf("/")
    const name = slash === -1 ? path : path.slice(slash + 1)
    const dot = name.lastIndexOf(".")
    // A leading dot is the whole name (`.bashrc`), not an extension separator.
    if (dot > 0) return FILETYPE[name.slice(dot + 1).toLowerCase()]
    if (name === ".bashrc" || name === ".bash_profile" || name === ".bash_logout" || name === ".profile") return "bash"
    if (name === ".vimrc") return "vim"
    return undefined
}

// --- full-screen view ------------------------------------------------------

// A line of the full-screen view.
//
// `tone` is a token name rather than a colour, because this module must not
// reach for a theme: tui.tsx maps the token to the theme's own colour. That is
// also what keeps the test able to assert on a line without a renderer.
export type Tone = "base" | "muted" | "added" | "removed" | "hunk" | "header" | "error"

export type Line = {
    readonly text: string
    readonly tone: Tone
}

// An action the view offers, with the key that triggers it.
//
// `enabled` is decided here rather than in the JSX for the same reason the rows
// are: "Push" is shown greyed on a branch with no upstream and hidden on a
// repository with no remote, and that is a decision, not a rendering.
export type ActionRow = {
    readonly id: "commit" | "pull" | "push" | "fetch" | "refresh" | "stage" | "unstage"
    readonly label: string
    readonly bind: string
    readonly enabled: boolean
}

// The repository the view is showing, as the header states it.
//
// A nested repository is marked with the same `•` the sidebar uses, so the two
// views name it the same way. The location's own repository reads as its path,
// which is what distinguishes it without a bullet.
export const viewHeader = (row: RepoRow): string => {
    const where = row.label === "." ? row.root : `• ${row.label}`
    return `${where}  ${row.branch}`
}

// The action bar for one repository.
//
// Enabled-ness follows what the repository can actually do: commit needs a
// message and a change, pull needs an upstream, push needs an upstream. Showing
// a button that is grey because of a reason you cannot see is the thing this
// avoids -- the reason is one line below the bar (`hintFor`).
export const actions = (row: RepoRow): ActionRow[] => {
    const tracked = row.branch !== "" && row.branch !== "HEAD"
    const changed = row.changes.length > 0
    return [
        { id: "commit", label: "Commit", bind: "ctrl+s", enabled: changed && row.error === undefined },
        { id: "pull", label: "Pull", bind: "ctrl+p", enabled: tracked },
        { id: "push", label: "Push", bind: "ctrl+u", enabled: tracked && row.ahead > 0 },
        { id: "fetch", label: "Fetch", bind: "ctrl+f", enabled: true },
        { id: "refresh", label: "Refresh", bind: "ctrl+r", enabled: true },
    ]
}

// The one line that says why an action is unavailable, or what state the
// repository is in. Empty when there is nothing worth saying: a clean,
// synced branch needs no sentence to say so, and the change count above
// already reads zero.
export const hintFor = (row: RepoRow): string => {
    if (row.error !== undefined) return row.error
    if (row.changes.length === 0) return row.behind > 0 ? `${row.behind} commit(s) behind ${row.branch}` : ""
    const untracked = row.changes.filter((change) => change.status === "?").length
    if (untracked === 0) return ""
    return `${untracked} untracked file(s) will not be committed unless staged`
}

// The tone a file's status letter is drawn in.
//
// Exported because the view colours its clickable rows by it. Additions and
// renames read green, deletions red, and an edit stays in the body colour: an
// edit is the common case and colouring it would make the list loud everywhere
// at once.
export const toneOf = (status: string): Tone => {
    if (status === "A" || status === "?" || status === "R" || status === "C") return "added"
    if (status === "D") return "removed"
    if (status === "U") return "error"
    return "base"
}

// A unified diff, coloured line by line.
//
// The patch arrives as one string from git and is split here rather than in the
// JSX for two reasons: the split is a decision about what a line is (a hunk
// header, an addition, a deletion), and doing it once per render would split the
// same string on every repaint.
//
// `---`/`+++` header pairs are dropped: the file is already named above the
// patch, and repeating it wastes the two lines the eye starts at.
export const diffLines = (patch: string): Line[] => {
    const lines: Line[] = []
    const source = patch.split("\n")
    for (let index = 0; index < source.length; index += 1) {
        const text = source[index]!
        if (text.startsWith("diff --git ")) continue
        if (text.startsWith("index ")) continue
        if (text.startsWith("--- ") || text.startsWith("+++ ")) continue
        if (text.startsWith("@@")) {
            lines.push({ text, tone: "hunk" })
            continue
        }
        if (text.startsWith("+")) {
            lines.push({ text, tone: "added" })
            continue
        }
        if (text.startsWith("-")) {
            lines.push({ text, tone: "removed" })
            continue
        }
        lines.push({ text, tone: "muted" })
    }
    // The split leaves a trailing "" for the final newline. It is not a line.
    if (lines.length > 0 && lines[lines.length - 1]!.text === "") lines.pop()
    return lines
}

// A unified diff as two columns.
//
// The right pane draws an edit side by side: the old side on the left, the new
// on the right, paired row by row. A diff lists a run of removals and then the
// run of additions that replaces it, so the two runs are zipped -- which is
// what makes a rewritten block read as rows of two halves instead of a
// deletion followed by an unrelated insertion.
//
// Pairing is positional within a hunk, not by content: a diff says only that
// these lines went and those arrived, and matching them any further would
// invent a correspondence git did not assert. A removal with no addition
// leaves the right cell blank; an addition with no removal leaves the left.
export type PairedRow = {
    readonly left: string
    readonly right: string
    /** Which cells changed, so the pane colours each half on its own. */
    readonly tone: "context" | "changed" | "removed" | "added" | "hunk"
    /** Line numbers, blank on the side that has no line. */
    readonly leftNo: string
    readonly rightNo: string
}

// `@@ -oldStart,oldCount +newStart,newCount @@`
const HUNK = /^@@ -(\d+)(?:,\d+)? \+(\d+)(?:,\d+)? @@/

export const diffPairs = (patch: string): PairedRow[] => {
    const rows: PairedRow[] = []
    let oldNo = 0
    let newNo = 0
    // The current run of removals, and the additions seen so far.
    let removed: string[] = []
    let added: string[] = []

    // Close the open run: zip the removals against the additions and advance
    // both line counters past what the run consumed.
    const flush = () => {
        const count = Math.max(removed.length, added.length)
        for (let index = 0; index < count; index += 1) {
            const left = removed[index]
            const right = added[index]
            rows.push({
                left: left ?? "",
                right: right ?? "",
                tone:
                    left !== undefined && right !== undefined
                        ? "changed"
                        : left !== undefined
                          ? "removed"
                          : "added",
                leftNo: left === undefined ? "" : String(oldNo + index + 1),
                rightNo: right === undefined ? "" : String(newNo + index + 1),
            })
        }
        oldNo += removed.length
        newNo += added.length
        removed = []
        added = []
    }

    for (const text of patch.split("\n")) {
        if (text.startsWith("diff --git ") || text.startsWith("index ")) continue
        if (text.startsWith("--- ") || text.startsWith("+++ ")) continue
        if (text.startsWith("@@")) {
            flush()
            const match = HUNK.exec(text)
            if (match !== null) {
                oldNo = Number(match[1]) - 1
                newNo = Number(match[2]) - 1
            }
            rows.push({ left: "", right: "", tone: "hunk", leftNo: "", rightNo: "" })
            continue
        }
        if (text.startsWith("-")) {
            removed.push(text.slice(1))
            continue
        }
        if (text.startsWith("+")) {
            added.push(text.slice(1))
            continue
        }
        // A context line ends any open run, then is drawn on both sides. Its
        // first character is a space; a bare empty string is the artifact of
        // the final newline and is skipped.
        flush()
        if (text === "") continue
        oldNo += 1
        newNo += 1
        const body = text.slice(1)
        rows.push({ left: body, right: body, tone: "context", leftNo: String(oldNo), rightNo: String(newNo) })
    }
    flush()
    return rows
}
//
// The action bar is drawn as text here and made clickable by tui.tsx, which is
// the same separation subagent-watch uses for its rows: this module decides
// what is said, the JSX decides what a press on it means.
export const buildView = (row: RepoRow | undefined): Line[] => {
    if (row === undefined) return [{ text: "No repository here.", tone: "muted" }]
    const lines: Line[] = [{ text: viewHeader(row), tone: "header" }]
    const hint = hintFor(row)
    if (hint !== "") lines.push({ text: hint, tone: row.error === undefined ? "muted" : "error" })
    // The action bar is not drawn here. It is a row of clickable buttons, which
    // this module cannot make -- it returns text, and a text line is not a
    // target. `actions()` still decides what it holds and what is enabled; the
    // panel draws it.
    // The files are not listed here. They are rows the panel makes clickable,
    // and drawing them once as plain text and once as targets is how a file
    // appeared twice. `groupChanges` below is what the view iterates; this
    // function stops at the "nothing to show" case.
    if (row.changes.length === 0) {
        lines.push({ text: "", tone: "base" })
        lines.push({ text: "Working tree clean.", tone: "muted" })
    }
    return lines
}

// One heading in the view's file list.
//
// Staged and unstaged are drawn separately, the way VS Code splits them: what
// will go into the next commit and what will not are different questions, and a
// single list answers neither. A file staged and then edited again appears in
// both, which is correct -- it has two states.
export type Group = {
    readonly title: string
    /** True when the group's rows diff against the index rather than the tree. */
    readonly staged: boolean
    /** Each row with the letter *this group's* column gives it. */
    readonly changes: readonly { readonly path: string; readonly letter: string }[]
}

// The one-letter form of a column, for the row glyph.
//
// A file can be `AM`, and the two groups must not both read `A`: under Staged
// it was added to the index, under Changes it has been modified since. VS Code
// draws exactly that pair, and it is the difference between "this is ready to
// commit" and "this file moved again after you staged it".
const letterOf = (column: StatusColumn): string => {
    switch (column) {
        case "added":
            return "A"
        case "deleted":
            return "D"
        case "renamed":
            return "R"
        case "conflicted":
            return "U"
        case "untracked":
            return "U"
        case "none":
            return " "
        default:
            return "M"
    }
}

// The file list, staged first.
//
// Empty groups are omitted rather than drawn as a heading with nothing under
// it, the same rule the sidebar follows for a repository with no changes.
export const groupChanges = (row: RepoRow): Group[] => {
    const groups: Group[] = []
    // A row without both columns is one this build did not produce -- a
    // snapshot left by an older version, whose shape had a single `staged`
    // boolean. Treating it as two empty columns would quietly file every such
    // row under both headings, which is the failure this guards against.
    //
    // Dropping them is the honest answer: the caller refreshes, and the drop is
    // visible as an empty list rather than as a wrong one.
    const known = row.changes.filter((change) => change.index !== undefined && change.worktree !== undefined)
    // A file is staged when its index column says so, and still unstaged when
    // its working-tree column does. Both can be true, which is why a file can
    // legitimately appear under both headings.
    const staged = known.filter((change) => change.index !== "none")
    const rest = known.filter((change) => change.worktree !== "none")
    if (staged.length > 0) {
        groups.push({
            title: "Staged Changes",
            staged: true,
            changes: staged.map((change) => ({ path: change.path, letter: letterOf(change.index) })),
        })
    }
    if (rest.length > 0) {
        groups.push({
            title: "Changes",
            staged: false,
            changes: rest.map((change) => ({ path: change.path, letter: letterOf(change.worktree) })),
        })
    }
    return groups
}

// How the full-screen view splits.
//
// The left pane is the repository list and the file groups; the right is the
// selected file's diff. The split is computed here rather than measured in the
// JSX for the reason everything else about the layout is: a width is a
// decision, and a decision belongs where a test can read it.
//
// The list gets a fixed share rather than flex: a diff full of long lines and a
// list of short paths do not want the same amount of room, and letting flex
// divide evenly would leave both uncomfortable. 38 columns fits every path the
// sidebar draws, and the file name survives whole in all but the deepest trees.
export type Panes = {
    readonly list: number
    readonly diff: number
}

// The narrowest the list may become. Below this the file names no longer
// survive, and the text would be more ellipsis than path. A pane that narrow
// means the terminal is too small for two, and the caller draws one instead.
export const MIN_LIST = 26
const PREFERRED_LIST = 38
// What sits between the two panes: the divider's own border column and the
// padding on the diff side. The list pane is bordered by nothing, so nothing is
// reserved on its side. Getting this wrong by one is what clipped the first
// character of every list row.
const DIVIDER = 2
// What the diff pane needs before splitting is worth doing at all.
const MIN_DIFF = 32

export const panes = (width: number): Panes | undefined => {
    // Not enough room for two panes: the caller shows the list alone, which is
    // the half you need to navigate with.
    if (width < MIN_LIST + DIVIDER + MIN_DIFF) return undefined
    const list = Math.min(PREFERRED_LIST, width - DIVIDER - MIN_DIFF)
    return { list: Math.max(MIN_LIST, list), diff: width - DIVIDER - Math.max(MIN_LIST, list) }
}


// The count drawn beside the section header.
//
// Zero for a clean tree, and the summary is omitted rather than drawn as "(0)",
// which is the same rule subagent-watch follows: a permanent zero teaches the
// eye to skip the section.
export const totalChanges = (rows: readonly RepoRow[]): number => {
    let total = 0
    for (const row of rows) total += row.changes.length
    return total
}

// The untracked paths of one repository, as a set.
//
// A diff of an untracked file is taken against the empty tree rather than
// against the index, because there is no index entry to compare with. The
// caller asks this once per selection rather than scanning the rows again.
export const untrackedPaths = (row: RepoRow): ReadonlySet<string> => new Set(row.changes.filter((change) => change.status === "?").map((change) => change.path))

// A repository with no changes, for the case where one exists but status has
// not landed yet. A row that says nothing rather than a row that says "error".
export const pending = (repo: RepoRef): RepoRow => ({
    root: repo.root,
    label: repo.label,
    branch: "",
    ahead: 0,
    behind: 0,
    changes: [],
})
