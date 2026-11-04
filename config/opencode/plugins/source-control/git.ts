// Git, as data.
//
// The one file that spawns a process and the one file that names a git
// subcommand. panel.ts decides what to draw; tui.tsx decides when to ask. Both
// call this, and nothing here reaches for opencode, so a test can drive it
// against a throwaway repository with no terminal and no service.
//
// Why git at all, when opencode has a Vcs domain. The domain answers `info`,
// `status`, `branches` and `diff` for *one* repository -- the location's own.
// This plugin shows the location plus every git repository one level down, and
// the three things a source-control panel is actually for (commit, pull, push)
// are not in the domain at all. So `status` here reads `git status` directly
// rather than going through the domain, because the same parser must serve a
// repo the domain has never heard of.
//
// The spawn discipline, which is the whole performance story:
//
//   - `execFile`, never a shell string. No quoting bugs, and no shell process
//     forked on top of git's.
//   - One `git status` per repository per refresh, and refreshes are triggered
//     by events (a tool changed a file, a shell ran) rather than by a timer.
//   - Every call takes a signal, so a panel that closes cancels a hung push.
//   - Writes are serialised per repository. Two concurrent `git` writes to one
//     index is the way an index gets corrupted.

import { execFile } from "node:child_process"
import { readdir, readFile, stat } from "node:fs/promises"
import { join } from "node:path"

// A hard ceiling on the whole discovery pass. A repository on a slow network
// mount must not hold the sidebar hostage.
const DISCOVERY_TIMEOUT_MS = 2_000

// How long before a repository at a depth beyond zero is looked for again.
// The first level is scanned on the refresh; a nested repository is only
// rechecked when its parent's own status says something changed there.
export const MAX_DEPTH = 1

// Directories never scanned for repositories. `node_modules` is the one that
// matters: a monorepo holds thousands of package directories and a handful of
// them are git repositories, so walking them all is a stall for no result.
const SKIP = new Set([
    "node_modules",
    ".git",
    ".cache",
    ".venv",
    "venv",
    "__pycache__",
    "target",
    "dist",
    "build",
    ".next",
    ".turbo",
])

export type Change = {
    readonly path: string
    /** The porcelain status letter: M, A, D, R, ?, U... */
    readonly status: string
    /** Renames and copies carry where the file came from. */
    readonly from?: string
    /**
     * The two halves of porcelain=v2's XY columns.
     *
     * X is the index, Y the working tree. A file staged with one edit and
     * modified again since is `AM`: it appears in the staged list *and* the
     * unstaged one, and one boolean cannot say that. So both are kept and the
     * panel decides what to draw from them.
     */
    readonly index: Column
    readonly worktree: Column
}

export type Repo = {
    /** Absolute path of the working copy root, which is also the git -C argument. */
    readonly root: string
    /** The label drawn on the row: the directory name, or "." for the root itself. */
    readonly label: string
    /** Depth below the session's location: 0 is the location itself. */
    readonly depth: number
}

export type Branch = {
    readonly name: string
    readonly ahead: number
    readonly behind: number
    /** The upstream ref, when the branch tracks one. Absent for a local-only branch. */
    readonly upstream?: string
}

export type Status = {
    readonly repo: Repo
    readonly branch: Branch
    readonly changes: readonly Change[]
    /** Why the status is empty, when it is empty for a reason other than a clean tree. */
    readonly error?: string
}

export type Diff = {
    readonly path: string
    /** Raw unified diff. Empty when the file is binary. */
    readonly patch: string
    /** True when the byte budget cut the patch short. */
    readonly more: boolean
}

export type Outcome = { readonly ok: true; readonly out: string } | { readonly ok: false; readonly error: string }

// Run git and return stdout, or the reason it failed.
//
// `signal` is passed through rather than raced: execFile kills the child when
// the signal aborts, so a cancelled refresh leaves no orphan. The rejection is
// turned into a value because a status read is allowed to fail -- a repository
// whose index is locked still draws its rows.
const git = (cwd: string, args: readonly string[], signal?: AbortSignal, maxBuffer = 8 * 1024 * 1024): Promise<Outcome> =>
    new Promise((resolve) => {
        execFile(
            "git",
            args,
            {
                cwd,
                signal,
                maxBuffer,
                // Neither stdin nor a pager: a prompt would hang the TUI
                // forever, and a pager has nothing to page into.
                windowsHide: true,
                env: { ...process.env, GIT_TERMINAL_PROMPT: "0", GIT_PAGER: "cat", LC_ALL: "C" },
            },
            (error, stdout, stderr) => {
                if (error !== null) {
                    // A killed child (the signal fired) is a cancellation, not
                    // a git failure. Say so rather than quoting an empty stderr.
                    const aborted = (error as { name?: string }).name === "AbortError"
                    const reason = stderr.trim() !== "" ? stderr.trim() : aborted ? "cancelled" : error.message
                    resolve({ ok: false, error: reason })
                    return
                }
                resolve({ ok: true, out: stdout })
            },
        )
    })

