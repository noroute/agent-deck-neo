#!/usr/bin/env node
// Stand-in for tmux: one real client on /dev/ttys001 viewing the Auth service
// session, plus an agent-deck control-mode pipe that must be ignored. Like real
// tmux without a UTF-8 locale, control characters in -F output come out as "_".
// Logs every call to $FAKE_CALLS_LOG as "tmux <args>".
import fs from "node:fs";

const args = process.argv.slice(2);
if (process.env.FAKE_CALLS_LOG) fs.appendFileSync(process.env.FAKE_CALLS_LOG, ["tmux", ...args].join(" ") + "\n");
if (args[0] === "list-clients") {
  const format = args[args.indexOf("-F") + 1] ?? "#{client_tty}";
  const clients = [
    { client_tty: "", client_control_mode: "1", client_activity: "1700000099", session_name: "agentdeck_Docs-site_00000001" },
    { client_tty: "/dev/ttys001", client_control_mode: "0", client_activity: "1700000050", session_name: "agentdeck_Auth-service_00000000" },
  ];
  const line = (c) => format.replace(/#\{(\w+)\}/g, (_, k) => c[k] ?? "").replace(/[\x00-\x1f]/g, "_");
  process.stdout.write(clients.map(line).join("\n") + "\n");
}
