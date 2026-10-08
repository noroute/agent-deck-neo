#!/usr/bin/env node
// Stand-in for the agent-deck CLI so the mock host runs without a real install.
// Serves test/fixtures/sessions.json (or $FAKE_SESSIONS) and logs every call to
// $FAKE_CALLS_LOG.
import fs from "node:fs";
import path from "node:path";
import { fileURLToPath } from "node:url";

const here = path.dirname(fileURLToPath(import.meta.url));
let args = process.argv.slice(2);
if (process.env.FAKE_CALLS_LOG) fs.appendFileSync(process.env.FAKE_CALLS_LOG, args.join(" ") + "\n");
if (args[0] === "-p") args = args.slice(2);
const sessions = JSON.parse(fs.readFileSync(process.env.FAKE_SESSIONS ?? path.join(here, "fixtures", "sessions.json"), "utf8"));

const cmd = args.filter((a) => !a.startsWith("-")).join(" ");
if (cmd === "list") {
  process.stdout.write(JSON.stringify(sessions));
} else if (cmd === "group list") {
  const groups = [...new Set(sessions.map((s) => s.group))].sort().map((p) => ({ name: p, path: p }));
  process.stdout.write(JSON.stringify({ groups, total_groups: groups.length }));
} else if (cmd.startsWith("session focus ")) {
  process.stdout.write("ok\n");
} else {
  process.stderr.write(`fake agent-deck: unsupported: ${args.join(" ")}\n`);
  process.exit(2);
}
