// Secret detection and masking, as data.
//
// Kept out of index.ts for the reason the other plugins split their panels: node
// can load a plain module and call its exports, but the plugin wiring needs
// opencode. Everything here takes a string and returns a string, so the rules are
// testable without a service, a terminal, or a real credential.
//
// Two kinds of answer, and the difference is the whole design:
//
//   whole   the command's *entire* output is a secret (a secret manager read, a
//           credential file, an echo of a token variable). Nothing about the
//           content is trusted, so none of it is passed on.
//   scrub   the output is ordinary text that happens to contain a credential in
//           a recognisable shape, so only the matching span is replaced and the
//           surrounding structure survives.
//
// The split matters because pattern matching cannot catch a secret whose shape is
// unremarkable -- a hostname, an IP, a password like "hunter2". A rule that names
// the *command* can, because it does not need to understand the value. That is
// why `aws secretsmanager get-secret-value` masks everything it printed, while
// `grep AKIA ...` only loses the key.

// What a hidden value reads as, everywhere it is hidden. A single token rather
// than a description of the field, because the agent must not be able to tell a
// real value from a decoy by the wrapper.
export const MASKED = "<masked>"

// How much of a result is scanned.
//
// The scan is linear, so this is a budget rather than a correctness limit: a
// megabyte costs about a quarter of a second inside a tool call. It is sized well
// above what the model can see -- `tool_output` caps the model's view at 16 KB --
// so a secret inside `MAX_SCAN` covers sixty times the text any model reads.
//
// Past the cap the tail is passed through rather than withheld. Masking a large
// output whole would turn reading a big, harmless file into `<masked>`, which is
// a worse failure than the leak it prevents; the tail is not text the model sees.
export const MAX_SCAN = 500_000

// A command whose whole output is a secret.
//
// `words` must all appear as words in the command, in any order, because global
// flags interleave: `aws --region us-east-1 secretsmanager get-secret-value` puts
// a value between the service and the subcommand. Requiring every word instead of
// a prefix keeps that matching, at the cost of also matching a command that only
// mentions the words -- which over-masks rather than under-masks.
export type CommandRule = {
    readonly name: string
    readonly words: readonly string[]
}

export const COMMANDS: readonly CommandRule[] = [
    { name: "aws secretsmanager get-secret-value", words: ["aws", "secretsmanager", "get-secret-value"] },
    { name: "aws secretsmanager batch-get-secret-value", words: ["aws", "secretsmanager", "batch-get-secret-value"] },
    // Masked with or without --with-decryption: the flag can also be spelled
    // --with-decryption=true, and a rule that tried to tell the two apart would
    // fail open on the spelling it did not anticipate.
    { name: "aws ssm get-parameter", words: ["aws", "ssm", "get-parameter"] },
    { name: "aws ssm get-parameters", words: ["aws", "ssm", "get-parameters"] },
    { name: "aws sts get-session-token", words: ["aws", "sts", "get-session-token"] },
    { name: "aws sts assume-role", words: ["aws", "sts", "assume-role"] },
    { name: "aws configure get", words: ["aws", "configure", "get"] },
    { name: "gcloud secrets versions access", words: ["gcloud", "secrets", "versions", "access"] },
    { name: "az keyvault secret show", words: ["az", "keyvault", "secret", "show"] },
    { name: "vault kv get", words: ["vault", "kv", "get"] },
    { name: "vault read", words: ["vault", "read"] },
    { name: "op read", words: ["op", "read"] },
    { name: "op item get", words: ["op", "item", "get"] },
    { name: "pass show", words: ["pass", "show"] },
    // A Secret carries base64 in `data`; `kubectl get secrets` (plural) does not.
    { name: "kubectl get secret", words: ["kubectl", "get", "secret"] },
]

// Files whose *contents* are credentials. Matched as fragments of the command, so
// `cat ~/.aws/credentials` and `grep -r . ~/.ssh/id_rsa` both hit. The paths are
// spelled out rather than globbed: a rule that matched every file under .ssh
// would also mask `ls ~/.ssh`, which says nothing sensitive.
export const PATHS: readonly string[] = [
    ".aws/credentials",
    ".ssh/id_rsa",
    ".ssh/id_ed25519",
    ".ssh/id_ecdsa",
    ".ssh/id_dsa",
    ".docker/config.json",
    ".netrc",
    ".npmrc",
    ".pypirc",
    ".config/gh/hosts.yml",
    ".config/gcloud/application_default_credentials.json",
]

