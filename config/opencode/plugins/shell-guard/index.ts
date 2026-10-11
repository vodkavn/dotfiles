import { Plugin } from "@opencode/plugin"

// Central shell guard: deny a small set of privileged commands before the shell
// runs them, so the policy lives in one place instead of being scattered as
// per-path "effect: deny" entries across project configs.
//
// Why a plugin rather than config permissions: a permission rule matches a
// resource glob against tool input, so "sudo *" has to be re-spelled in every
// project that wants it. This hook sees the fully-assembled command, applies
// everywhere, and can reject with a reason the model actually reads.
//
// Matching is deliberately about *command position*, not substrings. An earlier
// version tested each blocked word against the raw string and blocked innocent
// commands such as `grep -r curl src/`, `echo 'use curl later'`, and `cat
// sudoers.txt`. A guard that cries wolf gets ignored or worked around, which is
// the opposite of what it is for, so only the command word is tested here.
//
// What this does NOT stop, stated plainly:
//
//   bash -c 'sudo ls'      a wrapper hides the real command word
//   xargs sudo             the command word belongs to a later process
//   node -e 'require("child_process")…'
//
// Closing those needs execution interception, not string matching. Treat a pass
// here as "no obvious foot-gun", never as "proven safe".
//
// To tighten or loosen: edit BLOCKED. Keep it short — every entry is a command
// the agent can no longer run even when a user asks for it by name.

// Bare command names. Arguments are never matched, so blocking "apt" does not
// also block "apt-cache", "ls ./curl", or a file named "wget".
const BLOCKED: Record<string, string> = {
    sudo: "privilege escalation is not available to the agent",
    doas: "privilege escalation is not available to the agent",
    su: "switching user is not available to the agent",
    curl: "arbitrary network fetches are disabled",
    wget: "arbitrary network fetches are disabled",
    apt: "system package changes are disabled",
    "apt-get": "system package changes are disabled",
    aptitude: "system package changes are disabled",
}

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// Returns the command word of every command in the line.
//
// This is not a shell parser and does not try to be. It tracks quoting so
// separators and words inside quotes stay literal, splits on unquoted
// separators ( ; && || | & newline ( ) ), drops leading VAR=value assignments,
// and reduces each command to its first word, basenamed.
export function commandWords(command: string): string[] {
    const commands: string[][] = []
    let tokens: string[] = []

    let token = ""
    let quote: string | null = null
    let pending = false

    const endToken = () => {
        if (!pending) return
        tokens.push(token)
        token = ""
        pending = false
    }

    const endCommand = () => {
        endToken()
        commands.push(tokens)
        tokens = []
    }

    for (let index = 0; index < command.length; index++) {
        const char = command[index]
        const next = command[index + 1]

        // Inside quotes everything is literal, separators included.
        if (quote !== null) {
            if (char === quote) quote = null
            else token += char
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            pending = true
            continue
        }
        if (char === "\\" && next !== undefined) {
            token += next
            pending = true
            index++
            continue
        }
        if (char === "\n" || char === ";" || char === "(" || char === ")") {
            endCommand()
            continue
        }
        if (char === "&" || char === "|") {
            endCommand()
            // Consume the second half of && or ||.
            if (next === char) index++
            continue
        }
        if (char === " " || char === "\t") {
            endToken()
            continue
        }
        token += char
        pending = true
    }
    endCommand()

    const words: string[] = []
    for (const command of commands) {
        // A leading assignment is not the command word.
        const first = command.find((word) => !ASSIGNMENT.test(word))
        if (first === undefined) continue
        // Basename so /bin/curl and ./curl match too.
        words.push(first.split("/").pop() ?? "")
    }
    return words
}

// Returns the reason to block, or undefined to allow.
export function blockedReason(command: string): string | undefined {
    for (const word of commandWords(command)) {
        const reason = BLOCKED[word]
        if (reason !== undefined) return reason
    }
    return undefined
}

export default Plugin.define({
    id: "dotfiles.shell-guard",
    async setup(ctx) {
        const hook = await ctx.shell.hook("create.before", (event) => {
            const command = event.command ?? ""
            const reason = blockedReason(command)
            if (reason === undefined) return
            // Throwing aborts shell creation, so the model sees the reason
            // instead of a silent permission prompt. No env or cwd edits apply.
            throw new Error(`Blocked by shell-guard: ${reason}. Command was: ${command}`)
        })

        return () => {
            void hook.dispose()
        }
    },
})