// Whether a directory is the root of a git working copy.
//
// `stat` on `.git`, not a `git rev-parse` spawn: discovery visits every
// directory one level down, and a process per candidate is the cost this plugin
// exists to avoid. A `.git` *file* is a linked worktree or a submodule, which is
// still a repository, so existence is the whole test.
const isRepo = async (directory: string): Promise<boolean> => {
    try {
        await stat(join(directory, ".git"))
        return true
    } catch {
        return false
    }
}

// Every git repository at the location and one level below, root first.
//
// One `readdir` and one `stat` per candidate. Nothing here shells out, so it
// stays cheap enough to run on a refresh; the expensive work (`git status`)
// happens once per repository found.
export const discover = async (location: string, signal?: AbortSignal): Promise<readonly Repo[]> => {
    const found: Repo[] = []
    if (await isRepo(location)) {
        found.push({ root: location, label: labelOf(location, location), depth: 0 })
    }

    let entries
    try {
        entries = await readdir(location, { withFileTypes: true })
    } catch {
        return found
    }

    const deadline = Date.now() + DISCOVERY_TIMEOUT_MS
    const candidates: string[] = []
    for (const entry of entries) {
        if (!entry.isDirectory()) continue
        if (SKIP.has(entry.name) || entry.name.startsWith(".")) continue
        candidates.push(join(location, entry.name))
    }

    // Checked concurrently rather than one after another: a directory listing
    // of 200 entries is 200 stats, and serial stats make the section appear
    // late by the sum instead of the max.
    const results = await Promise.all(
        candidates.map(async (candidate) => {
            if (signal?.aborted === true || Date.now() > deadline) return undefined
            return (await isRepo(candidate)) ? candidate : undefined
        }),
    )
    for (const candidate of results) {
        if (candidate !== undefined) found.push({ root: candidate, label: labelOf(candidate, location), depth: 1 })
    }
    return found
}

// The name a repository is drawn under. The location itself reads as "." so a
// single-repository project has no redundant folder name above its rows.
const labelOf = (root: string, location: string): string => {
    if (root === location) return "."
    const slash = root.lastIndexOf("/")
    return slash === -1 || slash === root.length - 1 ? root : root.slice(slash + 1)
}

// --- status -----------------------------------------------------------------

