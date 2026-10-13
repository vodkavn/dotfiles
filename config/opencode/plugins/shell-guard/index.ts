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
// The parsing techniques below are borrowed from cc-safety-net
// (https://github.com/kenryu42/cc-safety-net), which parses rather than
// pattern-matches for the same reason. Adopted here, small and deterministic:
// peel transparent wrappers, recurse into command substitution, recurse into a
// shell's -c script, and skip shell keywords. What this does NOT adopt is a real
// shell parser -- cc-safety-net has one, this does not, and the gaps that
// leaves are listed below rather than papered over.
//
// What this does NOT stop, stated plainly:
//
//   eval "$CMD"            the command word is decided at run time
//   xargs -I {} sh -c …    reached only through a wrapper this cannot resolve
//   python -c '…'          an interpreter this does not know how to read
//   a variable holding a blocked word:  S=sudo; $S id
//
// All four are the same class of limit the plugin has always had: this sees
// text, not a process tree. Treat a pass here as "no obvious foot-gun", never as
// "proven safe".
//
// To tighten or loosen: edit BLOCKED. Keep it short — every entry is a command
// the agent can no longer run even when a user asks for it by name.

// Bare command names. A word is only ever tested where it names a command, so
// blocking "apt" does not also block "apt-cache", `ls ./curl`, or a file named
// "wget". A wrapper's operand does become a command word, which is the point:
// `timeout 30 apt install foo` has apt in command position.
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

// Words that run something else rather than being the command.
//
// sudo and doas appear here too: they wrap a command, but they are also blocked
// in their own right, so they must be caught rather than peeled away.
const WRAPPERS = new Set([
    "env",
    "command",
    "builtin",
    "nohup",
    "time",
    "stdbuf",
    "xargs",
    "sudo",
    "doas",
])

// Wrappers that take a tuning value before the command, in any position:
// `timeout 30 sudo`, `timeout 30s sudo`, `timeout -k 1 30 sudo`.
const TUNED = new Set(["timeout", "nice", "ionice"])

// A duration, priority, or niceness: a number, optionally fractional, with an
// optional unit suffix. `timeout ls` must not match, so a name cannot qualify.
const VALUE = /^[+-]?(\d+\.?\d*|\.\d+)[a-zA-Z]*$/

// `command -v foo` and `builtin -p foo` ask what a name resolves to; they do
// not run it. AGENTS.md tells agents to reach for `command -v <tool>` before
// using one, so peeling these would block this repository's own convention.
const ASKING = new Set(["command", "builtin"])
const QUERY_FLAGS = new Set(["-v", "-V", "-p"])

// Shells that take a whole script in an argument.
const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "mksh", "ash"])

// Shell syntax that precedes a command without being one. Without these,
// `for f in a; do sudo id; done` resolves to "for" and never sees the sudo.
const KEYWORDS = new Set([
    "if", "then", "else", "elif", "fi",
    "for", "while", "until", "do", "done",
    "case", "esac", "in", "select", "function",
    "{", "}", "[[", "]]", "!",
])

const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*=/

// Nesting stops here. Past the cap the guard gives up rather than risk
// looping on input built to recurse; the limit is well above any real command.
const MAX_DEPTH = 4

// The delimiter a heredoc opens with on this line, if any.
const heredocDelimiter = (line: string): string[] => {
    const found: string[] = []
    // Quoted so <<'EOF' does not expand, unquoted so <<EOF works, and the
    // terminator may be indented under <<-.
    const pattern = /<<(-)?\s*(?:'([A-Za-z_][A-Za-z0-9_]*)'|"([A-Za-z_][A-Za-z0-9_]*)"|\\?([A-Za-z_][A-Za-z0-9_]*))/g
    for (const match of line.matchAll(pattern)) found.push(match[2] ?? match[3] ?? match[4])
    return found
}

// Drops heredoc bodies before anything is parsed.
//
// Without this, writing a commit message or a note that mentions a blocked
// command blocks the write: the body is ordinary text, but it is full of
// newlines, and a newline is a command separator. Quoted here on purpose — the
// guard would otherwise cry wolf at exactly the commands that document the
// policy it enforces.
export function withoutHeredocBodies(command: string): string {
    const lines = command.split("\n")
    const kept: string[] = []
    let pending: string[] = []

    for (const line of lines) {
        if (pending.length > 0) {
            const terminator = line.trim()
            pending = pending.filter((delimiter) => {
                if (delimiter !== terminator) return true
                return false
            })
            continue
        }
        kept.push(line)
        pending = heredocDelimiter(line)
    }
    return kept.join("\n")
}

// Splits a line into commands, tracking quoting so separators and words inside
// quotes stay literal. Returns every command's words, un-reduced.
export function split(command: string): string[][] {
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

    return commands
}

// Returns the body of the parenthesised group opening at `open`, honouring
// nesting and quotes, or undefined when it never closes.
const group = (command: string, open: number): { text: string; end: number } | undefined => {
    let depth = 0
    let quote: string | null = null
    for (let index = open; index < command.length; index++) {
        const char = command[index]
        if (char === "\\" && quote !== "'") {
            index++
            continue
        }
        if (quote !== null) {
            if (char === quote) quote = null
            continue
        }
        if (char === "'" || char === '"') {
            quote = char
            continue
        }
        if (char === "(") depth++
        if (char === ")" && --depth === 0) return { text: command.slice(open + 1, index), end: index }
    }
    return undefined
}

