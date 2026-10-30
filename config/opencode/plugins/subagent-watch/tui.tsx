import { Plugin } from "@opencode/plugin/tui"
import {
    buildRows,
    childrenOf,
    createFinishTracker,
    isRunning,
    rowBody,
    rowHeadParts,
    runningRows,
    runningShells,
    shellLine,
    SPIN_FPS,
    SPIN_MS,
    subscribeClock,
    type Source,
    type Tree,
} from "./panel"

// A **Subagents** section in the sidebar: one row per *running* subagent of the
// session on screen, clickable to open it. A second section lists the
// background shells still running under it.
//
// opencode already has a subagent list, but it lives in the composer, it is
// hidden behind a keybind, and it disappears the moment you act on it. Delegated
// work is the one thing you cannot see from the transcript -- a subagent runs as
// a session of its own, so its messages never appear in the one on screen and a
// long-running one looks exactly like a hang. This puts the list in permanent
// chrome, next to the session it belongs to.
//
// The shells are the same problem one level down. A subagent that starts a long
// build and returns leaves that build running, and from the transcript it is as
// invisible as the subagent was.
//
// Only subagents that are still running are drawn, which is what separates this
// from the session list rather than a duplicate of it: a finished subagent is
// history, already readable there, and leaving it here pushed the live ones down
// the sidebar and filled the section with rows that never changed again. So the
// section grows while work is delegated and shrinks back to nothing as that work
// completes -- the same shape session-vitals has.
//
// What is drawn is the subtree *below* the session on screen, linked on
// parentID. opencode's own list is `family(sessionID)` minus the session, which
// only holds while the session is the root of its family; once you have clicked
// into a subagent the same subtraction reports the parent. Linking instead stays
// correct at any depth, and means the section reads as "this session's
// subagents" rather than "everything in a family that happens to include this".
//
// Nothing is drawn when nothing is running. A permanent "Subagents (0)" row
// teaches the eye to skip the section, which is the opposite of what it is for --
// the same reasoning provider-usage uses for a section with nothing to say.
//
// Every list is read inside render(), never captured in setup(). Status is a
// local store read on top of that: caching it would freeze a row on "running"
// long after the subagent finished, which is the bug this is meant to replace.

type MouseEvent = { stopPropagation(): void; preventDefault(): void }

// Not a session id. The header shares the press/release guard with the rows, so
// it needs an identity that cannot collide with one.
const HEADER = ""

// The shells header needs its own identity for the same reason, and it shares
// the guard with the subagent header, so it cannot be the empty string.
const SHELL_HEADER = "\u0000shells"

// How many levels below the session on screen to *fetch*. opencode's own event
// handling syncs direct children only; a subagent is not supposed to delegate
// further, but the tree does not forbid it, so one extra level is fetched.
//
// The cap is on fetching only. The walk in panel.ts draws whatever the family
// links imply, at whatever depth, because a row that is missing is worse than a
// row drawn at the clamped indent from a store entry already in hand.
const DEPTH = 1

