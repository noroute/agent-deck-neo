// Minimal client for agent-deck. agent-deck has no socket API, so this runs its
// CLI (`list --json`, `group list --json`, `session focus`) and talks to tmux
// directly for in-place switching. Stream Deck launches the plugin without your
// shell PATH, so binaries are resolved from the usual install locations.
import { execFile } from "node:child_process";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";

const SEARCH_DIRS = [
  "/opt/homebrew/bin",
  "/usr/local/bin",
  path.join(os.homedir(), ".local", "bin"),
  path.join(os.homedir(), "go", "bin"),
  path.join(os.homedir(), "bin"),
  "/usr/bin",
];

const expand = (p) => String(p ?? "").trim().replace(/^~(?=\/|$)/, os.homedir());

function findBinary(name, override) {
  const o = expand(override);
  if (o) return fs.existsSync(o) ? o : null;
  const dirs = [...(process.env.PATH ?? "").split(":").filter(Boolean), ...SEARCH_DIRS];
  for (const d of dirs) {
    const p = path.join(d, name);
    try {
      fs.accessSync(p, fs.constants.X_OK);
      return p;
    } catch {
      /* next */
    }
  }
  return null;
}

function run(bin, args, env, timeoutMs = 5000) {
  return new Promise((resolve, reject) => {
    execFile(bin, args, { env, timeout: timeoutMs, maxBuffer: 16 << 20 }, (err, stdout, stderr) => {
      if (err) return reject(new Error(`${path.basename(bin)} ${args.join(" ")}: ${(stderr || err.message).trim()}`));
      resolve(stdout);
    });
  });
}

// Coarse agent-deck status + substate -> the key colour states.
//   waiting = finished, not yet looked at; with an open menu it is blocked on you.
//   idle    = waiting that you have already seen.
export function keyStatus(s) {
  switch (s.status) {
    case "waiting":
      if (s.substate === "interactive-menu") return "blocked";
      if (s.substate === "usage-limit") return "error";
      return "done";
    case "running":
    case "starting":
      return "working";
    case "idle":
      return s.substate === "usage-limit" ? "error" : "idle";
    case "error":
      return "error";
    case "stopped":
    case "queued":
      return "stopped";
    default:
      return "unknown";
  }
}

export class AgentDeckClient {
  constructor() {
    this.configure({});
    this.groupOrder = [];
    this.groupsAt = 0;
  }

  configure({ agentDeckPath, tmuxPath, profile } = {}) {
    this.bin = findBinary("agent-deck", process.env.AGENT_DECK_BIN || agentDeckPath);
    const tmuxOverride = process.env.AGENT_DECK_TMUX_BIN ?? tmuxPath;
    this.tmux = tmuxOverride === "none" ? null : findBinary("tmux", tmuxOverride);
    this.profile = String(profile ?? "").trim();
    // agent-deck itself shells out to tmux, so it needs a PATH that has it.
    const extra = [this.bin, this.tmux].filter(Boolean).map(path.dirname);
    this.env = { ...process.env, PATH: [...new Set([...extra, ...SEARCH_DIRS, ...(process.env.PATH ?? "").split(":")])].filter(Boolean).join(":") };
    this.groupsAt = 0;
  }

  get where() {
    return this.bin ?? "agent-deck (not found)";
  }

  cli(args, timeoutMs) {
    if (!this.bin) return Promise.reject(new Error("agent-deck binary not found; set its path in the key settings"));
    const pre = this.profile ? ["-p", this.profile] : [];
    return run(this.bin, [...pre, ...args], this.env, timeoutMs);
  }

  async groups() {
    // Group order changes rarely; refresh it every 10 s.
    if (Date.now() - this.groupsAt < 10_000) return this.groupOrder;
    try {
      const out = JSON.parse(await this.cli(["group", "list", "--json"]));
      this.groupOrder = (out.groups ?? []).map((g) => g.path);
      this.groupsAt = Date.now();
    } catch {
      /* keep the old order */
    }
    return this.groupOrder;
  }

