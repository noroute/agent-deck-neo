// Fake Stream Deck app: launches the plugin, shows it 8 Neo keys + the Infobar,
// records what it draws, and presses keys. Usage: node test/mock-host.mjs <outdir>
// By default the plugin talks to test/fake-agent-deck.mjs and test/fake-tmux.mjs
// (fixture data, a terminal attached to the Auth service session). LIVE=1 uses your real agent-deck and tmux instead.
import { WebSocketServer } from "ws";
import { spawn } from "node:child_process";
import fs from "node:fs";
import path from "node:path";

const out = path.resolve(process.argv[2] ?? "test/out");
fs.mkdirSync(out, { recursive: true });
const PLUGIN = "local.agentzero.agentdeck";
const LIVE = process.env.LIVE === "1";
const callsLog = path.join(out, "calls.log");
fs.rmSync(callsLog, { force: true });
const wss = new WebSocketServer({ port: 0 });
const port = wss.address().port;
const images = {}, feedback = {}, alerts = [];
const device = "NEO1";
const info = {
  application: { font: "", language: "en", platform: "mac", platformVersion: "15.0", version: "7.6.0.0" },
  plugin: { uuid: PLUGIN, version: "0.1.0.0" },
  devicePixelRatio: 2, colors: {},
  devices: [{ id: device, name: "Neo", size: { columns: 4, rows: 2 }, type: 9 }],
};

const ctx = (i) => `key${i}`;
let sock;
const send = (o) => sock.send(JSON.stringify(o));
const appear = (i) => send({
  event: "willAppear", action: `${PLUGIN}.session`, context: ctx(i), device,
  payload: { controller: "Keypad", coordinates: { column: i % 4, row: Math.floor(i / 4) }, isInMultiAction: false, settings: {} },
});

wss.on("connection", (s) => {
  sock = s;
  s.on("message", (raw) => {
    const m = JSON.parse(raw);
    if (m.event === "registerPlugin") {
      for (let i = 0; i < 8; i++) appear(i);
      send({ event: "willAppear", action: `${PLUGIN}.summary`, context: "infobar", device,
        payload: { controller: "Neo", coordinates: { column: 0, row: 0 }, isInMultiAction: false, settings: {} } });
    } else if (m.event === "getGlobalSettings") {
      send({ event: "didReceiveGlobalSettings", payload: { settings: { terminalApp: "" } } });
    } else if (m.event === "setImage") {
      images[m.context] = m.payload.image;
    } else if (m.event === "setFeedback") {
      feedback[m.context] = { ...feedback[m.context], ...m.payload };
    } else if (m.event === "showAlert" || m.event === "showOk") {
      alerts.push(`${m.event}:${m.context}`);
    }
  });
});

const env = LIVE ? { ...process.env } : {
  ...process.env,
  AGENT_DECK_BIN: path.resolve("test/fake-agent-deck.mjs"),
  AGENT_DECK_TMUX_BIN: path.resolve("test/fake-tmux.mjs"),
  FAKE_CALLS_LOG: callsLog,
};
const child = spawn(process.execPath, [
  "bin/plugin.js",
  "-port", String(port), "-pluginUUID", PLUGIN, "-registerEvent", "registerPlugin", "-info", JSON.stringify(info),
], { stdio: ["ignore", "inherit", "inherit"], cwd: "plugin/local.agentzero.agentdeck.sdPlugin", env });
let exitCode = null;
child.on("exit", (code) => { exitCode = code; });

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
const svgOf = (img) => decodeURIComponent(img.replace(/^data:image\/svg\+xml;charset=utf8,/, ""));
function dump(tag) {
  for (const [c, img] of Object.entries(images)) fs.writeFileSync(path.join(out, `${tag}-${c}.svg`), svgOf(img));
  fs.writeFileSync(path.join(out, `${tag}-infobar.json`), JSON.stringify(feedback.infobar ?? {}));
  console.log(`[${tag}] infobar:`, JSON.stringify(feedback.infobar), "alerts:", alerts.join(","));
}
const press = async (i, hold = 50) => {
  const p = { controller: "Keypad", coordinates: { column: i % 4, row: Math.floor(i / 4) }, isInMultiAction: false, settings: {} };
  send({ event: "keyDown", action: `${PLUGIN}.session`, context: ctx(i), device, payload: p });
  await sleep(hold);
  send({ event: "keyUp", action: `${PLUGIN}.session`, context: ctx(i), device, payload: p });
};

// Steps run in order, so the shell can change agent-deck state between them.
const defaultSteps = LIVE ? ["snap"] : ["snap", "press:2", "press:5", "hold", "wait:500"];
const steps = JSON.parse(process.env.STEPS ?? JSON.stringify(defaultSteps));
await sleep(2500);
for (const [n, step] of steps.entries()) {
  if (step === "snap") dump(`s${n}`);
  else if (step.startsWith("press:")) await press(Number(step.slice(6)));
  else if (step === "hold") await press(0, 700);
  else if (step.startsWith("wait:")) await sleep(Number(step.slice(5)));
  else if (step.startsWith("tag:")) dump(step.slice(4));
}

// Fail (for `npm test`) if the plugin died or didn't draw every key and the Infobar.
const problems = [];
if (exitCode !== null) problems.push(`plugin exited early with code ${exitCode}`);
const blank = [...Array(8).keys()].map(ctx).filter((c) => !images[c]);
if (blank.length) problems.push(`no image for ${blank.join(", ")}`);
if (!feedback.infobar) problems.push("no Infobar feedback");
if (!LIVE && process.env.STEPS === undefined) {
  // Fixture checks: every key drawn from data, and both presses reached agent-deck.
  const offline = Object.entries(images).filter(([, img]) => /offline|empty/.test(svgOf(img))).map(([c]) => c);
  if (offline.length) problems.push(`fixture keys not drawn from data: ${offline.join(", ")}`);
  const calls = fs.existsSync(callsLog) ? fs.readFileSync(callsLog, "utf8") : "";
  // A terminal is attached to Auth service (fake tmux), so:
  // key 2 = Migrations (errored): queue a select, then detach back to the TUI.
  // key 5 = Docs site (running): switch the terminal in place.
  // hold  = Auth service (blocked): already there, nothing to do.
  const expect = [
    ["press:2 did not select Migrations", "session focus 00000005-1700000005\n"],
    ["press:2 did not detach to the TUI", "tmux detach-client -t /dev/ttys001\n"],
    ["press:5 did not switch to Docs site", "tmux switch-client -c /dev/ttys001 -t agentdeck_Docs-site_00000001\n"],
  ];
  for (const [msg, line] of expect) if (!calls.includes(line)) problems.push(msg);
  if (calls.includes("--attach")) problems.push("unexpected --attach (a terminal was attached)");
  if ((calls.match(/detach-client/g) ?? []).length !== 1) problems.push("expected exactly one detach");
  if (alerts.length) problems.push(`unexpected alerts: ${alerts.join(",")}`);
}
child.kill();
wss.close();
if (problems.length) {
  console.error("mock-host FAIL:", problems.join("; "));
  process.exitCode = 1;
} else {
  console.log("mock-host OK");
}
