import assert from "node:assert/strict"
import { readFile } from "node:fs/promises"
import { stripTypeScriptTypes } from "node:module"
import test from "node:test"
import vm from "node:vm"

// Run mask.ts with no opencode at all; nothing here contacts a service.
//
// index.ts is absent by construction: the plugin wiring needs the host, so the
// decision -- which command is a secret read, which span of ordinary text is a
// credential, and what a masked result says -- lives in mask.ts and is exercised
// here. See plugin-layout.test.mjs for the rule that keeps it there.

const load = async (path) => {
    const source = await readFile(new URL(path, import.meta.url), "utf8")
    const exported = [
        ...source.matchAll(/^export\s+(?:async\s+)?(?:const|let|function|class)\s+([A-Za-z_$][\w$]*)/gm),
    ].map((match) => match[1])
    const code =
        stripTypeScriptTypes(source)
            .replace(/^import .*$/gm, "")
            .replace(/^export /gm, "") + `\n;globalThis.exports = { ${exported.join(", ")} };\n`
    const scope = vm.createContext({})
    vm.runInContext(code, scope)
    return scope.exports
}

const { COMMANDS, inspect, looksSecret, MASKED, MAX_SCAN, PATHS, withheld, wholeRules } = await load(
    "../config/opencode/plugins/secret-guard/mask.ts",
)

// The masked form, as a plain string, so an assertion can talk about output.
const textOf = (verdict) => (verdict.kind === "pass" ? undefined : verdict.kind === "scrub" ? verdict.text : withheld(verdict.reason))

// --- what a command is -------------------------------------------------------

test("A secret manager read is a whole-output rule", () => {
    assert.deepEqual(
        [...wholeRules('aws secretsmanager get-secret-value --secret-id prod/db --query SecretString')],
        ["aws secretsmanager get-secret-value"],
    )
    // Global flags interleave with the subcommand, so the rule matches on words
    // rather than on a prefix.
    assert.equal(wholeRules("aws --region us-east-1 --profile work secretsmanager get-secret-value --secret-id x").length, 1)
    // The listing subcommand is not the read.
    assert.deepEqual([...wholeRules("aws secretsmanager list-secrets")], [])
})

test("The other secret readers the rules name are covered", () => {
    const cases = [
        "aws ssm get-parameter --name /prod/db --with-decryption",
        "aws ssm get-parameters --names /a /b --with-decryption",
        "aws sts assume-role --role-arn arn:aws:iam::1:role/x",
        "aws configure get aws_secret_access_key",
        "gcloud secrets versions access latest --secret=db",
        "az keyvault secret show --name db",
        "vault kv get secret/db",
        "op read op://vault/db/password",
        "pass show prod/db",
        "kubectl get secret db -o yaml",
    ]
    for (const command of cases) {
        assert.ok(wholeRules(command).length > 0, `not recognised: ${command}`)
    }
})

test("A command that only looks similar is left alone", () => {
    for (const command of [
        "kubectl get secrets",
        "aws s3 ls",
        "git log --oneline -5",
        "npm run build",
        "echo hello",
    ]) {
        assert.deepEqual([...wholeRules(command)], [], `over-matched: ${command}`)
    }
})

test("Reading a credential file is a whole-output rule", () => {
    for (const command of [
        "cat ~/.aws/credentials",
        "grep -r aws ~/.aws/credentials",
        "cp ~/.ssh/id_ed25519 /tmp/x",
        "cat ~/.npmrc",
        "cat ~/.config/gh/hosts.yml",
    ]) {
        assert.ok(wholeRules(command).length > 0, `not recognised: ${command}`)
    }
    // A listing says nothing sensitive, and the same reasoning applies to a file
    // whose name does not promise a secret.
    assert.deepEqual([...wholeRules("ls -la ~/.ssh")], [])
    assert.deepEqual([...wholeRules("cat README.md")], [])
})

test("Echoing a token variable is a whole-output rule, whatever the value looks like", () => {
    // The shell expands the variable before the output exists, so the value is a
    // bare string by the time it could be scanned. The name is the only signal.
    for (const command of [
        "echo $GITHUB_TOKEN",
        "echo ${AWS_SECRET_ACCESS_KEY}",
        "curl -H \"Authorization: Bearer $API_KEY\" https://example.test",
        "printenv GITHUB_TOKEN",
    ]) {
        assert.ok(wholeRules(command).length > 0, `not recognised: ${command}`)
    }
    for (const command of ["echo $HOME", "echo $PATH", "printenv PATH", "echo $PWD"]) {
        assert.deepEqual([...wholeRules(command)], [], `over-matched: ${command}`)
    }
})

test("A variable name is a secret when it says so", () => {
    for (const name of ["GITHUB_TOKEN", "AWS_SECRET_ACCESS_KEY", "db_password", "apiKey", "CLIENT_CREDENTIAL", "SIGNING_PRIVATE_KEY"]) {
        assert.equal(looksSecret(name), true, name)
    }
    for (const name of ["PATH", "HOME", "TOKENIZERS", "PWD", "NODE_ENV"]) {
        assert.equal(looksSecret(name), false, name)
    }
})

// --- what ordinary text loses ------------------------------------------------

test("A credential in ordinary text is masked, and the rest survives", () => {
    const key = "AKIAIOSFODNN7EXAMPLE"
    const out = textOf(inspect({ command: "grep AKIA .", text: `before ${key} after` }))
    assert.equal(out, `before ${MASKED} after`)
    assert.ok(!out.includes(key), "the key survived")
})