  // Every non-archived session, in the TUI's order (groups by their order, then
  // sessions by their order inside the group).
  async overview({ group, hideDead } = {}) {
    const [raw, order] = await Promise.all([this.cli(["list", "--json"]), this.groups()]);
    const parsed = JSON.parse(raw || "[]");
    const list = Array.isArray(parsed) ? parsed : parsed.sessions ?? [];
    const rank = (g) => {
      const i = order.indexOf(g);
      return i < 0 ? order.length : i;
    };
    const wanted = String(group ?? "").trim().toLowerCase();
    return list
      .map((s, i) => ({ s, i }))
      .filter(({ s }) => !s.archived)
      .filter(({ s }) => !wanted || String(s.group ?? "").toLowerCase() === wanted || String(s.group ?? "").toLowerCase().startsWith(wanted + "/"))
      .map(({ s, i }) => ({
        id: s.id,
        title: s.title || s.id,
        group: s.group ?? "",
        path: s.path ?? null,
        tool: s.tool ?? "",
        rawStatus: s.status,
        substate: s.substate ?? "",
        status: keyStatus(s),
        tmuxSession: s.tmux_session ?? null,
        viewers: (s.viewers ?? []).length,
        lastActivity: Date.parse(s.last_activity_at ?? "") || 0,
        sortKey: [rank(s.group ?? ""), i],
      }))
      .filter((s) => !hideDead || !["error", "stopped"].includes(s.rawStatus))
      .sort((a, b) => a.sortKey[0] - b.sortKey[0] || a.sortKey[1] - b.sortKey[1])
      .map((s, i) => ({ ...s, number: i + 1 }));
  }

  // The terminal currently showing an agent-deck session, if any: a real tmux
  // client (not a control-mode pipe) attached to an agentdeck_* session.
  async attachedClient() {
    if (!this.tmux) return null;
    // "|" not "\t": without a UTF-8 locale (Stream Deck sets none) tmux prints
    // control characters in -F output as "_".
    const out = await run(this.tmux, ["list-clients", "-F", "#{client_tty}|#{client_control_mode}|#{client_activity}|#{session_name}"], this.env, 2000)
      .catch(() => "");
    return out
      .split("\n")
      .map((l) => l.split("|"))
      .filter(([tty, control, , name]) => tty && control !== "1" && name?.startsWith("agentdeck_"))
      .map(([tty, , activity, name]) => ({ tty, activity: Number(activity) || 0, session: name }))
      .sort((a, b) => b.activity - a.activity)[0] ?? null;
  }

  // Bring a session up. The TUI only reads focus requests while its list is on
  // screen; while a session is attached the TUI is suspended in `tmux attach`.
  //   live + inside a session -> switch that terminal over in place.
  //   dead + inside a session -> queue a select, then detach (like Ctrl+Q) so
  //                              the TUI comes back with the cursor on it.
  //   not inside a session    -> ask the TUI to attach (live) or select (dead).
  async focus(s) {
    const live = !["error", "stopped"].includes(s.rawStatus) && !!s.tmuxSession;
    const client = await this.attachedClient();
    if (client && live) {
      if (client.session === s.tmuxSession) return "already there";
      await run(this.tmux, ["switch-client", "-c", client.tty, "-t", s.tmuxSession], this.env, 2000);
      return "switched";
    }
    await this.cli(["session", "focus", s.id, ...(live ? ["--attach"] : [])]);
    if (client) {
      await run(this.tmux, ["detach-client", "-t", client.tty], this.env, 2000);
      return "detached to TUI, select";
    }
    return live ? "attach" : "select";
  }
}

// Read the current git branch from .git/HEAD without spawning git
// (on a Mac without developer tools, calling git pops an install dialog).
export function gitInfo(cwd) {
  if (!cwd) return null;
  let dir = cwd;
  for (let i = 0; i < 40; i++) {
    const dotgit = path.join(dir, ".git");
    try {
      const st = fs.statSync(dotgit);
      let gitdir = dotgit;
      if (st.isFile()) {
        const m = fs.readFileSync(dotgit, "utf8").match(/gitdir:\s*(.+)/);
        if (!m) return null;
        gitdir = path.resolve(dir, m[1].trim());
      }
      const head = fs.readFileSync(path.join(gitdir, "HEAD"), "utf8").trim();
      const ref = head.match(/^ref:\s*refs\/heads\/(.+)$/);
      return { root: dir, repo: path.basename(dir), branch: ref ? ref[1] : head.slice(0, 7) };
    } catch {
      /* keep walking up */
    }
    const parent = path.dirname(dir);
    if (parent === dir) break;
    dir = parent;
  }
  return null;
}