// The bodies of every command substitution in the raw line: $(...) and
// `...`. Substitution happens before the surrounding command is resolved, so a
// blocked word inside one runs regardless of how innocent the outer word looks.
// $( is only a substitution when it is not $(( arithmetic.
//
// Double quotes do not stop the search: the shell still substitutes inside
// them. Only single quotes do, and there the text really is literal — which is
// why `echo 'sudo'` is allowed and `echo "sudo"` is not.
export function substitutions(command: string): string[] {
    const found: string[] = []
    let single = false

    for (let index = 0; index < command.length; index++) {
        const char = command[index]

        if (char === "\\" && !single) {
            index++
            continue
        }
        if (single) {
            if (char === "'") single = false
            continue
        }
        if (char === "'") {
            single = true
            continue
        }
        // A bare " toggles nothing here: backticks substitute inside double
        // quotes, so they are matched wherever they appear outside single ones.
        if (char === "$" && command[index + 1] === "(" && command[index + 2] !== "(") {
            const body = group(command, index + 1)
            if (body === undefined) continue
            found.push(body.text)
            index = body.end
            continue
        }
        if (char === "`") {
            const close = command.indexOf("`", index + 1)
            if (close === -1) continue
            found.push(command.slice(index + 1, close))
            index = close
        }
    }
    return found
}

// The script a shell was handed, for `bash -lc 'sudo id'`. Only options are
// considered, so `bash script.sh -c 'sudo id'` — where -c belongs to the script
// rather than to bash — resolves to nothing instead of blocking innocently.
const scriptArgument = (words: string[], from: number): string | undefined => {
    for (let index = from + 1; index < words.length; index++) {
        const word = words[index]
        if (!word.startsWith("-") || word.length === 1) return undefined
        if (/^-[a-zA-Z]*c$/.test(word) || word === "--command") return words[index + 1]
    }
    return undefined
}

// One traversal, two answers: every command word it resolves goes into `words`,
// and the first blocked one returns its reason. Both exports are built on it so
// the diagnostics can never drift from the decision.
const scan = (command: string, depth: number, words: string[], seen: Set<string>): string | undefined => {
    if (depth > MAX_DEPTH) return undefined

    // Text, not a program: a heredoc body is data, so it is removed before any
    // newline in it can be mistaken for a command separator.
    command = withoutHeredocBodies(command)

    // Substitution is resolved first: it runs before the shell picks a command,
    // so it can hide a blocked word behind an innocent outer one.
    for (const body of substitutions(command)) {
        // A body reached twice by two substitutions is one command to the
        // shell; scanning it again only costs depth.
        if (seen.has(body)) continue
        seen.add(body)
        const reason = scan(body, depth + 1, words, seen)
        if (reason !== undefined) return reason
    }

    for (const parts of split(command)) {
        let index = 0
        for (;;) {
            // Leading assignments, then keywords, are not command words.
            while (index < parts.length && ASSIGNMENT.test(parts[index])) index++
            while (index < parts.length && KEYWORDS.has(parts[index])) index++

            const raw = parts[index]
            if (raw === undefined) break

            // Basename so /bin/curl, ./sudo and /usr/bin/env resolve the same
            // way their bare names do.
            const word = raw.split("/").pop() ?? raw

            // Tested before anything is peeled, so a blocked command is never
            // mistaken for a transparent wrapper and skipped past.
            const reason = BLOCKED[word]
            if (reason !== undefined) return reason

            if (TUNED.has(word)) {
                // Past the wrapper itself, then its options and the values that
                // follow them, in any order, until the first word that is
                // neither. A fixed count would be wrong: `timeout -k 1 30 sudo`
                // puts a value after an option as well as before the command.
                index++
                while (index < parts.length && (parts[index].startsWith("-") || VALUE.test(parts[index]))) index++
                continue
            }

            // A word that neither wraps nor tunes is the command itself.
            const wraps = WRAPPERS.has(word)
            const asking = ASKING.has(word) && QUERY_FLAGS.has(parts[index + 1] ?? "")
            if (!wraps || asking) {
                words.push(word)
                const nested = nestedCommand(word, parts, index)
                if (nested !== undefined) {
                    const reason = scan(nested, depth + 1, words, seen)
                    if (reason !== undefined) return reason
                }
                break
            }

            index++
            while (index < parts.length && parts[index].startsWith("-")) index++
        }
    }
    return undefined
}

// The command a word hands to the shell, when the word is the kind that does.
const nestedCommand = (word: string, parts: string[], index: number): string | undefined => {
    if (SHELLS.has(word)) return scriptArgument(parts, index)
    if (word === "find") {
        // The whole -exec argument list is the command, not just its first
        // word: `find . -exec sh -c 'sudo id' \;` runs sudo.
        for (let position = index + 1; position < parts.length; position++) {
            if (parts[position] === "-exec" || parts[position] === "-execdir") {
                return parts.slice(position + 1).join(" ")
            }
        }
    }
    return undefined
}

// Every command word the guard resolved, for diagnostics and tests.
export function commandWords(command: string): string[] {
    const words: string[] = []
    scan(command, 0, words, new Set())
    return words
}

// Returns the reason to block, or undefined to allow.
export function blockedReason(command: string): string | undefined {
    return scan(command, 0, [], new Set())
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

        // Awaited, not fired and forgotten: an unload that races its own
        // disposal leaves the hook registered against a dead plugin.
        return async () => {
            await hook.dispose()
        }
    },
})