// Parse `git status --porcelain=v2 --branch -z`.
//
// The v2 format, NUL-terminated, is the only one that needs no unquoting: v1
// percent-encodes or quotes any path with a space or a non-ASCII byte, and
// undoing that by hand is a parser with its own bugs. v2 with `-z` emits paths
// verbatim.
//
// Record kinds:
//   # branch.oid <sha>            header
//   # branch.head <name>          header, "(detached)" when detached
//   # branch.upstream <ref>       header, absent when untracked
//   # branch.ab +<ahead> -<behind> header, absent when untracked
//   1 <XY> ... <path>             ordinary change
//   2 <XY> ... <path> NUL <orig>  rename or copy; the original follows in -z
//   u ...                          unmerged
//   ? <path>                       untracked
//   ! <path>                       ignored (not requested, but tolerated)
//
// Verified against git 2.43 output, not inferred.
export const parseStatus = (root: string, label: string, depth: number, out: string): Status => {
    // Mutable locals while parsing; the readonly Branch and Status are built
    // from them once. Assigning into the readonly type instead would need a
    // cast, which is exactly the cast that hides a shape change in git.
    let name = "HEAD"
    let upstream: string | undefined
    let ahead = 0
    let behind = 0
    const changes: Change[] = []

    // Split on NUL. The trailing element is "" and is dropped by the filter;
    // a rename's original path is its own element, which is why the record
    // index below advances by two rather than one.
    const records = out.split("\u0000")
    for (let index = 0; index < records.length; index += 1) {
        const record = records[index]!
        if (record === "") continue

        if (record.startsWith("# branch.head ")) {
            name = record.slice("# branch.head ".length)
            continue
        }
        if (record.startsWith("# branch.upstream ")) {
            upstream = record.slice("# branch.upstream ".length)
            continue
        }
        if (record.startsWith("# branch.ab ")) {
            // "+3 -1": ahead of and behind the upstream.
            const match = /^# branch\.ab \+(\d+) -(\d+)$/.exec(record)
            if (match !== null) {
                ahead = Number(match[1])
                behind = Number(match[2])
            }
            continue
        }
        if (record.startsWith("# ")) continue

        const kind = record[0]
        if (kind === "?") {
            // Untracked: nothing in the index by definition.
            // Untracked: nothing in the index by definition, and the working
            // tree column is the whole of it.
            changes.push({ path: record.slice(2), status: "?", index: "none", worktree: "untracked" })
            continue
        }
        if (kind === "!") continue

        if (kind === "2") {
            // `2 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <X><score> <path>`
            // followed, in -z, by the original path as its own record.
            const path = afterFields(record, 9)
            const from = records[index + 1] ?? ""
            index += 1
            changes.push({ path, status: renameLetter(record), from: from === "" ? undefined : from, ...columns(record) })
            continue
        }
        if (kind === "1" || kind === "u") {
            // `1 <XY> <sub> <mH> <mI> <mW> <hH> <hI> <path>` -- the path is
            // the ninth whitespace-delimited field, but it may itself contain
            // spaces, so it is read as "everything after the eighth field".
            changes.push({ path: afterFields(record, 8), status: changeLetter(record), ...columns(record) })
        }
    }

    // Sorted by path so two refreshes of an unchanged tree produce identical
    // rows: a reorder would repaint the sidebar for nothing.
    changes.sort((left, right) => (left.path < right.path ? -1 : left.path > right.path ? 1 : 0))
    const branch: Branch = upstream === undefined ? { name, ahead, behind } : { name, ahead, behind, upstream }
    return { repo: { root, label, depth }, branch, changes }
}

// The remainder of a record after its first `count` space-separated fields.
//
// The path is last and may hold spaces, so it cannot be reached by splitting:
// the record is walked field by field and everything left over is the path.
const afterFields = (record: string, count: number): string => {
    let at = 0
    for (let field = 0; field < count; field += 1) {
        const space = record.indexOf(" ", at)
        if (space === -1) return ""
        at = space + 1
    }
    return record.slice(at)
}

/** What one of the two columns says about a path. */
export type Column = "none" | "added" | "deleted" | "modified" | "renamed" | "conflicted" | "untracked"

// One XY pair as its two columns.
//
// "." is git's "unchanged in this column", and a space is the same in the
// unmerged records. Anything else is a change.
const columns = (record: string): { readonly index: Column; readonly worktree: Column } => {
    const x = record[2] ?? "."
    const y = record[3] ?? "."
    return { index: columnOf(x), worktree: columnOf(y) }
}

const columnOf = (letter: string): Column => {
    switch (letter) {
        case "A":
            return "added"
        case "D":
            return "deleted"
        case "R":
        case "C":
            return "renamed"
        case "U":
            return "conflicted"
        case ".":
        case " ":
            return "none"
        default:
            return "modified"
    }
}

// The status letter a source-control list shows for an ordinary record.
//
// The index column wins when there is one: `AM` is a file being *added* that
// was edited again afterwards, and listing it as `M` says the opposite of what
// the commit is about to do. The working-tree column is the answer only when
// nothing is staged. This is the letter VS Code's list draws for the same
// record.
const changeLetter = (record: string): string => {
    const x = record[2] ?? "."
    const y = record[3] ?? "."
    if (x !== "." && x !== " ") return x
    if (y !== "." && y !== " ") return y
    return "M"
}

const renameLetter = (record: string): string => {
    const xy = record.slice(2, 4)
    return xy[0] === "C" ? "C" : "R"
}

export const status = async (repo: Repo, signal?: AbortSignal): Promise<Status> => {
    const result = await git(repo.root, ["status", "--porcelain=v2", "--branch", "-z"], signal)
    if (!result.ok) {
        return { repo, branch: { name: "HEAD", ahead: 0, behind: 0 }, changes: [], error: result.error }
    }
    return parseStatus(repo.root, repo.label, repo.depth, result.out)
}

