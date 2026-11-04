import { Plugin } from "@opencode/plugin/tui"
import { SyntaxStyle, type RGBA } from "@opentui/core"
import { Show, For, createMemo } from "solid-js"
import { contents, diff, discover, hunkPositions, isNewFile, run, statusAll, type Repo, type Status } from "./git"
import {
    actions,
    branchLine,
    buildRows,
    buildView,
    changeLine,
    INDENT_WIDTH,
    diffLines,
    filetypeOf,
    groupChanges,
    headLine,
    hintFor,
    pending,
    panes,
    SECTION,
    soleRepository,
    toneOf,
    totalChanges,
    untrackedPaths,
    WIDTH,
    type Line,
    type PairedRow,
    type RepoRow,
    type Tone,
} from "./panel"

// A **Source Control** section in the sidebar, and a full-screen view behind it.
//
// The sidebar answers three questions at a glance: is this a repository, which
// branch, and is there work. The view is where the work happens: per-file
// rows, the diff of the selected file, and the five buttons -- commit, pull,
// push, fetch, refresh.
//
// Why it is fast, given that git is a subprocess and a panel repaints:
//
//   * **No clock.** The section is not animated, so it has no timer. Nothing
//     here wakes the process when nothing changed. That is the whole
//     performance story compared with a polling design.
//   * **Refresh is event-driven and debounced.** The panel refreshes when it is
//     opened, when a button is pressed, and when the host reports a session
//     change that could have touched files. A burst of changes collapses into
//     one `git status` per repository.
//   * **One spawn per repository per refresh**, and discovery -- the part that
//     walks the directory -- shells out not at all.
//   * **Render draws, it does not decide.** Every row is composed in panel.ts
//     before the JSX sees it, so a repaint maps strings to text elements. The
//     subagent-watch lesson: decisions in the render are what make a panel
//     slow, because they run on every frame.
//   * **A refresh is cancelled when it is superseded**, so a slow repository
//     cannot pile up work behind a fast one.
//
// The snapshot lives in a memory store rather than being read from opencode's
// Vcs domain. The domain describes the location's own repository only, and this
// section spans the location plus every repository one level down -- so the
// rows have no other home. Memory, not durable: a restart re-reads status, which
// is a cheap read and the only correct value.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

// The part of the scrollbox a jump needs. The host owns the element type, so
// only the one method is named rather than importing the whole renderable.
type ScrollHandle = { scrollTo(position: number): void }

// How long a change notification is allowed to settle before a refresh runs.
//
// A code-generation turn touches dozens of files in a few hundred ms. Without
// this, each touch is its own `git status` per repository; with it, the burst
// is one. Short enough that the section still feels live.
const DEBOUNCE_MS = 400

// How long the sidebar's list may stand before it is read again. Chosen against
// how often the section is looked at, not against how fast a file can change:
// a repository that moved a minute ago is still worth knowing about, and a read
// costs one `git status` per repository.
const SIDEBAR_TTL_MS = 30_000

// The tone tokens, mapped once into colours the renderer takes.
//
// Takes the theme the plugin context hands over -- the same type the host uses,
// so a token that stops existing is a compile error rather than a black row.
// A small table rather than a switch keeps it one line per tone and makes the
// default obvious.
const palette = (theme: {
    readonly text: {
        readonly base: RGBA
        readonly muted: RGBA
        readonly feedback: Record<string, { readonly base: RGBA }>
    }
    readonly hue: { readonly interactive: Record<string, RGBA> }
}) => {
    const table: Record<Tone, unknown> = {
        base: theme.text.base,
        muted: theme.text.muted,
        added: theme.text.feedback.success.base,
        removed: theme.text.feedback.error.base,
        hunk: theme.hue.interactive[200],
        header: theme.text.base,
        error: theme.text.feedback.error.base,
    }
    return {
        colour: (tone: Tone) => table[tone] as string | RGBA,
        base: theme.text.base,
        muted: theme.text.muted,
    }
}

// The name the panel registers under. Plugin-prefixed, because slot names are
// shared selection values rather than registered claims.
const NAME = "source-control.view"

// The section header's press identity. It cannot collide with a repository
// root, because a root is always an absolute path.
const SECTION_KEY = "\u0000section"

// How many files a repository shows in the sidebar before the rest is folded
// into a count. The sidebar is 37 columns wide and the full-screen view is
// where a long list belongs.
const MAX_FILES = 4

