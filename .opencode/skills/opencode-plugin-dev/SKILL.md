---
name: OpenCode Plugin Development
description: Use when writing, reviewing, migrating, or debugging an opencode plugin or terminal extension, so the v2 plugin model, discovery rules, and UI extension points are applied correctly
---

Reference for building opencode **v2** plugins. Claims marked *verified* were
tested against opencode v2.0.26 rather than read from documentation, because the
docs describe a later release than that binary ships.

## Which docs to use

Two different questions draw from two different sources:

- **How to build a plugin:** only the v2 docs — the server guide at
  `/v2/docs/build/plugins`, the terminal guide at `/v2/docs/build/plugins/cli`,
  and the effect variants under `/v2/docs/build/plugins/effect`. Never build
  from `/docs/plugins`, which documents v1.
- **What plugins exist and what to build next:** both v1 and v2 community
  plugins are fair game. opencode has no v2 ecosystem page; the community list
  lives at `/docs/ecosystem` and mixes eras, so read each entry's version before
  copying its approach. A v1 plugin is still a good source of *ideas* — an idea
  ports, its code does not.

The v2 config schema URL embedded in `opencode.json` may describe v1. Do not
use it to infer v2 field names.

## Look before you build

*verified* opencode ships roughly 90 **builtin** plugins, and they already
occupy most of the obvious extension points. They register under
`source.type: "builtin"` and are not configurable from `opencode.json`, but they
are the reason several plugins below are less work than they look.

The groups worth knowing, because they decide whether you need a plugin at all:

- **Config domain** (`opencode.config.*`) — agent, command, skill, mcp,
  provider, compaction, formatter, instruction, policy, reference, snapshot,
  shell, tool-output, websearch, watcher.
- **Providers** (`opencode.provider.*`) — bundled auth for GitHub Copilot,
  OpenAI, GitLab, Bedrock, Vertex, Azure, Ollama, LM Studio, OpenRouter, and
  roughly twenty more. Only worth overriding to rename, retag, or price-filter.
- **Tools** (`opencode.tool.*`) — read, write, edit, glob, grep, shell, patch,
  webfetch, websearch, skill, subagent, question. Registering a tool with the
  same name overrides the builtin.
- **Websearch** (`opencode.websearch.*`) — exa, tavily, firecrawl, parallel,
  tinyfish.
- **VCS** (`opencode.vcs.git`, `opencode.vcs.hg`) — the default strategies for
  worktrees.
- **Behaviour** — `opencode.prompt.*`, `opencode.warming`, `opencode.browser`,
  `opencode.wellknown`, `opencode.models.dev`.

Ask the running service what is actually loaded before assuming any of this:

```sh
opencode api get /api/plugin
```

It prints every plugin with its id, source, whether `server` and/or `tui` is
active, and its state — so it answers "did my plugin load" in one step, and
"does opencode already do this" just as fast. Note it resolves against the
*service's* location, which may not be the directory you launched from.

## Two kinds of plugin

opencode v2 splits extension points in two, and choosing wrong is the most
common mistake:

- **Server plugins** change behaviour. They can add tools, intercept requests,
  and transform the server's view of agents, commands, skills, MCP servers, and
  providers.
- **CLI plugins** change the terminal. They can contribute to named regions of
  the UI, open dialogs, register key bindings, and read what is loaded.

A server plugin cannot render UI, and a CLI plugin cannot register a
server-side tool. Upstream is explicit that changing the terminal means writing
a CLI plugin. Decide which one you are before designing anything.

## Migration from v1 is a rewrite

v2 is not a rename. A v1 plugin exports a function that returns an object of
hooks; a v2 plugin exports a definition carrying an id and a setup function.
**v1 implementations do not run in v2**, and renaming the config entry will not
make them. The config key changed too, and options moved from a positional
tuple to a labelled object.

The two plugin packages also sit under different scopes, which is a useful
tell when reading a package: the v2 package version tracks the opencode release
exactly, so it is a reliable signal of which API something targets.

The plugin API is **beta**. Entrypoints and hooks can change between releases,
so pin the plugin package to the opencode version you target and re-check the
docs on upgrade. v2 keeps reading v1-shaped configuration without rewriting the
file, which means a partly-migrated setup can appear to work; do not point a v1
install at files already converted to v2-only shapes.

## Discovery is positional and fails silently

*verified* A plugin directory is discovered by **sibling filenames**, not by a
package manifest. The expected shape is flat: a server entry and a CLI entry
sitting directly in the plugin directory.