test("Private key blocks, tokens and auth headers are masked", () => {
    const pem = "-----BEGIN RSA PRIVATE KEY-----\nMIIEow\n-----END RSA PRIVATE KEY-----"
    assert.equal(textOf(inspect({ text: `key:\n${pem}\ndone` })), `key:\n${MASKED}\ndone`)

    const jwt = "eyJhbGciOiJIUzI1NiJ9.eyJzdWIiOiIxMjM0NTY3ODkwIn0.dozjgNryP4J3jVmNHl0w5N_XgL0n3I9PlFUP0THsR8U"
    assert.equal(textOf(inspect({ text: `token ${jwt}` })), `token ${MASKED}`)

    assert.equal(
        textOf(inspect({ text: "Authorization: Bearer abc123def456" })),
        `Authorization: Bearer ${MASKED}`,
    )
    // The scheme is kept; only the credential goes.
    assert.match(textOf(inspect({ text: "authorization: Basic dXNlcjpwYXNz" })), /^authorization: Basic <masked>$/)
})

test("A named assignment masks its value only when the value could be one", () => {
    assert.equal(textOf(inspect({ text: "AWS_SECRET_ACCESS_KEY=wJalrXUtnFEMI/K7MDENG" })), `AWS_SECRET_ACCESS_KEY=${MASKED}`)
    assert.equal(
        textOf(inspect({ text: '"aws_secret_access_key": "wJalrXUtnFEMI/K7MDENG"' })),
        `"aws_secret_access_key": "${MASKED}"`,
    )
    // A flag is not a credential. Masking it would make the output unreadable and
    // teach nothing.
    for (const text of ["DEBUG_TOKEN=false", "PASSWORD_RESET_ENABLED=1", "TOKEN_TTL=3600"]) {
        assert.equal(inspect({ text }).kind, "pass", `over-masked: ${text}`)
    }
})

test("A password inside a URL is masked and the host is kept", () => {
    assert.equal(
        textOf(inspect({ text: "postgres://app:s3cr3t@db.internal:5432/app" })),
        `postgres://app:${MASKED}@db.internal:5432/app`,
    )
})

test("An address on its own is not a secret", () => {
    // The deliberate trade: the user's secrets are caught by the command rules,
    // and masking every host and address here would break the ordinary work of
    // reading a log to find out why a connection failed.
    const text = "connect to 10.20.30.40 failed; tried db.internal and api.example.test"
    assert.equal(inspect({ text }).kind, "pass")
})

// --- the decision ------------------------------------------------------------

test("A command rule wins over scanning: the output is not read at all", () => {
    const verdict = inspect({
        command: "aws secretsmanager get-secret-value --secret-id prod/db",
        text: '{"SecretString":"{\\"host\\":\\"db.internal\\",\\"port\\":5432,\\"user\\":\\"app\\"}"}',
    })
    assert.equal(verdict.kind, "whole")
    assert.equal(verdict.reason, "aws secretsmanager get-secret-value")
})

test("A large output is scanned up to the cap and its tail is kept", () => {
    // Withholding a large output whole would turn reading a big, harmless file
    // into <masked>. The tail is passed through because the model never sees it:
    // tool_output caps the model's view far below MAX_SCAN.
    const padding = "y".repeat(MAX_SCAN)
    const key = "AKIAIOSFODNN7EXAMPLE"
    const verdict = inspect({ text: `${key}\n${padding}` })
    assert.equal(verdict.kind, "scrub")
    assert.ok(verdict.text.startsWith(MASKED), "the head was not masked")
    assert.equal(verdict.text.length, `${key}\n${padding}`.length - key.length + MASKED.length)

    // Nothing to mask means nothing changes, however large the output is.
    assert.equal(inspect({ text: padding }).kind, "pass")
})

test("A masked output says what happened and what to do instead", () => {
    const body = withheld("aws ssm get-parameter")
    assert.ok(body.startsWith(MASKED))
    assert.match(body, /aws ssm get-parameter/)
    // An agent handed a bare <masked> retries; the note is what stops that.
    assert.match(body, /Ask the user/)
    assert.match(body, /do not retry/i)
})

test("Every rule table is a plain list, so adding one is a one-line edit", () => {
    assert.ok(COMMANDS.length >= 10)
    assert.ok(PATHS.length >= 5)
    for (const rule of COMMANDS) {
        assert.ok(rule.words.length > 0, rule.name)
        assert.ok(rule.name.length > 0)
    }
})

test("A value wrapped in backticks does not eat the closing tick", () => {
    // Documentation and chat both quote a secret-shaped name this way. The value
    // stops at the backtick, so the sentence survives with only the value gone.
    const out = textOf(inspect({ text: "so `DEBUG_TOKEN=false` stays readable" }))
    // "false" is too short to be a credential, so nothing is masked at all here.
    assert.equal(out, undefined)

    const long = textOf(inspect({ text: "set `API_TOKEN=abcdefghij` now" }))
    assert.equal(long, "set `API_TOKEN=<masked>` now")
})

test("Only the argument of printenv counts, not every word after it", () => {
    // A commit message or a note about the command is not a command. Scanning
    // every later word turned one sentence into a dozen nonsense reasons.
    assert.deepEqual([...wholeRules("git commit -m 'document how printenv works'")], [])
    assert.deepEqual([...wholeRules("printenv GITHUB_TOKEN | head -1")], ["$GITHUB_TOKEN"])
    assert.deepEqual([...wholeRules("printenv PATH")], [])
})
