import streamDeck, { SingletonAction } from "@elgato/streamdeck";
import { execFile } from "node:child_process";
import { AgentDeckClient, gitInfo } from "./agentdeck.js";
import { renderKey, infobarSummary } from "./render.js";

const PLUGIN = "local.agentzero.agentdeck";
const TICK_MS = 1000;
const HOLD_MS = 450;

const log = streamDeck.logger.createScope("agentdeck");
const deck = new AgentDeckClient();

let globals = { terminalApp: "Ghostty", agentDeckPath: "", profile: "", group: "", hideDead: false };
let state = { list: [], offline: true, phase: false };

// ---------- helpers ----------

function slotFor(action, settings) {
  const n = Number(settings?.slot);
  if (Number.isInteger(n) && n > 0) return n;
  const c = action.coordinates;
  return c ? c.row * 4 + c.column + 1 : 1; // Neo is 4 x 2
}

const gitCache = new Map();
function cachedGit(cwd) {
  const hit = gitCache.get(cwd);
  if (hit && Date.now() - hit.at < 5000) return hit.info;
  const info = gitInfo(cwd);
  gitCache.set(cwd, { at: Date.now(), info });
  return info;
}

function enrich(s) {
  const git = cachedGit(s.path);
  return { ...s, repo: git?.repo, branch: git?.branch };
}

function raiseTerminal() {
  const app = (globals.terminalApp || "").trim();
  if (!app || process.platform !== "darwin") return;
  execFile("open", ["-a", app], (err) => err && log.warn(`could not activate ${app}: ${err.message}`));
}

// Most urgent session anywhere: blocked first, then done; oldest change first.
function mostUrgent() {
  const rank = { blocked: 0, done: 1 };
  return state.list
    .filter((s) => s.status in rank)
    .sort((a, b) => rank[a.status] - rank[b.status] || a.lastActivity - b.lastActivity)[0];
}

// ---------- session key ----------

class SessionKey extends SingletonAction {
  manifestId = `${PLUGIN}.session`;
  cache = new Map();
  settings = new Map();
  downAt = new Map();

  async onWillAppear(ev) {
    this.cache.delete(ev.action.id);
    this.settings.set(ev.action.id, ev.payload.settings);
    await this.paint(ev.action, ev.payload.settings);
  }

  onWillDisappear(ev) {
    this.cache.delete(ev.action.id);
    this.settings.delete(ev.action.id);
  }

  async onDidReceiveSettings(ev) {
    this.cache.delete(ev.action.id);
    this.settings.set(ev.action.id, ev.payload.settings);
    await this.paint(ev.action, ev.payload.settings);
  }

  onKeyDown(ev) {
    this.downAt.set(ev.action.id, Date.now());
  }

  async onKeyUp(ev) {
    const held = Date.now() - (this.downAt.get(ev.action.id) ?? Date.now());
    this.downAt.delete(ev.action.id);
    try {
      let target;
      if (held >= HOLD_MS) {
        // Hold any key: jump to whichever session needs you most, anywhere.
        target = mostUrgent();
        if (!target) return void (await ev.action.showOk());
      } else {
        const slot = slotFor(ev.action, ev.payload.settings);
        target = state.list.find((s) => s.number === slot);
        if (!target) return void (await ev.action.showAlert());
      }
      const how = await deck.focus(target);
      log.info(`focus ${target.title} (${target.id}): ${how}`);
      raiseTerminal();
      await refresh();
    } catch (err) {
      log.warn(`press failed: ${err.message}`);
      await ev.action.showAlert();
    }
  }

  async paint(action, settings) {
    if (!action.isKey()) return;
    const slot = slotFor(action, settings ?? this.settings.get(action.id));
    const s = state.list.find((x) => x.number === slot) ?? null;
    const img = renderKey({ slot, s, offline: state.offline, dim: state.phase });
    if (this.cache.get(action.id) === img) return;
    this.cache.set(action.id, img);
    await action.setImage(img);
  }

  async paintAll() {
    for (const action of this.actions) {
      await this.paint(action).catch((e) => log.warn(e.message));
    }
  }
}

// ---------- Neo Infobar summary ----------

class Summary extends SingletonAction {
  manifestId = `${PLUGIN}.summary`;
  last = new Map();

  async onWillAppear(ev) {
    if (!ev.action.isNeoInfobar()) return;
    await ev.action.setFeedbackLayout("layouts/infobar.json");
    this.last.delete(ev.action.id);
    await this.paint(ev.action);
  }

  async paint(action) {
    if (!action.isNeoInfobar?.()) return;
    const s = infobarSummary(state.list, state.offline);
    const key = s.headline + "|" + s.detail;
    if (this.last.get(action.id) === key) return;
    this.last.set(action.id, key);
    await action.setFeedback({ headline: s.headline, detail: s.detail });
  }

  async paintAll() {
    for (const action of this.actions) await this.paint(action).catch((e) => log.warn(e.message));
  }
}

// ---------- loop ----------

const keys = new SessionKey();
const summary = new Summary();

async function refresh() {
  try {
    const list = await deck.overview({ group: globals.group, hideDead: !!globals.hideDead });
    state.list = list.map(enrich);
    if (state.offline) log.info(`connected via ${deck.where}`);
    state.offline = false;
  } catch (err) {
    if (!state.offline) log.warn(`agent-deck unreachable: ${err.message}`);
    state.offline = true;
    state.list = [];
  }
  await keys.paintAll();
  await summary.paintAll();
}

function applyGlobals(g) {
  globals = { ...globals, ...(g ?? {}) };
  deck.configure({ agentDeckPath: globals.agentDeckPath, profile: globals.profile });
}

streamDeck.settings.onDidReceiveGlobalSettings((ev) => {
  applyGlobals(ev.settings);
  refresh();
});

streamDeck.actions.registerAction(keys);
streamDeck.actions.registerAction(summary);

await streamDeck.connect();
applyGlobals(await streamDeck.settings.getGlobalSettings());

let busy = false;
setInterval(async () => {
  if (busy) return;
  busy = true;
  state.phase = !state.phase;
  try {
    await refresh();
  } finally {
    busy = false;
  }
}, TICK_MS);
refresh();
