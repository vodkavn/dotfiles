type Sessions = {
    family(sessionID: string): readonly string[] | undefined
    get(sessionID: string): { parentID?: string } | undefined
    sync(sessionID: string): unknown
    message: { sync(sessionID: string): unknown }
}

// Retain ancestry only for the displayed family. Server events also describe
// unrelated sessions, and must not turn this panel into a global session cache.
export const createSessionTracker = (sessions: Sessions) => {
    const synced = new Set<string>()
    const parents = new Map<string, string>()
    let shown: string | undefined
    let disposed = false
    let generation = 0

    const clear = () => {
        generation++
        shown = undefined
        synced.clear()
        parents.clear()
    }

    const sync = (sessionID: string) => {
        if (disposed || synced.has(sessionID)) return
        synced.add(sessionID)
        const scheduled = generation
        void Promise.resolve().then(() => {
            if (!disposed && scheduled === generation && synced.has(sessionID)) return sessions.sync(sessionID)
        }).catch(() => {})
        void Promise.resolve().then(() => {
            if (!disposed && scheduled === generation && synced.has(sessionID)) return sessions.message.sync(sessionID)
        }).catch(() => {})
    }

    const belongs = (sessionID: string): boolean => {
        const seen = new Set<string>()
        let current = sessionID
        while (current !== shown && !seen.has(current)) {
            seen.add(current)
            const parent = parents.get(current) ?? sessions.get(current)?.parentID
            if (!parent) return false
            current = parent
        }
        return current === shown
    }

    return {
        track(sessionID: string | undefined): readonly string[] {
            if (disposed) return []
            if (sessionID !== shown) clear()
            shown = sessionID
            if (!sessionID) return []
            let ids: readonly string[] = [sessionID]
            try {
                const family = sessions.family(sessionID)
                if (Array.isArray(family) && family.length > 0) ids = family
            } catch {}
            for (const id of ids) sync(id)
            return ids
        },
        created(sessionID: string, parentID: string | undefined) {
            if (disposed || !shown || !parentID || !belongs(parentID)) return
            parents.set(sessionID, parentID)
            sync(sessionID)
        },
        deleted(sessionID: string) {
            if (sessionID === shown) {
                clear()
                return
            }
            // Remove descendants too: a recursive deletion need not emit an
            // individual event for every child retained by this panel.
            const removed = new Set([sessionID])
            for (const id of parents.keys()) {
                let current = id
                const seen = new Set<string>()
                while (!removed.has(current) && !seen.has(current)) {
                    seen.add(current)
                    const parent = parents.get(current)
                    if (!parent) break
                    current = parent
                }
                if (removed.has(current)) removed.add(id)
            }
            for (const id of removed) {
                parents.delete(id)
                synced.delete(id)
            }
        },
        dispose() {
            disposed = true
            clear()
        },
    }
}