// A variable name that says its value is a secret.
//
// Matched on *words*, not on a substring: `TOKENIZERS` contains "token" and is
// not a credential, while `GITHUB_TOKEN` ends in one. Pairs are checked as well,
// so `apiKey` and `accessKey` are caught without letting a bare `key` match --
// which would mask `SSH_KEY` when it holds a path.
const SECRET_WORDS = new Set([
    "secret",
    "secrets",
    "token",
    "passwd",
    "password",
    "passphrase",
    "credential",
    "credentials",
    "private",
])

const SECRET_PAIRS = new Set(["apikey", "accesskey", "secretkey", "privatekey", "authtoken", "accesstoken"])

// The name, in lowercase words: `AWS_SECRET_ACCESS_KEY` -> aws secret access key,
// `apiKey` -> api key.
const nameWords = (name: string): string[] =>
    name
        .split(/[^A-Za-z0-9]+|(?<=[a-z0-9])(?=[A-Z])/)
        .filter((part) => part !== "")
        .map((part) => part.toLowerCase())

export const looksSecret = (name: string): boolean => {
    const parts = nameWords(name)
    if (parts.some((part) => SECRET_WORDS.has(part))) return true
    for (let index = 0; index < parts.length - 1; index++) {
        if (SECRET_PAIRS.has(`${parts[index]}${parts[index + 1]}`)) return true
    }
    return false
}

// The words of a command, with quoting and flags left in place. Only membership
// is asked of them, so a `--flag=value` staying as one word is harmless.
//
// Shell operators are separators as well as whitespace, because the only thing
// this is used for is recognising a word: `printenv GITHUB_TOKEN;` ends the word
// at the semicolon, and without that the reason line reads `$GITHUB_TOKEN;`.
const words = (command: string): string[] =>
    command.trim().split(/[\s;&|()<>]+/).filter((word) => word !== "")

// The whole-output rules that apply to a command, by name. Empty when the
// command is not one of the known secret readers.
export const wholeRules = (command: string): string[] => {
    const found: string[] = []
    if (command.trim() === "") return found

    const parts = words(command)
    const lower = parts.map((part) => part.toLowerCase())

    for (const rule of COMMANDS) {
        if (rule.words.every((word) => lower.includes(word))) found.push(rule.name)
    }

    for (const path of PATHS) {
        if (command.includes(path)) found.push(`contents of ${path}`)
    }

    // A variable that is expanded *by this command* is printed by this command,
    // which is the accidental echo the pattern layer cannot see: by the time the
    // output exists the value is a bare string with no name attached.
    for (const match of command.matchAll(/\$\{?([A-Za-z_][A-Za-z0-9_]*)\}?/g)) {
        const name = match[1]
        if (name !== undefined && looksSecret(name)) found.push(`$${name}`)
    }

    // `printenv NAME` prints one variable's value; the name is the only signal.
    if (lower.includes("printenv")) {
        for (const part of parts.slice(1)) {
            if (!part.startsWith("-") && looksSecret(part)) found.push(`$${part}`)
        }
    }

    return [...new Set(found)]
}

// A rule that replaces a span of ordinary text. `apply` returns the text
// unchanged when the rule does not match, so the caller can tell.
export type ScrubRule = {
    readonly name: string
    readonly apply: (text: string) => string
}