export default Plugin.define({
    id: "dotfiles.source-control.tui",
    setup(context) {
        // The snapshot a render draws from. `rows` is what discovery and status
        // produced, `version` what the render reads to subscribe to a landed
        // refresh without comparing contents, and `patch` the diff of the file
        // selected in the view.
        //
        // `generation` invalidates a snapshot written by older code. Memory
        // storage survives a plugin reload, so a change to the shape of
        // `RepoRow` would otherwise leave rows from the previous build in the
        // store and draw them with the new renderer -- which is how a file
        // ended up under both Staged Changes and Changes carrying a letter
        // neither column agreed with. A generation that does not match this
        // build means the snapshot is not ours to read: drop it, and the first
        // render reads again.
        const GENERATION = 4
        const [state, setState] = context.storage.memory("source-control", {
            initial: {
                generation: GENERATION,
                rows: [] as RepoRow[],
                version: 0,
                loading: false,
                patch: "" as string,
                // True when `patch` is a whole file rather than a diff, and
                // when the byte budget cut it short.
                fresh: false,
                truncated: false,
                // How many hunks the patch has, and which one the view is on.
                // A diff is read by jumping to the next change, not by
                // scrolling, and this is what the buttons step through.
                hunks: 0,
                hunk: 0,
                // The tree-sitter language of the file on screen, and the
                // host's own style for it. Both are undefined for a file with
                // no grammar, which draws as plain text.
                filetype: "" as string,
                // Why the last read failed, when it did. Empty on success.
                failure: "" as string,
                // The group the last read was for, so the diagnostic above can
                // say which side was being compared.
                lastStaged: false,
            },
        })

        // Discard whatever a previous build left, once, before a render reads it.
        if (state.generation !== GENERATION) {
            setState((draft) => {
                draft.generation = GENERATION
                draft.rows = []
                draft.version = 0
                draft.loading = false
                draft.patch = ""
                draft.fresh = false
                draft.truncated = false
                draft.hunks = 0
                draft.hunk = 0
                draft.filetype = ""
                draft.failure = ""
                draft.lastStaged = false
            })
        }

        // The repository the view is showing and the file selected within it.
        // UI state, not data, so it is a plain variable with its own store: a
        // selection change must not trigger the status refresh path.
        const [view, setView] = context.storage.memory("source-control-view", {
            initial: { repo: "" as string, path: "" as string, staged: false },
        })

        // Whether the section is folded, and whether each repository's file list
        // is. Memory storage, so it survives a plugin reload and resets when the
        // TUI exits -- the same lifetime subagent-watch gives its collapse state.
        //
        // Repositories are keyed by root rather than by index, because the one
        // kept open is the one being worked in and a reorder would otherwise
        // fold a different repository.
        const [fold, setFold] = context.storage.memory("source-control-fold", {
            initial: { section: false, repos: {} as Record<string, boolean> },
        })

        // The host's syntax style, built once per plugin generation.
        //
        // `generateSyntax` is opencode's own theme-to-tree-sitter mapping, so a
        // diff is coloured with the palette the rest of the TUI uses rather
        // than a second one invented here. Built lazily and destroyed on
        // dispose: an OpenTUI resource owned by a plugin must be freed with it.
        // `@opencode/theme` cannot be resolved from a plugin directory under
        // `~/.config/opencode/plugins/`, so `generateSyntax` is not available
        // here -- importing it failed the whole `tui.tsx` load, which is why
        // every render kept using a stale module. `@opentui/core` *is* a peer
        // dependency the host provides, so the style is built from it directly.
        //
        // The palette is the theme's own, so a diff is coloured like the rest of
        // the TUI. Only the handful of token kinds the pane actually shows are
        // named; tree-sitter falls back to `default` for the rest.
        let syntaxStyle: SyntaxStyle | undefined
        try {
            syntaxStyle = SyntaxStyle.fromStyles({
                default: { fg: context.theme.text.base },
                comment: { fg: context.theme.text.muted, italic: true },
                keyword: { fg: context.theme.text.feedback.info.base },
                string: { fg: context.theme.text.feedback.success.base },
                number: { fg: context.theme.text.feedback.warning.base },
                "function": { fg: context.theme.text.feedback.info.base },
                type: { fg: context.theme.text.feedback.warning.base },
                variable: { fg: context.theme.text.base },
                property: { fg: context.theme.text.base },
                operator: { fg: context.theme.text.muted },
                punctuation: { fg: context.theme.text.muted },
            }, context.renderer.nativeScene)
        } catch {
            // A host whose OpenTUI rejects one of these token names still draws:
            // the pane falls back to plain text rather than failing to load.
            syntaxStyle = undefined
        }

        // The scrollbox the diff pane drew, so a jump can move it. Reassigned by
        // every render's `ref`, and undefined until the pane has drawn once.
        let scroll: ScrollHandle | undefined

        // The session whose repositories were read for the panel currently on
        // screen, so a re-open reads again and a repaint does not.
        let shownFor: string | undefined

        // Which row a held press started on, at plugin scope rather than inside
        // the render: a repaint replaces the handlers with fresh closures, and
        // state kept in one of those is lost between the press and the release.
        // The same guard, for the same reason, as subagent-watch.
        let pressed: string | undefined

        // Where the plugin is looking. Per render, from the session on screen:
        // captured at setup, it would keep answering for whichever project was
        // open then.
        type Location = Parameters<typeof context.data.shell.list>[0]
        const at = (sessionID: string | undefined): Location =>
            (sessionID === undefined ? undefined : context.data.session.get(sessionID))?.location ??
            context.data.location.default()

        // The in-flight refresh, so a newer one can stand the older one down.
        // A cancelled refresh must not write its stale result over a fresh one.
        let inflight: AbortController | undefined
        let timer: ReturnType<typeof setTimeout> | undefined
        let disposed = false

        // When the last read landed, and whether a debounced one is already
        // waiting. The sidebar repaints constantly -- every keystroke in the
        // prompt is a render of the whole sidebar -- so it cannot read on every
        // render, and it cannot read only once either: that is the stale list
        // this replaces. Named `queued`, not `pending`: `pending` is the row a
        // repository is drawn as before its status lands, and this file bundles
        // into the same scope as the module that defines it.
        let readAt = 0
        let queued = false

        // Read the repositories and their statuses, once, and publish them.
        //
        // Every failure becomes a row carrying its error rather than an empty
        // section: a repository that stopped reporting is exactly what you need
        // to see, and an empty sidebar reads as "not a repository".
        const refresh = async (where: Location) => {
            if (disposed || where === undefined) return
            inflight?.abort()
            const controller = new AbortController()
            inflight = controller
            const directory = where.directory
            if (directory === undefined) return

            setState((draft) => {
                draft.loading = true
            })
            try {
                const repos: readonly Repo[] = await discover(directory, controller.signal)
                // Publish discovery immediately, so the section appears on the
                // first tick with branch names filling in a moment later. An
                // empty section that pops into existence is worse than one that
                // says "reading".
                if (controller.signal.aborted) return
                setState((draft) => {
                    draft.rows = repos.map(pending)
                    draft.version += 1
                })

                const statuses: readonly Status[] = await statusAll(repos, controller.signal)
                if (controller.signal.aborted || disposed) return
                readAt = Date.now()
                setState((draft) => {
                    draft.rows = buildRows(statuses)
                    draft.loading = false
                    draft.version += 1
                })
            } catch {
                if (controller.signal.aborted || disposed) return
                setState((draft) => {
                    draft.loading = false
                })
            } finally {
                if (inflight === controller) inflight = undefined
            }
        }

        // Coalesce a burst of notifications into one refresh.
        const schedule = (where: Location) => {
            // A burst of renders must not restart the timer forever, which is
            // what a bare `clearTimeout` on every call would do while the user
            // types.
            if (queued) return
            queued = true
            if (timer !== undefined) clearTimeout(timer)
            timer = setTimeout(() => {
                timer = undefined
                queued = false
                void refresh(where)
            }, DEBOUNCE_MS)
            // The timer is the debounce, not a poll: it exists for DEBOUNCE_MS
            // after the last notification and then goes away. `unref` keeps it
            // from holding the loop open on its own in the fallback runtime.
            ;(timer as { unref?: () => void }).unref?.()
        }

        // The file selected in the view, read on demand rather than kept fresh:
        // a diff is only worth computing when it is about to be drawn.
        // The selected file's body, read on demand rather than kept fresh.
        //
        // What comes back depends on the file: an entirely new one is shown in
        // full, because the alternative is a two-column diff that is all blanks
        // on the left. Anything else is a diff, which the pane pairs itself.
        const loadDiff = async (row: RepoRow, path: string, staged: boolean) => {
            const repo: Repo = { root: row.root, label: row.label, depth: 0 }
            const untracked = !staged && untrackedPaths(row).has(path)
            const change = row.changes.find((candidate) => candidate.path === path)
            // Judged for the group that was clicked, not for the file: an `AM`
            // file is new under Staged and an ordinary edit under Changes.
            const fresh = change !== undefined && isNewFile(change, staged)
            // A failed read must say so rather than leaving `patch` empty. An
            // empty patch renders as "No textual diff for this file", which
            // reads as "git had nothing to show" and hides the real reason a
            // file that certainly has a diff is blank.
            let result
            try {
                result = fresh
                    ? await contents(repo, path, { staged })
                    : await diff(repo, path, { staged, untracked })
            } catch (error) {
                if (disposed) return
                const reason = error instanceof Error ? error.message : String(error)
                setState((draft) => {
                    draft.patch = ""
                    draft.failure = reason
                })
                return
            }
            if (disposed) return
            const starts = fresh ? [] : hunkPositions(result.patch)
            setState((draft) => {
                draft.patch = result.patch
                draft.failure = ""
                draft.lastStaged = staged
                draft.fresh = fresh
                draft.truncated = result.more
                // Opening on the first hunk rather than on the top of the file
                // is the whole point: the context above it is the part nobody
                // needs to read first.
                draft.hunks = starts.length
                draft.hunk = 0
                draft.filetype = filetypeOf(path) ?? ""
            })
            if (starts.length > 0) scrollTo(0)
        }

        // Step the diff to the next or previous hunk.
        //
        // Wraps, because a diff with three hunks is a short list you cycle
        // through rather than a document with an end to stop at.
        const jump = (direction: -1 | 1) => {
            if (state.hunks === 0) return
            const next = (state.hunk + direction + state.hunks) % state.hunks
            setState((draft) => {
                draft.hunk = next
            })
            const line = hunkPositions(state.patch)[next]
            if (line !== undefined) scrollTo(line)
        }

        // Move the scrollbox to a row, once the render that owns it has landed.
        // A ref assigned in this render may still be the previous element, so
        // the call is deferred by a microtask rather than read immediately.
        const scrollTo = (line: number) => {
            queueMicrotask(() => {
                const target = scroll
                if (target === undefined) return
                target.scrollTo(line)
            })
        }

        // Run one of the five actions, then refresh.
        //
        // A failure is a toast, not a throw: a push rejected because the remote
        // moved is an ordinary outcome, and taking the panel down over it would
        // lose the list you were reading.
        const act = async (row: RepoRow, id: "commit" | "pull" | "push" | "fetch" | "refresh", where: Location) => {
            const repo: Repo = { root: row.root, label: row.label, depth: 0 }
            if (id === "refresh") {
                await refresh(where)
                return
            }
            if (id === "commit") {
                const message = await context.ui.dialog.prompt({
                    title: `Commit in ${row.label}`,
                    description: row.ahead === 0 ? "This commits what is already staged." : "This commits what is already staged.",
                    placeholder: "Commit message",
                })
                if (message === undefined || message.trim() === "") return
                const result = await run(repo, "commit", { message })
                context.ui.toast.show(
                    result.ok
                        ? { title: "Committed", message: row.label, variant: "success" }
                        : { title: "Commit failed", message: result.error, variant: "error" },
                )
                await refresh(where)
                return
            }

            context.ui.toast.show({ title: `${id === "push" ? "Pushing" : id === "pull" ? "Pulling" : "Fetching"} ${row.label}`, message: "…", variant: "info" })
            const result = await run(repo, id)
            context.ui.toast.show(
                result.ok
                    ? { title: "Done", message: `${id} ${row.label}`, variant: "success" }
                    : { title: `${id} failed`, message: result.error, variant: "error" },
            )
            await refresh(where)
        }

        // The full-screen view. A session panel, so the host owns sizing,
        // focus and full-screen presentation, and closing it disposes this
        // contribution's layer.
        //
        // `buildView` already lays out the header, the hint, the action bar and
        // one row per file, so the panel draws that list and adds only what a
        // static list cannot: a selected row that can be clicked, and the diff
        // of that row underneath.
        const panel = context.ui.slot({
            append: "session.panel",
            render: (slot) => {
                if (slot.name !== NAME) {
                    // The panel is no longer the selected one, so the next time
                    // it is selected is a fresh opening and must read again.
                    // Without this the guard below would see the same session
                    // id as last time and skip the refresh -- which is the cache
                    // it exists to defeat.
                    shownFor = undefined
                    return null
                }

                // Reading version subscribes this render to a landed refresh.
                void state.version
                const where = at(slot.sessionID)
                const row = state.rows.find((candidate) => candidate.root === view.repo) ?? state.rows[0]

                // Every time the panel is shown, read the repository again.
                //
                // The snapshot outlives a close -- it lives in memory storage so
                // a fold survives a reload -- which means opening the view twice
                // showed the second one whatever the first had found, however
                // long ago that was. Files staged from a shell, or a commit made
                // outside this plugin, were invisible until something else
                // happened to refresh.
                //
                // The guard is an identity rather than a boolean so it runs once
                // per opening, not on every repaint: `shownFor` records the panel
                // that was last read, and comparing it to the current one is what
                // makes "opened again" visible.
                if (shownFor !== slot.sessionID) {
                    shownFor = slot.sessionID
                    void refresh(where)
                }

                const colours = palette(context.theme)
                const lines = createMemo(() => buildView(row))
                // The diff's own background tokens, read once per render rather
                // than per row. Defaulted with `?.`: a theme from before these
                // tokens existed leaves them undefined, and `<diff>` then keeps
                // its built-in red and green instead of drawing a blank band.
                const diffBg = context.theme.diff?.background
                const diffText = context.theme.diff?.text
                const diffNo = context.theme.diff?.lineNumber?.background
                const enabled = (id: string) => row !== undefined && actions(row).some((action) => action.id === id && action.enabled)

                // The panel's own press guard. Separate from the sidebar's:
                // each render creates fresh closures, so the armed identity
                // lives at plugin scope and this only decides which of the
                // panel's own handlers may act on it.
                let armed: string | undefined
                const arm = (id: string) => (event: MouseEvent) => {
                    armed = id
                    event.stopPropagation()
                }
                const fire = (id: string, run: () => void) => (event: MouseEvent) => {
                    const was = armed
                    armed = undefined
                    event.stopPropagation()
                    event.preventDefault()
                    if (was !== id) return
                    run()
                }

                // The staged flag follows the group the row was drawn under: a
                // staged file diffs against the index, an unstaged one against
                // the working tree.
                const choose = async (path: string, staged: boolean) => {
                    if (row === undefined) return
                    setView((draft) => {
                        draft.path = path
                        draft.staged = staged
                    })
                    await loadDiff(row, path, staged)
                }

                // The split. `slot.width` is the panel the host gave us; when
                // there is not room for two panes the list is drawn alone,
                // full width, which is the half you need to navigate with.
                const split = panes(slot.width)

                // The left pane: the repository header, the action bar, and the
                // file groups. Everything clickable lives here.
                const listPane = (
                    <box flexDirection="column" gap={0} flexShrink={0} width={split === undefined ? undefined : split.list}>
                        <For each={lines()}>
                            {(line: Line) => (
                                <text wrapMode="none" fg={colours.colour(line.tone)}>
                                    {line.text}
                                </text>
                            )}
                        </For>
                        <Show when={row !== undefined && row.changes.length > 0}>
                            <For each={row === undefined ? [] : groupChanges(row)}>
                                {(group) => (
                                    <box flexDirection="column" gap={0} marginTop={1}>
                                        <text wrapMode="none" fg={colours.base}>
                                            {`${group.title} ${String(group.changes.length)}`}
                                        </text>
                                        <For each={group.changes}>
                                            {(change) => {
                                                // Keyed by group as well: a file staged and
                                                // edited again appears under both, and the
                                                // press guard must tell the rows apart.
                                                const key = `${row.root}\u0000${String(group.staged)}\u0000${change.path}`
                                                const selected = () =>
                                                    view.path === change.path && view.staged === group.staged
                                                // Name bright, directory dim -- the same split the
                                                // sidebar draws, so a row reads the same in both
                                                // places. The width is the pane's, not the
                                                // sidebar's.
                                                const cells = changeLine(
                                                    { path: change.path, status: change.letter },
                                                    split === undefined ? WIDTH : split.list,
                                                )
                                                return (
                                                    <box
                                                        onMouseDown={arm(key)}
                                                        onMouseUp={fire(key, () => void choose(change.path, group.staged))}
                                                    >
                                                        <text wrapMode="none" fg={selected() ? colours.base : colours.muted}>
                                                            {`${selected() ? "▸" : " "} `}
                                                            <span style={{ fg: colours.colour(toneOf(cells.letter)) }}>
                                                                {cells.letter}
                                                            </span>
                                                            {` ${cells.name}`}
                                                            {cells.directory === "" ? "" : ` ${cells.directory}`}
                                                        </text>
                                                    </box>
                                                )
                                            }}
                                        </For>
                                    </box>
                                )}
                            </For>
                        </Show>
                    </box>
                )

                // The right pane: the selected file's diff, or the one line that
                // says why there is none.
                // The width the diff pane actually has, after the split and the
                // padding, which is what a paired row divides in half.
                const diffWidth = () => (split === undefined ? Math.max(40, slot.width - 2) : split.diff)

                // The right pane. What it draws depends on what the file is:
                //
                //   * entirely new -- the whole file, one column. A diff of an
                //     addition is one hunk of nothing but `+` lines, and pairing
                //     that gives a wall of blanks on the left;
                //   * anything else -- a two-column diff, old on the left, new
                //     on the right.
                // The right pane.
                //
                // Both bodies are the host's own renderables rather than
                // anything drawn here:
                //
                //   * a patch -- `<diff view="split">`, which owns the two
                //     columns, the gutters, the hunk folding and the syntax
                //     colours. Writing that by hand meant re-deriving what a
                //     diff is, and getting the pairing subtly wrong;
                //   * a whole new file -- `<code>`, the same highlighter
                //     opencode's own file preview uses.
                //
                // Both sit in a `<scrollbox>`, so a long file scrolls instead
                // of being clipped at the bottom of the panel.
                //
                // `view` is listed before `diff` on purpose: the `diff` setter
                // rebuilds the body immediately and reads `view` at that moment.
                // Listed after `diff`, the renderable is still on its default
                // `unified` when the first build runs and the split never
                // happens -- one column, which is what it drew.
                // The diff pane's usable width, in columns. `<diff>` lays itself
                // out from `this.width`, and a stretched child inside a bordered
                // box reports 0 until a layout pass has run -- so the split body
                // was built at the wrong width and overflowed to the left, over
                // the close button. Every level below gets the number explicitly.
                const paneWidth = split === undefined ? Math.max(40, slot.width - 2) : split.diff - 1
                const diffPane = (
                    <box flexDirection="column" gap={0} flexGrow={1} paddingLeft={1} width={paneWidth + 1} height="100%">
                        <Show
                            when={view.path !== ""}
                            fallback={
                                <text wrapMode="none" fg={colours.muted}>
                                    Select a file to see its diff.
                                </text>
                            }
                        >
                            {/* One row, fixed height, and never shrunk.
                                Without `height` this row reported 0 in a column
                                layout and the scrollbox below drew over it --
                                the filename colliding with the first diff line. */}
                            <box flexDirection="row" justifyContent="space-between" height={1} flexShrink={0}>
                                <text wrapMode="none" fg={colours.base}>{view.path}</text>
                                {/* Jump between hunks: a diff is read by going
                                    to the next change, not by scrolling. */}
                                {/* Always drawn, and blank rather than absent when
                                    there is nowhere to jump: a row that appears
                                    for a multi-hunk file and disappears for a
                                    single-hunk one moves everything below it by
                                    a line, which is the shift this avoids. */}
                                <box flexDirection="row" gap={1} height={1} flexShrink={0}>
                                    <Show when={!state.fresh && state.hunks > 1}>
                                        <HunkButton label="‹ prev" onClick={() => jump(-1)} colours={colours} />
                                        <text wrapMode="none" fg={colours.muted}>
                                            {`${String(state.hunk + 1)}/${String(state.hunks)}`}
                                        </text>
                                        <HunkButton label="next ›" onClick={() => jump(1)} colours={colours} />
                                    </Show>
                                </box>
                            </box>
                            <Show
                                when={state.patch !== ""}
                                fallback={
                                    // A blank pane has three different causes -- git
                                    // had nothing, the read failed, or the row was
                                    // never selected -- and one line naming which is
                                    // worth far more than a sentence that names none.
                                    <box flexDirection="column" gap={0}>
                                        <text wrapMode="none" fg={colours.colour("error")}>
                                            {state.failure === ""
                                                ? "No textual diff for this file."
                                                : `Could not read: ${state.failure}`}
                                        </text>
                                        <text wrapMode="none" fg={colours.muted}>
                                            {`staged=${String(state.lastStaged)} fresh=${String(state.fresh)} bytes=${String(state.patch.length)}`}
                                        </text>
                                        <text wrapMode="none" fg={colours.muted}>
                                            {`repo=${row?.root ?? "?"} change=${row?.changes.some((c) => c.path === view.path) === true ? "found" : "MISSING"}`}
                                        </text>
                                    </box>
                                }
                            >
                                <scrollbox
                                    flexGrow={1}
                                    width={paneWidth}
                                    scrollY
                                    stickyScroll={false}
                                    ref={(element: unknown) => {
                                        scroll = element as ScrollHandle | undefined
                                    }}
                                >
                                    <Show when={syntaxStyle !== undefined} fallback={
                                        <text wrapMode="none" fg={colours.muted}>{state.patch}</text>
                                    }>
                                        <Show when={state.fresh} fallback={
                                            <diff
                                                width={paneWidth}
                                                view="split"
                                                syncScroll
                                                diff={state.patch}
                                                filetype={state.filetype === "" ? undefined : state.filetype}
                                                syntaxStyle={syntaxStyle!}
                                                showLineNumbers
                                                lineNumberFg={context.theme.text.faint}
                                                addedBg={diffBg?.added}
                                                removedBg={diffBg?.removed}
                                                contextBg={diffBg?.context}
                                                addedContentBg={diffBg?.added}
                                                removedContentBg={diffBg?.removed}
                                                contextContentBg={diffBg?.context}
                                                addedSignColor={diffText?.added}
                                                removedSignColor={diffText?.removed}
                                                addedLineNumberBg={diffNo?.added}
                                                removedLineNumberBg={diffNo?.removed}
                                            />
                                        }>
                                            <code
                                                width={paneWidth}
                                                content={state.patch}
                                                filetype={state.filetype === "" ? undefined : state.filetype}
                                                syntaxStyle={syntaxStyle!}
                                                wrapMode="none"
                                                drawUnstyledText
                                            />
                                        </Show>
                                    </Show>
                                    <Show when={state.truncated}>
                                        <text wrapMode="none" fg={colours.muted}>{ELLIPSIS_TRUNCATED}</text>
                                    </Show>
                                </scrollbox>
                            </Show>
                        </Show>
                    </box>
                )

                return (
                    <box flexDirection="column" gap={0} padding={1}>
                        {/* The one control the view needs but the list cannot
                            carry: a way out. Drawn above everything rather than
                            in a footer, because both panes scroll. */}
                        {/* The bar is one row, full width, and never grows: a body
                            that overflows must clip inside its own pane rather
                            than push this down or off the right edge. */}
                        <box flexDirection="row" justifyContent="flex-end" width="100%" flexShrink={0}>
                            <box
                                onMouseDown={(event) => {
                                    event.stopPropagation()
                                }}
                                onMouseUp={(event) => {
                                    event.preventDefault()
                                    event.stopPropagation()
                                    slot.close()
                                }}
                            >
                                <text wrapMode="none" fg={colours.muted}>✕ close (esc)</text>
                            </box>
                        </box>
                        <Show when={split === undefined} fallback={
                            <box flexDirection="row" gap={0} flexGrow={1} alignItems="flex-start">
                                {listPane}
                                {/* The rule between the panes is the diff pane's own
                                    left border: one edge of a single-line box is
                                    exactly a divider, and it runs the height of the
                                    row without a text element per column. */}
                                <box
                                    flexDirection="column"
                                    gap={0}
                                    flexGrow={1}
                                    border={["left"]}
                                    borderStyle="single"
                                    borderColor={colours.muted}
                                >
                                    {diffPane}
                                </box>
                            </box>
                        }>
                            <box flexDirection="column" gap={0} flexGrow={1}>
                                {listPane}
                                {diffPane}
                            </box>
                        </Show>
                    </box>
                )
            },
        })

        // The sidebar section.
        const sidebar = context.ui.slot({
            append: "sidebar.content",
            render: (input) => {
                // Subscribes to a landed refresh and to a fold, so either
                // repaints the section.
                void state.version
                void fold.section
                const where = at(input.sessionID)

                // Read when there is nothing yet, and again once what is held has
                // aged past `SIDEBAR_TTL_MS`. The section is not a live view --
                // it has no clock and no event stream -- so a slow re-read while
                // it is on screen is what keeps it from disagreeing with the
                // repository for the rest of the session.
                const stale = state.rows.length === 0 || Date.now() - readAt > SIDEBAR_TTL_MS
                if (stale && !state.loading) schedule(where)

                const rows = state.rows
                if (rows.length === 0) return null

                const colours = palette(context.theme)

                const open = (row: RepoRow) => {
                    setView((draft) => {
                        draft.repo = row.root
                        draft.path = ""
                    })
                    setState((draft) => {
                        draft.patch = ""
                    })
                    context.ui.panel.open(NAME, { presentation: "fullscreen" })
                }

                const total = totalChanges(rows)
                const summary = total === 0 ? "" : ` (${total})`

                // The shared press/release guard. Every handler stops
                // propagation because the host binds the sidebar itself, and the
                // action only runs when the release lands on the row that was
                // pressed -- otherwise a press on one row and a release over
                // another acts on the one you did not click.
                const arm = (id: string) => (event: MouseEvent) => {
                    pressed = id
                    event.stopPropagation()
                }
                const fire = (id: string, run: () => void) => (event: MouseEvent) => {
                    const armed = pressed
                    pressed = undefined
                    event.stopPropagation()
                    event.preventDefault()
                    if (armed !== id) return
                    run()
                }

                // The section header. Its id cannot collide with a repository
                // root, which is always an absolute path.
                const toggleSection = () => {
                    setFold((draft) => {
                        draft.section = !draft.section
                    })
                }

                // With one repository -- the location itself -- there is nothing
                // to distinguish, so the label row is skipped and the branch
                // moves up onto the section header. A single "." above a list of
                // files names nothing the section title has not already said.
                const sole = soleRepository(rows)
                const only = rows[0]
                const detail = sole && only !== undefined ? branchLine(only) : summary

                return (
                    <box flexDirection="column" gap={0}>
                        <box flexDirection="row" onMouseDown={arm(SECTION_KEY)} onMouseUp={fire(SECTION_KEY, toggleSection)}>
                            <text wrapMode="none" fg={colours.base}>
                                {`${fold.section ? "▶" : "▼"} ${SECTION}`}
                            </text>
                            <Show when={detail !== ""}>
                                <text wrapMode="none" fg={colours.muted}>{` ${detail}`}</text>
                            </Show>
                        </box>
                        <Show when={!fold.section}>
                            <For each={rows}>
                                {(row) => {
                                    // With a single repository its files hang
                                    // directly under the section header, which
                                    // is what carries the branch and the fold --
                                    // reaching this point already means the
                                    // section is expanded, so there is no second
                                    // fold to consult.
                                    const inline = sole
                                    const folded = () => !inline && fold.repos[row.root] === true
                                    // A repository one level down carries the
                                    // bullet; the location's own does not.
                                    const head = headLine(row, folded(), row.label !== ".")
                                    const toggle = () => {
                                        setFold((draft) => {
                                            draft.repos[row.root] = !folded()
                                        })
                                    }
                                    return (
                                        <box flexDirection="column" gap={0}>
                                            <Show when={!inline}>
                                                <box
                                                    flexDirection="row"
                                                    onMouseDown={arm(row.root)}
                                                    onMouseUp={fire(row.root, toggle)}
                                                >
                                                    <text wrapMode="none" fg={colours.base}>
                                                        {`${head.marker} ${head.name} `}
                                                    </text>
                                                    <text wrapMode="none" fg={colours.muted}>{head.detail}</text>
                                                </box>
                                            </Show>
                                            <Show when={!folded()}>
                                                <Show when={row.error !== undefined}>
                                                    <text wrapMode="none" fg={colours.colour("error")}>{row.error}</text>
                                                </Show>
                                                <For each={row.changes.slice(0, MAX_FILES)}>
                                                    {(change) => {
                                                        // Keyed by repository too: two repositories
                                                        // commonly hold a file of the same name, and a
                                                        // bare path would arm one row and fire another.
                                                        const key = `${row.root}\u0000${change.path}`
                                                        const cells = changeLine(change)
                                                        return (
                                                            <box
                                                                onMouseDown={arm(key)}
                                                                onMouseUp={fire(key, () => open(row))}
                                                            >
                                                                <text wrapMode="none" fg={colours.muted}>
                                                                    {`${" ".repeat(INDENT_WIDTH)}${cells.letter} ${cells.name}`}
                                                                    {cells.directory === "" ? "" : ` ${cells.directory}`}
                                                                </text>
                                                            </box>
                                                        )
                                                    }}
                                                </For>
                                                <Show when={row.changes.length > MAX_FILES}>
                                                    <box
                                                        onMouseDown={arm(`more:${row.root}`)}
                                                        onMouseUp={fire(`more:${row.root}`, () => open(row))}
                                                    >
                                                        <text wrapMode="none" fg={colours.muted}>
                                                            {`  +${row.changes.length - MAX_FILES} more`}
                                                        </text>
                                                    </box>
                                                </Show>
                                            </Show>
                                        </box>
                                    )
                                }}
                            </For>
                        </Show>
                    </box>
                )
            },
        })

        // The palette entry that opens the view, and the key for it.
        //
        // Registered once from setup. A layer created per render leaks one per
        // repaint, which is why this is not inside the panel.
        context.keymap.layer(() => ({
            commands: [
                {
                    id: "source-control.open",
                    title: "Open source control",
                    group: "Source Control",
                    palette: true,
                    run: () => {
                        const first = state.rows[0]
                        if (first === undefined) return
                        setView((draft) => {
                            draft.repo = first.root
                            draft.path = ""
                        })
                        context.ui.panel.open(NAME, { presentation: "fullscreen" })
                    },
                },
            ],
        }))

        // Escape closes the view, and only while the view is the open panel.
        //
        // Escape belongs to the host -- it is `session.interrupt` and the diff
        // viewer's close key -- so a layer claiming it unconditionally would
        // take the interrupt away from every turn. Gating the whole layer on
        // `ui.panel.current()` means the binding does not exist until the panel
        // does, and outside it the key is the host's again. Same rule, and same
        // reason, as loadout's close binding.
        context.keymap.layer(() => ({
            mode: "global",
            enabled: () => context.ui.panel.current()?.name === NAME,
            commands: [
                {
                    id: "source-control.close",
                    title: "Close source control",
                    group: "Source Control",
                    bind: "escape",
                    run: () => context.ui.panel.close(),
                },
            ],
        }))

        return () => {
            disposed = true
            inflight?.abort()
            if (timer !== undefined) clearTimeout(timer)
            timer = undefined
            sidebar?.()
            panel?.()
            // After the last frame that could draw it.
            void context.renderer.idle().then(() => syntaxStyle?.destroy())
        }
    },
})

// One row of the two-column diff.
//
// Each half is drawn on its own so an unchanged row shows the same text twice
// and a changed one shows the old text beside the new. The number gutter is
// only as wide as it needs to be, which is why the width is taken from the pane
// rather than from a constant.
//
// The tone is per side, not per row: a rewritten line is a removal on the left
// and an addition on the right, and colouring the row one colour would make the
// new text read as deleted.
const ELLIPSIS_TRUNCATED = "… truncated at the size limit"

// A step in the hunk navigator.
//
// Drawn as text rather than a button so it sits in a row of text without a
// border or a focus ring; a click and a key both reach it.
function HunkButton(props: { label: string; onClick: () => void; colours: ReturnType<typeof palette> }) {
    return (
        <box
            onMouseDown={(event) => {
                event.stopPropagation()
            }}
            onMouseUp={(event) => {
                event.preventDefault()
                event.stopPropagation()
                props.onClick()
            }}
        >
            <text wrapMode="none" fg={props.colours.colour("hunk")}>{props.label}</text>
        </box>
    )
}