// Every repository's status, in discovery order.
//
// Concurrent, because git status is I/O-bound and the repositories are
// independent: three repositories cost one round trip rather than three in a
// row. A failing repository is kept as a row carrying its error rather than
// dropped, since a repository that stopped reporting is what you need to see.
export const statusAll = async (repos: readonly Repo[], signal?: AbortSignal): Promise<readonly Status[]> =>
    Promise.all(repos.map((repo) => status(repo, signal)))

// --- diff -------------------------------------------------------------------

// A per-file byte budget for one diff. A generated file's diff can be tens of
// megabytes, and drawing it is the one thing that can kill the TUI; the cap
// makes the worst case a truncated patch marked `more`.
export const DIFF_LIMIT = 400 * 1024

// One file's unified diff, against the working tree or the index.
//
// `staged` picks the comparison: unstaged reads `git diff`, staged reads
// `git diff --cached`. Untracked files have neither, so they are diffed against
// the empty tree explicitly -- `git diff --no-index /dev/null <path>` -- which
// is the only way to see a new file's contents without adding it to the index.
export const diff = async (
    repo: Repo,
    path: string,
    options: { readonly staged: boolean; readonly untracked?: boolean },
    signal?: AbortSignal,
): Promise<Diff> => {
    const args = ["diff", "--no-color", "--no-ext-diff"]
    if (options.untracked === true) args.push("--no-index", "/dev/null", path)
    else if (options.staged) args.push("--cached", "--", path)
    else args.push("--", path)

    // --no-index exits 1 when the files differ, which is every non-empty diff,
    // so a non-zero status is not a failure here. An empty patch is what a
    // binary file, an ignored path, or a genuine error all look like, and none
    // of the three should keep the file's row off the screen.
    const result = await git(repo.root, args, signal, DIFF_LIMIT)
    if (!result.ok) return { path, patch: "", more: false }
    const more = result.out.length >= DIFF_LIMIT - 1
    return { path, patch: more ? result.out.slice(0, DIFF_LIMIT) : result.out, more }
}

// A file's whole contents, for a file that is entirely new.
//
// A unified diff of a new file is one hunk of nothing but additions, and a
// two-column diff of that is a wall of blanks on the left. The right pane draws
// the file itself instead, which is what there is to read.
//
// "New" means git has no previous version: an untracked file is read from the
// working tree, and a staged addition (`A.` or `AM`) from the index. Reading
// the index rather than the working tree for the staged case is deliberate --
// it shows what the commit will contain, not what the file looked like when it
// was last saved.
// A file's whole contents, for a group that has no old side to diff against.
//
// Which side is read depends on the group, for the same reason `isNewFile`
// does:
//
//   * staged -- `git show :path` reads the index, which is exactly what the
//     commit will contain. Not the working tree: that may hold edits made after
//     staging, and showing those under a Staged entry would be a lie;
//   * untracked -- `git show :path` has nothing to read, because an untracked
//     file was never added. The working tree is the only copy, so read the file.
export const contents = async (
    repo: Repo,
    path: string,
    options: { readonly staged: boolean },
    signal?: AbortSignal,
): Promise<Diff> => {
    const args = options.staged ? ["show", `:${path}`] : ["show", `HEAD:${path}`]
    const result = await git(repo.root, args, signal, DIFF_LIMIT)
    if (!result.ok) {
        // An untracked file has no blob anywhere; the file on disk is the whole
        // of it. Read it directly rather than failing the pane.
        const disk = await readFile(join(repo.root, path), "utf8").catch(() => undefined)
        if (disk === undefined) return { path, patch: "", more: false }
        const more = disk.length >= DIFF_LIMIT - 1
        return { path, patch: more ? disk.slice(0, DIFF_LIMIT) : disk, more }
    }
    const more = result.out.length >= DIFF_LIMIT - 1
    return { path, patch: more ? result.out.slice(0, DIFF_LIMIT) : result.out, more }
}

// Whether a file has nothing on the side it is being compared against, so the
// pane shows the whole file rather than a two-column diff of pure additions.
//
// This is per *group*, not per file, which is the distinction that matters: an
// `AM` file is new when you click it under Staged Changes (the index adds it,
// so there is no old side) and is *not* new under Changes (the index is the old
// side, and the working tree has edits to diff against it). Judging from the
// file alone read `AM` as new in both groups and drew the whole file where a
// diff was wanted.
//
//   * staged  -- compared against the index. New when the index added it.
//   * unstaged -- compared against the working tree. New only when nothing is
//     tracked at all, which is an untracked file.
export const isNewFile = (
    change: { readonly index: Column; readonly worktree: Column },
    staged: boolean,
): boolean => (staged ? change.index === "added" : change.worktree === "untracked")