// The shapes worth recognising wherever they appear.
//
// Every rule here targets a *credential*, never a hostname or an address on its
// own. The user's secrets are masked by the command rules above; masking every IP
// and domain would break the ordinary work of reading a log to find out why a
// connection failed, which is a worse trade than the leak it would prevent.
export const SCRUB: readonly ScrubRule[] = [
    {
        name: "private key block",
        apply: (text) =>
            text.replace(
                /-----BEGIN [A-Z0-9 ]*PRIVATE KEY-----[\s\S]*?-----END [A-Z0-9 ]*PRIVATE KEY-----/g,
                MASKED,
            ),
    },
    {
        // The prefix is fixed by AWS and the body is 16 upper-case alphanumerics,
        // so this is close to unambiguous. It is also the case most likely to be
        // printed by accident, because it is the identifier people paste.
        name: "aws access key id",
        apply: (text) =>
            text.replace(/\b(?:AKIA|ASIA|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ABIA|ACCA)[0-9A-Z]{16}\b/g, MASKED),
    },
    {
        name: "json web token",
        apply: (text) => text.replace(/\beyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\b/g, MASKED),
    },
    {
        // The scheme is kept so the reader still knows an Authorization header was
        // there; only the credential after it goes.
        name: "authorization header",
        apply: (text) =>
            text.replace(
                /(\bauthorization\s*:\s*(?:bearer|basic|token)\s+)\S+/gi,
                (_match, prefix: string) => `${prefix}${MASKED}`,
            ),
    },
    {
        // `NAME=value` where the name promises a secret and the value is long
        // enough to be one. The length floor keeps `DEBUG_TOKEN=false` and
        // `PASSWORD_RESET_ENABLED=1` readable: they are flags, not credentials.
        //
        // Every quantifier is bounded, and that is not cosmetic: an unbounded
        // `[A-Za-z0-9_.-]*` on both sides of the alternation backtracks
        // cubically on a long run with no secret word in it, which on a large
        // tool result is a stall inside a tool call rather than a slow regex.
        name: "named secret assignment",
        apply: (text) =>
            text.replace(
                // The value stops at a backtick as well as at whitespace and the
                // usual delimiters: documentation and chat both wrap a secret in
                // backticks, and eating the closing one turns a sentence into a
                // broken Markdown span.
                /(["']?[A-Za-z0-9_.-]{0,64}(?:secret|token|passwd|password|passphrase|api[_-]?key|apikey|access[_-]?key|private[_-]?key|credential)[A-Za-z0-9_.-]{0,64}["']?\s*[:=]\s*)(["']?)([^"'\s,}\x60]{6,})\2/gi,
                // The quote is put back on both sides: dropping the closing one
                // would leave `{"key": <masked>` and the agent would spend a turn
                // on a JSON syntax error instead of on the task.
                (_match, prefix: string, quote: string) => `${prefix}${quote}${MASKED}${quote}`,
            ),
    },
    {
        // A password inside a URL: scheme://user:secret@host. The host is kept, so
        // the reader can still tell which service was reached.
        //
        // The scheme is bounded for the same reason the assignment rule's name is:
        // `[a-z0-9+.-]*` runs to the end of a long line before failing to find
        // "://", then backs up one character at a time for every start position,
        // which is quadratic. A real scheme is well under 30 characters.
        name: "credentials in a url",
        apply: (text) =>
            text.replace(/([a-z][a-z0-9+.-]{0,30}:\/\/[^\s:/@]+:)([^\s@/]+)(@)/gi, (_match, lead, _secret, tail: string) => `${lead}${MASKED}${tail}`),
    },
]

// What to do with one tool result.
export type Inspection =
    | { readonly kind: "pass" }
    | { readonly kind: "whole"; readonly reason: string }
    | { readonly kind: "scrub"; readonly text: string }

// The rules that apply to `text`, or pass.
//
// A command rule wins over everything: if the command is one of the known secret
// readers, its output is not scanned at all, because scanning it implies some of
// it might be safe to show.
export const inspect = (input: { readonly command?: string | undefined; readonly text: string }): Inspection => {
    const command = input.command ?? ""

    const whole = wholeRules(command)
    if (whole.length > 0) return { kind: "whole", reason: whole.join(", ") }

    // Only the head is scanned; the tail is handed back untouched. See MAX_SCAN.
    const capped = input.text.length > MAX_SCAN
    const head = capped ? input.text.slice(0, MAX_SCAN) : input.text

    let text = head
    let hit = false
    for (const rule of SCRUB) {
        const next = rule.apply(text)
        if (next === text) continue
        hit = true
        text = next
    }
    if (!hit) return { kind: "pass" }

    return { kind: "scrub", text: capped ? text + input.text.slice(MAX_SCAN) : text }
}

// What a whole output is replaced with.
//
// The note is not decoration: an agent handed a bare <masked> retries the call,
// which is the loop tool-guard exists to catch. Naming the rule tells it the
// value was withheld on purpose, and the last line tells it what to do instead.
export const withheld = (reason: string): string =>
    [
        MASKED,
        `secret-guard withheld this output (${reason}). It is a secret and is not shown to the agent.`,
        "Ask the user for the value if you need it; do not retry the command expecting a different answer.",
    ].join("\n")
