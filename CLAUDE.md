# Agent Deck for Stream Deck Neo

A Stream Deck plugin (macOS, Stream Deck 7.6+) that shows each agent-deck session on one Neo key, colour-coded by agent state. Pressing a key opens that session. A Neo Infobar action shows a summary. It is a port of `../herdr-neo` (same key design, same mock-host approach) to agent-deck.

## Layout

- `src/plugin.js`: entry point. It registers two actions, the `…session` key (Keypad) and the `…summary` Infobar (Neo controller), then runs the 1 s poll loop and handles press/hold.
- `src/agentdeck.js`: agent-deck CLI client (binary lookup, `list --json`, group order, status mapping, focus via tmux or `session focus`) and the `.git/HEAD` branch reader.
- `src/render.js`: SVG key renderer (144×144), status colours and Infobar text.
- `plugin/local.agentzero.agentdeck.sdPlugin/`: the plugin folder Stream Deck loads.
  - `manifest.json`
  - `ui/session.html`: property inspector, plain HTML using the raw Stream Deck websocket protocol.
  - `layouts/infobar.json`: Infobar layout, 232×50 px.
  - `imgs/`: icons.
  - `bin/plugin.js`: **generated** by `node build.mjs`. Don't edit it by hand.
- `test/mock-host.mjs`: fake Stream Deck app. It launches the bundled plugin, sends `willAppear` for 8 keys and the Infobar, records `setImage`/`setFeedback`, and can press or hold keys.
- `test/fake-agent-deck.mjs` + `test/fixtures/sessions.json`: stand-in for the agent-deck CLI used by the mock host. It logs every call to `$FAKE_CALLS_LOG`.
- `test/preview.py`: composites recorded key SVGs into a Neo-like PNG (needs `pip install cairosvg pillow` and the cairo library).

## Commands

```sh
npm install
npm run check                                                       # build + validate + mock-host smoke test, fails on errors
npm run package                                                     # check, then pack dist/*.streamDeckPlugin (overwrites)
node build.mjs                                                      # bundle src/ -> bin/plugin.js (esbuild, ESM, node20)
npx streamdeck link plugin/local.agentzero.agentdeck.sdPlugin       # one-time: Stream Deck loads this folder
npx streamdeck restart local.agentzero.agentdeck                    # reload after a build
```

Dev loop on the Mac: edit `src/`, then run `node build.mjs && npx streamdeck restart local.agentzero.agentdeck`. Plugin logs are in `plugin/local.agentzero.agentdeck.sdPlugin/logs/`.

## Testing without the device

`npm test` runs the mock host against the fake CLI and `test/fake-tmux.mjs` (one terminal attached to the Auth service session). It snaps the keys, presses key 2 (dead: select + detach), key 5 (live: switch-client) and holds key 0 (already there), then fails if the plugin crashed, left a key or the Infobar undrawn, or didn't make the expected agent-deck/tmux calls. Change the fixture and the expected ids together. The not-attached path (`session focus --attach`) isn't covered; `AGENT_DECK_TMUX_BIN=none` disables tmux.

```sh
LIVE=1 node test/mock-host.mjs test/out-live          # read-only snap against your real agent-deck
STEPS='["tag:a","press:0","wait:900","tag:b"]' LIVE=1 node test/mock-host.mjs test/out-live   # presses really switch your terminal
```

Steps: `snap`, `tag:<name>` (dump current images), `press:<keyIndex 0-7>`, `hold` (key 0, 700 ms), `wait:<ms>`.

## agent-deck facts (verified against agent-deck v1.16.26)

- No socket or JSON-RPC API. `agent-deck web` has an HTTP API but only while the web server runs, so the plugin uses the CLI. `list --json` takes about 130 ms.
- `list --json` returns an array of `{id, title, path, group, tool, status, substate, tmux_session, archived, last_activity_at, viewers[]}` in storage `sort_order` within each group. `group list --json` returns `{groups:[{path,…}]}` in TUI group order.
- Statuses: `running | waiting | idle | error | starting | stopped | queued`. `waiting` means the turn finished and you haven't looked yet; it turns `idle` once seen. Substates (see `internal/tmux/substate.go` upstream): `running`, `idle-at-empty-prompt`, `interactive-menu` (permission dialog / question picker: the real "blocked"), `background-work`, `model-unavailable`, `auth-401`, `usage-limit`, `unknown-exit`, `hook-lag`.
- `agent-deck session focus <id> [--attach]` writes a request to the profile's state.db. The TUI consumes it on its next tick (10 s TTL), but only while the TUI's list view is showing. While a session is attached, the TUI is suspended in a `tmux attach-session` child and isn't ticking, so requests expire unseen. The plugin therefore switches the attached tmux client for live sessions, and for dead ones writes the select request and then runs `tmux detach-client` (what agent-deck's Ctrl+Q does) so the TUI resumes and consumes it.
- Sessions are tmux sessions named `agentdeck_*` on the default tmux server. `tmux list-clients` also shows control-mode pipes agent-deck uses for status; skip clients with `client_control_mode=1` or no tty. Stream Deck gives the plugin no locale, and then tmux prints control characters in `-F` output as `_`, so never use `\t` as a separator (`test/fake-tmux.mjs` mimics this).
- agent-deck itself runs tmux, so the plugin passes a PATH that includes Homebrew's bin dir (Stream Deck launches plugins without your shell PATH).

## Stream Deck SDK notes

- `@elgato/streamdeck` v3, with actions registered via `registerAction(new X())` and a `manifestId` class field (no decorators, so plain esbuild works).
- Neo Infobar: `Controllers: ["Neo"]`, layout 232×50, updated with `setFeedbackLayout` + `setFeedback`. It gets no tap events. Reapply the layout on every `onWillAppear`.
- Key images are SVG data URLs. `paint()` caches the last image for each action so only changes are sent.

## Conventions

- Keep dependencies minimal: the runtime dependency is `@elgato/streamdeck` only, bundled.
- Never shell out to `git` (on Macs without the developer tools it pops an install dialog). Read `.git/HEAD` instead.
- Never start, restart or stop sessions from the plugin; pressing a dead session only selects it.
- Bump `Version` in `manifest.json` (four-part, e.g. `0.1.1.0`) before packaging a release.
