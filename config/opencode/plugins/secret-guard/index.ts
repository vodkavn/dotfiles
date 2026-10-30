import { Plugin } from "@opencode/plugin"
import { inspect, withheld } from "./mask"

// Secret guard: keeps credentials out of the model's view.
//
// Why after the tool rather than at the display. `execute.after` runs before the
// result is recorded, so what is masked is what the *transcript* holds -- not
// just what the terminal draws. That matters more than it looks: compaction,
// revert, fork and export all read the stored message, so a render-time filter
// would hide the value on screen and hand it back a turn later.
//
// The rules live in mask.ts, which takes a string and returns a string. This file
// is only the wiring: read the command the agent ran, decide what the output is,
// and replace the result when something has to go.
//
// What this is not:
//
//   - It is not a sandbox. It reads text, and text it does not recognise passes.
//   - It cannot help with a secret already in the transcript before it loaded, or
//     one the user pastes into the prompt.
//   - Background shell output arrives on a separate path from the tool result, so
//     a secret printed by a `background` shell is not covered here.
//   - Only `content` and a string `output` are masked. A tool that hides a secret
//     inside `metadata` would pass.
//
// Treat a pass as "no credential shape I know", never as "this output is safe".

const record = (value: unknown): Record<string, unknown> =>
    value !== null && typeof value === "object" ? (value as Record<string, unknown>) : {}

// The command the agent ran, when the tool takes one. Read defensively: this is
// the shell tool's input today, and a tool that renames the field must not make
// the guard throw inside a tool call.
const commandOf = (input: unknown): string | undefined => {
    const command = record(input).command
    return typeof command === "string" ? command : undefined
}

// A result's text, when it is plain text all the way down.
//
// A content array carrying a file part is left alone: masking a uri would break
// the tool, and the model cannot read the file without asking for it, at which
// point the read is a tool call of its own and is inspected like any other.
const textOnly = (content: unknown): string | undefined => {
    if (typeof content === "string") return content
    if (!Array.isArray(content)) return undefined
    const parts: string[] = []
    for (const part of content) {
        const entry = record(part)
        if (entry.type !== "text" || typeof entry.text !== "string") return undefined
        parts.push(entry.text)
    }
    return parts.length === 0 ? undefined : parts.join("\n")
}

// Put the masked text back in the shape it came in. A narrowed return type
// rather than `unknown`: the hook assigns it back to Tool.Result["content"], and
// the compiler should be the one checking that.
const reshape = (content: unknown, text: string): string | { type: "text"; text: string }[] =>
    Array.isArray(content) ? [{ type: "text", text }] : text

export default Plugin.define({
    id: "dotfiles.secret-guard",
    async setup(ctx) {
        const hook = await ctx.tool.hook("execute.after", (event) => {
            // A failed call carries an error message, not output. Those name the
            // resource and the reason; they are not where a value leaks.
            if (event.status !== "completed") return

            const command = commandOf(event.input)
            const content = event.result.content
            const text = textOnly(content)
            if (text === undefined) return

            const verdict = inspect({ command, text })
            if (verdict.kind === "pass") return

            const replacement = verdict.kind === "whole" ? withheld(verdict.reason) : verdict.text

            // Replaced, not mutated: Tool.Result's fields are readonly, and the
            // hook's `result` is the field that may be assigned.
            event.result = { ...event.result, content: reshape(content, replacement) }
        })

        return async () => {
            await hook.dispose()
        }
    },
})
