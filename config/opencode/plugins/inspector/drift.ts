import { lstatSync, readdirSync, readlinkSync } from "node:fs"
import { homedir } from "node:os"
import { join, resolve } from "node:path"

// Config drift check for the inspector plugin.
//
// opencode discovers plugin directories positionally, from flat sibling
// entries: index.ts is the server entry, tui.tsx the CLI one. A directory with
// neither is skipped, and the docs are explicit that it is skipped *without a
// message*. A symlink whose target is gone is arguably worse: opencode still
// walks the directory it lives in.
//
// Both have happened here. Deleting the tokens plugin from this repository left
// a dangling ~/.config/opencode/plugins/tokens link behind, and install.sh only
// learned to prune those links afterwards.
//
// This lives apart from tui.tsx so it can be tested: JSX needs opencode's
// transform, and a plain module can be loaded and called directly.

// Exported for testing; the TUI plugin is the only consumer.
export type Problem = { text: string; severity: "error" | "warn" }

// The entries that count as a discoverable plugin, longest first so a directory
// holding both is judged by the server entry rather than the CLI one.
const ENTRIES = ["index.ts", "tui.tsx"]

const isFile = (path: string): boolean => {
    try {
        return lstatSync(path).isFile()
    } catch {
        return false
    }
}

export const scanPlugins = (directory: string): Problem[] => {
    const problems: Problem[] = []

    let entries: string[]
    try {
        entries = readdirSync(directory)
    } catch {
        // No plugin directory at this level is normal, not something to report.
        return problems
    }

    for (const name of entries.sort()) {
        const path = join(directory, name)

        let stats
        try {
            stats = lstatSync(path)
        } catch {
            // Raced with a delete; nothing to say about a path that just went.
            continue
        }

        // lstat does not follow the link, so a broken one is still reported as a
        // link here. Resolving it is what makes the breakage detectable.
        if (stats.isSymbolicLink()) {
            let broken = false
            try {
                // A relative target resolves against the link's own directory,
                // not against the process's working directory. Resolving it
                // against the latter reported every healthy relative link as
                // broken, which is the one thing this panel must not do.
                lstatSync(resolve(directory, readlinkSync(path)))
            } catch {
                broken = true
            }
            if (broken) {
                problems.push({
                    severity: "error",
                    text: `${name}: link target is gone, and opencode still scans this directory`,
                })
                continue
            }
        }

        if (!stats.isDirectory()) continue

        // The entry has to be a *file* sitting next to it. A nested src/, or a
        // package.json, is not resolved by the discovery rule.
        const discoverable = ENTRIES.some((entry) => isFile(join(path, entry)))
        if (!discoverable) {
            problems.push({
                severity: "error",
                text: `${name}: no ${ENTRIES.join(" or ")}, so it is skipped silently`,
            })
        }
    }

    return problems
}

// The global plugin directory, plus the project's when one is known.
export const driftProblems = (projectDirectory?: string): Problem[] => {
    const directories = [join(homedir(), ".config", "opencode", "plugins")]
    if (projectDirectory !== undefined && projectDirectory !== "") {
        directories.push(join(projectDirectory, ".opencode", "plugins"))
    }
    return directories.flatMap(scanPlugins)
}
