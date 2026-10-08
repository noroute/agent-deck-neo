# Agent Deck for Stream Deck Neo

Shows your [agent-deck](https://github.com/asheshgoplani/agent-deck) sessions on your Stream Deck Neo's 8 keys, colour-coded by agent state. Press a key to jump straight to that session.

| Key colour | Meaning |
|---|---|
| Pink, blinking | The agent is blocked on you: a permission dialog or question menu is open |
| Yellow | Working (`running`, including background work) |
| Green | Waiting: finished its turn and you haven't looked yet |
| Black | Idle (already seen), stopped, or error. Errors have a red label: `AUTH`, `USAGE LIMIT`, `MODEL DOWN`, `EXITED`, `ERROR` |

A blue ring means a terminal is attached to that session right now. The Infobar summary shows "1 needs you", "2 ready to review", "3 working", or **Agent Zero** when nothing is waiting on you.

## Install (macOS)

1. Install agent-deck (see its README) and run `agent-deck` in your terminal. Keep the TUI open: key presses ask it to open sessions.
2. Update the Stream Deck app to **7.6 or later**, which the Infobar needs.
3. Build the plugin (`npm run package`, below) and double-click `dist/local.agentzero.agentdeck.streamDeckPlugin`.
4. In Stream Deck, select your Neo and open the **Agent Deck Neo** category:
   - Drag **Agent Deck session** onto each of the 8 keys. Each key numbers itself from its position (top row 1–4, bottom row 5–8).
   - Drag **Agent Deck summary** onto the Infobar.
5. Click any key and set **Terminal app** to the app you run agent-deck in (Ghostty, iTerm, Terminal, WezTerm, …). It is brought to the front when you press a key.

Key order is the TUI's order: groups in their order, sessions in their order inside each group. Archived sessions are skipped. The other settings (shared by all keys):

- **Group**: only show one group (and its subgroups), e.g. `Second-Brain`.
- **Hide dead**: skip stopped and errored sessions, so live ones get the keys.
- **Profile**: an agent-deck profile other than `default`.
- **agent-deck path**: only needed if it isn't in `/opt/homebrew/bin`, `/usr/local/bin`, `~/.local/bin` or `~/go/bin`.

To show more than 8 sessions, put keys on a second Neo page and set their **Session #** to 9–16.

## Controls

- **Press:** open that session.
  - If your terminal is already inside an agent-deck session, it switches in place (`tmux switch-client`).
  - Otherwise the agent-deck TUI is asked to attach it (`agent-deck session focus <id> --attach`), exactly as if you had pressed Enter on it.
  - Stopped or errored sessions are never restarted. They are selected in the TUI; if you're inside a session, your terminal first detaches back to the TUI (like Ctrl+Q) so you land with the cursor on it.
- **Hold (about half a second):** jump to the session that needs you most: blocked ones first, then waiting ones, oldest first.

## How it works

agent-deck has no socket API, so the plugin runs its CLI: `agent-deck list --json` about once a second, and `agent-deck group list --json` every 10 s for the group order. It reads git branches from `.git/HEAD` directly, so it never runs `git`. It doesn't send anything over the network.

Status mapping (`status` / `substate` from `list --json`):

| agent-deck | Key |
|---|---|
| `waiting` + `interactive-menu` | needs you |
| `waiting` | done |
| `running`, `starting` | working |
| `idle` | idle |
| `error`, or `usage-limit` on any status | error |
| `stopped`, `queued` | stopped |

## Build from source

```sh
npm install
npm run check                                                  # build + validate manifest + smoke test (mock host, fake agent-deck)
npm run package                                                # check, then pack dist/local.agentzero.agentdeck.streamDeckPlugin
npx streamdeck link plugin/local.agentzero.agentdeck.sdPlugin   # live-dev against your Stream Deck
```

`test/mock-host.mjs` is a fake Stream Deck app. By default it runs the plugin against `test/fake-agent-deck.mjs` and `test/fixtures/sessions.json`. `LIVE=1` uses your real agent-deck instead. `test/preview.py` composites the recorded key images into a Neo-style picture.