// The row each hunk starts on, within the text `<diff>` draws.
//
// Lives here rather than in `panel.ts`: this file is the one the pane already
// imports successfully (`diff`, `discover` and the rest resolve), and the helper
// answers a question about git's output -- where the `@@` lines are -- so this
// is where it belongs anyway.
//
// The file headers are skipped rather than counted, because `<diff>` does not
// draw them: counting them would put every jump that many rows too high.
export const hunkPositions = (patch: string): number[] => {
    const starts: number[] = []
    let row = 0
    for (const text of patch.split("\n")) {
        if (text.startsWith("diff --git ") || text.startsWith("index ")) continue
        if (text.startsWith("--- ") || text.startsWith("+++ ")) continue
        if (text.startsWith("@@")) starts.push(row)
        row += 1
    }
    return starts
}

// --- writes -----------------------------------------------------------------

// One mutex per repository root.
//
// git takes its own lock on the index and on refs, and reports a second writer
// as "another git process seems to be running". Serialising here turns an
// intermittent, confusing failure into a queue, which matters because the
// panel invites a click on Commit and a click on Push in quick succession.
const locks = new Map<string, Promise<unknown>>()

const serialise = async <T>(root: string, work: () => Promise<T>): Promise<T> => {
    const previous = locks.get(root) ?? Promise.resolve()
    // `then` on both settle paths: a failed operation must not wedge the queue.
    const next = previous.then(work, work)
    const settled = next.then(
        () => undefined,
        () => undefined,
    )
    locks.set(root, settled)
    try {
        return await next
    } finally {
        // Only the tail of the queue removes itself. A later caller has already
        // replaced this entry, and deleting it then would let a third caller
        // start alongside it.
        if (locks.get(root) === settled) locks.delete(root)
    }
}

export type Action = "commit" | "pull" | "push" | "fetch" | "stage" | "unstage"

export type Result = { readonly ok: true; readonly out: string } | { readonly ok: false; readonly error: string }

// The commands the panel's buttons run.
//
// Every one is a separate, explicit git invocation -- no `-A`, no `--force`, no
// rebase. Pull is `--ff-only` on purpose: a merge conflict in a TUI with no
// editor is a repository stuck mid-merge, and a fast-forward that cannot happen
// fails with a message the model and the user can both read.
export const run = async (repo: Repo, action: Action, options: { readonly message?: string; readonly path?: string } = {}, signal?: AbortSignal): Promise<Result> =>
    serialise(repo.root, async () => {
        const args: string[] = []
        switch (action) {
            case "commit":
                // A message is required: an editor would be opened without one
                // and the TUI has no way to drive it.
                if (options.message === undefined || options.message.trim() === "") {
                    return { ok: false, error: "a commit message is required" }
                }
                args.push("commit", "-m", options.message)
                break
            case "pull":
                args.push("pull", "--ff-only")
                break
            case "push":
                args.push("push")
                break
            case "fetch":
                args.push("fetch", "--quiet")
                break
            case "stage":
                if (options.path === undefined) return { ok: false, error: "no path to stage" }
                args.push("add", "--", options.path)
                break
            case "unstage":
                if (options.path === undefined) return { ok: false, error: "no path to unstage" }
                args.push("restore", "--staged", "--", options.path)
                break
        }

        const result = await git(repo.root, args, signal)
        if (!result.ok) return { ok: false, error: redact(result.error) }
        // Commit reports on stderr and exits 0 when there was nothing staged;
        // say so rather than showing an empty success.
        const out = redact(result.out).trim()
        if (action === "commit" && /nothing to commit|nothing added to commit/i.test(out)) {
            return { ok: false, error: "nothing staged to commit" }
        }
        return { ok: true, out }
    })

// Keep a token out of anything shown on screen.
//
// A remote URL can embed credentials (`https://user:token@host/repo`), and
// git's error output quotes the remote it failed to reach. Anything shaped
// like a URL's userinfo is replaced. This is a display guard, not a parser:
// it cannot know every credential shape, and the failure it prevents is a
// secret on screen, which is worth a blunt pattern.
const redact = (text: string): string => text.replace(/\/\/[^\s/@]+@/g, "//***@")

// Whether this branch has an upstream to push to or pull from.
export const hasUpstream = (branch: Branch): boolean => branch.upstream !== undefined