Publishing a manifest that points at an entry inside a nested directory causes
the plugin to load **nothing at all** — no error, no log line, not even a
watcher on the directory. This cost real debugging time, because nothing
reports it. It is the first thing to check when a plugin appears to do nothing.

Dependencies are resolved by opencode at runtime, so a flat plugin needs no
installed dependencies. If you add a manifest, an install step runs and creates
a dependency directory inside your plugin folder — gitignore it.

Both the global config directory and each project's `.opencode` directory are
scanned automatically, so a purely local plugin needs no configuration entry.

## Transforms, not mutations

Server-side registration follows a pattern worth internalising: you register a
**transform**, an editor callback that opencode replays whenever the value is
rebuilt. Consequences that are easy to get wrong:

- The callback must be cheap, synchronous, and repeatable. It runs again on
  every rebuild, not once.
- Data the callback captured is not watched. Load external values first, then
  ask for a reload when those values change.
- Reloading replays transforms. It does **not** re-run setup. Anything that
  should happen on reload belongs inside the transform.
- Registrations are disposable, and disposing is idempotent. Unloading the
  plugin disposes everything it created, so returning an explicit cleanup from
  setup is still the polite thing to do.

## Extending the terminal

The CLI plugin exposes UI regions as named **slots**. You choose a placement
relative to a region, and supply a render function.

**Registration is not rendering.** *verified* Several slot names accept a
registration without complaint and then never render. In testing, the general
application regions rendered on first paint, while the sidebar regions
registered successfully and rendered zero times across sustained observation
with the render loop demonstrably alive, and with the feature that controls
tabs reporting itself enabled. So a successful registration is weak evidence.
If output is not visible, verify against a real interactive session before
concluding the code is wrong — and expect to fall back to a region you have
actually seen paint.

Register on an unrendered slot anyway. It is harmless, and it starts working if
the host later mounts that region.

Use append-style placement so other plugins can coexist. A replacing placement
takes the region over entirely, including from plugins you did not intend to
displace.

## Reactivity: read where you draw

CLI plugins get their data through cached, location-scoped stores. Two rules:

- The read returns nothing until the store has been synced. Always default an
  empty result rather than trusting the first call.
- **Read inside the render function, never capture during setup.** *verified*
  Capturing there produced a panel frozen at zero forever; reading in render
  repainted correctly once sync completed and again after a reload.

Capture-in-setup looks equivalent in simple cases and fails silently in exactly
the cases that matter.

## Input handling

Mouse and keyboard both have traps:

- The clickable props on raw renderable elements are the pointer-down and
  pointer-up family. A conventional click prop exists on opencode's own
  internal components but **not** on the raw elements you write, where it
  silently does nothing.
- Pointer events propagate. Stop propagation in your handler so a click inside
  your region does not trigger whatever the host binds to it.
- Bind your handler to a wrapping container rather than to the text inside it,
  so the whole row is a target instead of only the glyphs.
- **Check for conflicts before binding a shortcut.** *verified* opencode
  already reserves a family of digit bindings for switching sessions, so the
  obvious "one digit per section" scheme collides. Inspect the live keymap
  rather than assuming a binding is free. Dialogs additionally reserve some
  navigation keys outright.

## Verifying a plugin

- **Assert positively.** A plugin that fails to load may emit nothing, so
  "no errors appeared" is not evidence it loaded.
- Restart opencode after adding or removing a plugin. Configuration is cached
  when the service starts, and new files are ignored until then.
- Test against an isolated home directory, and give it its own service port.
  Sharing the default port with a live session makes every command silently
  return empty, which looks exactly like a plugin failure.
- Expect a cold service to return empty on the first query. Run it twice before
  drawing a conclusion.
- Use the config-source listing to confirm discovery in one step — it prints
  every location opencode loaded, in precedence order.
- For anything visual, drive the terminal under a pseudo-terminal and search
  the capture. The interface redraws in place, so the capture is a stream of
  deltas; strip escape sequences and expect fragments rather than whole
  frames. When the capture is too lossy to trust, have the plugin write to a
  probe file — that still proves execution when nothing is visible on screen.
- To confirm an interaction handler, call it directly with a synthetic event
  and check the resulting state. That verifies the handler and the state store
  independently of whether the host ever mounted the region.

## Pitfalls worth remembering

- Server plugin data and CLI plugin data are different objects. What a server
  plugin reads about agents, a CLI plugin cannot read the same way, and vice
  versa.
- Item shapes across the loaded registries are not uniform and are not all
  documented. Read name-ish fields defensively rather than assuming one key.
- A directory with no entrypoint at the expected location is skipped without a
  message.
- Reload does not re-enter setup. Setup-time side effects happen once.