export default Plugin.define({
    id: "dotfiles.subagent-watch.tui",
    setup(context) {
        // The *values*, not the key, are what differ from the loadout plugin's store
        // of the same name: its keys are section names and a `true` means
        // collapsed, so a `true` under this one would read as "the section is
        // on" to anyone copying from that file. Named for what it holds instead.
        //
        // Starts expanded -- the point of this section is to be read without a
        // click. Memory storage, so it survives a plugin reload and resets when
        // the TUI exits.
        const [state, setState] = context.storage.memory("collapse", { initial: { collapsed: false, shells: false } })

        // The repaint clock for the spinner.
        //
        // A running subagent can be quiet for minutes -- no store change, no
        // repaint -- while its glyph is expected to keep turning, so the
        // animation needs a tick of its own. These values are not read: bumping
        // one is what repaints the slot, and the frame that gets drawn is derived
        // from the clock in panel.ts. Separate from the collapse store above so
        // that store keeps meaning only "is the section folded".
        const [spin, setSpin] = context.storage.memory("spin", { initial: { tick: 0 } })

        // Whether the last paint drew a row carrying a spinner. Written by the
        // render below and read by the clock below, which is what keeps an idle
        // or folded section from asking for repaints.
        let animating = false

        // Which row a held press started on. It lives at plugin scope, not in
        // the render, because the spinner repaints every SPIN_MS and each
        // repaint replaces the handlers with fresh closures: state kept in one
        // of those closures would be lost halfway through a click and the
        // release dropped.
        let pressed: string | undefined

        // Which subagents were running last time, so the ones that have since
        // finished can be announced once each. The tracker holds the state, so
        // nothing here has to survive a repaint.
        const finished = createFinishTracker()

        // The repaint clock for the spinner.
        //
        // It exists only while there is a spinner to turn. An animation that
        // wakes the process eight times a second to animate nothing is waste,
        // and this panel is idle most of the time -- so the clock is created
        // when the first spinner appears and cleared when the last one goes.
        //
        // Created from the render rather than from setup, which also settles
        // the order of business: a slot that never renders never starts a
        // timer, and a registration that throws leaves nothing running.
        let stopSpin: (() => void) | undefined
        const spinClock = () => {
            const tick = () => {
                // A guard inside the callback is not needed: the clock is
                // cleared on the way out, so no tick outlives it.
                setSpin((draft) => {
                    draft.tick++
                })
            }
            if (animating) {
                if (stopSpin !== undefined) return
                stopSpin = subscribeClock(context.renderer, SPIN_FPS, tick, () => {
                    const handle = setInterval(tick, SPIN_MS)
                    // `unref` keeps it from holding the TUI's event loop open on
                    // its own.
                    ;(handle as { unref?: () => void }).unref?.()
                    return () => clearInterval(handle)
                })
                return
            }
            if (stopSpin === undefined) return
            stopSpin()
            stopSpin = undefined
        }

        // The location whose shells the panel lists. Resolved per render from
        // the session on screen, not from context.location: that is captured at
        // setup and would keep answering for whichever project was open then.
        type Location = Parameters<typeof context.data.shell.list>[0]
        const at = (sessionID: string | undefined): Location =>
            (sessionID === undefined ? undefined : context.data.session.get(sessionID))?.location ??
            context.data.location.default()

        const tree = (current: string | undefined): Tree => ({
            current,
            family: current === undefined ? [] : context.data.session.family(current) ?? [],
            info: (id) => context.data.session.get(id),
        })

        // Normalised in panel.ts rather than here, because this is the one
        // function that can throw on a status shape, and panel.ts is the file
        // the tests can load.
        const runningOf = (id: string): boolean => isRunning(context.data.session.status(id))

        // Two mechanisms put a session in the store's family map, and the panel
        // leans on both:
        //
        //   * the store re-families on its own when a session is created under
        //     another, which is how a subagent delegated *after* this plugin
        //     looked still appears with no help from here;
        //   * sync(id, {children: true}) pulls the children of a session the
        //     store has not otherwise fetched -- the cold-start case, where
        //     nothing has been created under it this run.
        //
        // Only the second is this plugin's job. The second argument is not in the
        // published types; it is verified against v2.0.28. If a future host
        // ignores it the first mechanism still carries the section, so the
        // failure is a thinner list rather than an empty one.
        //
        // The widened type is what says so in the type system rather than in a
        // comment alone, and it keeps the call on the host's own object so the
        // receiver is not lost.
        const sessions = context.data.session as typeof context.data.session & {
            sync(sessionID: string, options?: { children?: boolean }): Promise<void>
        }
        //
        // Bounded, and bounded in insertion order. A set that only ever grew
        // would hold one key per session ever opened, which is a slow leak in a
        // TUI that is never restarted. A single-slot cache is not the answer
        // either: it thrashes the moment you alternate between two sessions.
        const SYNC_WINDOW = 64
        const requested = new Set<string>()
        const request = (id: string, depth: number) => {
            if (depth > DEPTH) return
            const key = `${depth}:${id}`
            if (requested.has(key)) return
            requested.add(key)
            if (requested.size > SYNC_WINDOW) {
                const oldest = requested.values().next()
                if (!oldest.done) requested.delete(oldest.value)
            }
            // Fire and forget: a rejected sync must not take the TUI down over a
            // list that is allowed to be empty until the store catches up.
            //
            // The key leaves the window on rejection rather than staying marked,
            // so a later render retries. Marking it permanently would mean one
            // failed request costs this session its subagent list for the rest
            // of the TUI's life: the store does not retry on its own, and the
            // `synced` guard below never re-enters the same session.
            void Promise.resolve(sessions.sync(id, { children: true }))
                .then(() => {
                    if (depth >= DEPTH) return
                    for (const child of childrenOf(tree(id), id)) request(child, depth + 1)
                })
                .catch(() => requested.delete(key))
        }

        let synced = ""
        const sync = (current: string | undefined) => {
            if (current === undefined) {
                synced = ""
                return
            }
            // Without this, every render of the same session would re-enter the
            // walk, and the walk is what issues the requests.
            if (current === synced) return
            synced = current
            request(current, 0)
        }

        const open = (sessionID: string) => {
            // router.navigate is what opencode's own subagent row calls, and
            // what its tab layer calls under the hood, so this both switches
            // session and focuses the tab when session tabs are enabled.
            context.ui.router.navigate({ type: "session", sessionID })
        }

        const dispose = context.ui.slot({
            append: "sidebar.content",
            render: (current) => {
                sync(current.sessionID)
                // Reading the tick is what subscribes this render to the bump the
                // spinner's interval makes; the value itself is never drawn.
                void spin.tick

                const source: Source = { ...tree(current.sessionID), running: runningOf }
                // Filtered after the walk, not inside it, so a running subagent
                // under a finished parent still draws. runningRows in panel.ts
                // carries the reasoning.
                const rows = runningRows(buildRows(source))
                // The shells the host still reports as running under this
                // location. The same blind spot the subagent list fills, one
                // level down: work that outlived the turn that started it.
                const shells = runningShells(context.data.shell.list(at(current.sessionID)))
                const collapsed = state.collapsed
                const shellsCollapsed = state.shells
                // Set before the empty return, so a section that has gone quiet --
                // every subagent finished, or the list folded away -- stops asking
                // for repaints.
                animating = rows.length > 0 && !collapsed
                // The clock follows the panel: it runs while there is a spinner
                // to turn, and stops as soon as there is not.
                spinClock()

                // Announce the subagents that have finished since the last look.
                //
                // Once each: the tracker remembers what was running, so a
                // subagent that has gone quiet is announced once rather than on
                // every repaint after it. Both channels are used, because neither
                // covers the other -- a toast is what the terminal shows, and an
                // attention event is what the desktop app shows, and the host
                // ships a sound for exactly this.
                for (const done of finished.finished(current.sessionID, rows.map((row) => ({ id: row.id, title: row.title })))) {
                    const message = done.title === "" ? "A subagent finished" : `“${done.title}” finished`
                    context.ui.toast.show({ title: "Subagent finished", message, variant: "info" })
                    void context.attention.notify({ title: "Subagent finished", message, sound: { name: "subagent_done" } }).catch(() => {})
                }

                if (rows.length === 0 && shells.length === 0) return null

                const muted = context.theme.text.muted
                const base = context.theme.text.base
                // The colour the host draws a running tab in. The spinner is the
                // one cell that says the row is live, so it carries that colour
                // rather than the row's own.
                const loading = context.theme.hue.interactive[200]
                const now = Date.now()

                // Both lines are composed here rather than inside the JSX.
                // panel.ts exists so the render holds no decisions, and that only
                // stays true if the text it draws is finished before this point.
                //
                // No `running` field is carried: every row that reaches this point
                // is running, which is what runningRows guarantees.
                const lines = rows.map((row) => ({
                    id: row.id,
                    head: rowHeadParts(row, now),
                    body: rowBody(row),
                }))

                // The action is on the release, and the release only counts when it
                // lands on the row that was pressed. Mouse-up is delivered to
                // whatever is under the cursor, so without this, pressing one row
                // and releasing over another opens the one you did not click --
                // and acting on the press instead makes a held button read as a
                // stuck panel. Every handler stops propagation because the host
                // binds the sidebar itself.
                //
                // `pressed` is the guard above, shared by every paint so a press
                // survives the repaints that happen between it and the release.
                const press = (id: string) => (event: MouseEvent) => {
                    pressed = id
                    event.stopPropagation()
                }
                const release = (id: string) => (event: MouseEvent) => {
                    const armed = pressed
                    pressed = undefined
                    event.stopPropagation()
                    event.preventDefault()
                    if (armed !== id) return
                    if (id === HEADER) {
                        setState((draft) => {
                            draft.collapsed = !draft.collapsed
                        })
                        return
                    }
                    open(id)
                }

                // The shells header has its own identity, because the press
                // guard is shared with the rows and a session id can never be
                // this. Its rows are not clickable: a shell is not a session,
                // so there is nothing to open.
                const shellPress = (event: MouseEvent) => {
                    pressed = SHELL_HEADER
                    event.stopPropagation()
                }
                const shellRelease = (event: MouseEvent) => {
                    const armed = pressed
                    pressed = undefined
                    event.stopPropagation()
                    event.preventDefault()
                    if (armed !== SHELL_HEADER) return
                    setState((draft) => {
                        draft.shells = !draft.shells
                    })
                }

                return (
                    <box flexDirection="column" gap={0}>
                        {rows.length > 0 && (
                            <box flexDirection="column" gap={0}>
                                <box flexDirection="row" onMouseDown={press(HEADER)} onMouseUp={release(HEADER)}>
                                    <text wrapMode="none" fg={base}>{`${collapsed ? "▶" : "▼"} Subagents`}</text>
                                    <text wrapMode="none" fg={muted}>{` (${rows.length})`}</text>
                                </box>
                                {!collapsed &&
                                    lines.map((line) => (
                                        <box
                                            flexDirection="column"
                                            onMouseDown={press(line.id)}
                                            onMouseUp={release(line.id)}
                                        >
                                            <text wrapMode="none" fg={base}>
                                                {line.head.indent}
                                                <span style={{ fg: loading }}>{line.head.marker}</span>
                                                {line.head.rest}
                                            </text>
                                            {line.body !== "" && (
                                                <text wrapMode="none" fg={muted}>
                                                    {line.body}
                                                </text>
                                            )}
                                        </box>
                                    ))}
                            </box>
                        )}
                        {shells.length > 0 && (
                            <box flexDirection="column" gap={0}>
                                <box flexDirection="row" onMouseDown={shellPress} onMouseUp={shellRelease}>
                                    <text wrapMode="none" fg={base}>{`${shellsCollapsed ? "▶" : "▼"} Shells`}</text>
                                    <text wrapMode="none" fg={muted}>{` (${shells.length})`}</text>
                                </box>
                                {!shellsCollapsed &&
                                    shells.map((shell) => (
                                        <text wrapMode="none" fg={muted}>
                                            {`  ${shellLine(shell, now)}`}
                                        </text>
                                    ))}
                            </box>
                        )}
                    </box>
                )
            },
        })

        return () => {
            if (stopSpin !== undefined) stopSpin()
            stopSpin = undefined
            dispose?.()
        }
    },
})
