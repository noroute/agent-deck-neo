// Key and Infobar rendering. Keys are drawn as SVG at 144x144.

export const STATUS_STYLE = {
  blocked: { bg: "#F06AA6", fg: "#1A0712", label: "NEEDS YOU" },
  done:    { bg: "#7BE39B", fg: "#06200F", label: "DONE" },
  working: { bg: "#E4F29B", fg: "#1D2206", label: "WORKING" },
  idle:    { bg: "#000000", fg: "#E8ECF4", label: "IDLE" },
  error:   { bg: "#000000", fg: "#E8ECF4", label: "ERROR", accent: "#FF6B6B" },
  stopped: { bg: "#000000", fg: "#8A93A3", label: "STOPPED" },
  unknown: { bg: "#000000", fg: "#AEB6C4", label: "UNKNOWN" },
};

// Error substates get a more specific bottom label.
const ERROR_LABEL = {
  "auth-401": "AUTH",
  "usage-limit": "USAGE LIMIT",
  "model-unavailable": "MODEL DOWN",
  "unknown-exit": "EXITED",
};

const esc = (s) =>
  String(s ?? "").replace(/[&<>"']/g, (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&apos;" })[c]);

// Shorten to fit roughly `max` characters at the given font size.
function fit(text, max) {
  const t = String(text ?? "");
  return t.length <= max ? t : t.slice(0, Math.max(1, max - 1)) + "…";
}

function svgUrl(svg) {
  return "data:image/svg+xml;charset=utf8," + encodeURIComponent(svg);
}

/**
 * @param {object} o
 * @param {number} o.slot     1-based key number
 * @param {object|null} o.s   session overview entry, or null for an empty slot
 * @param {boolean} o.offline agent-deck unreachable
 * @param {boolean} o.dim     blink phase for blocked keys
 */
export function renderKey({ slot, s, offline, dim }) {
  const font = "-apple-system, 'SF Pro Text', 'Helvetica Neue', Arial, sans-serif";
  if (offline || !s) {
    const msg = offline ? "agent-deck offline" : "empty";
    return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="#0B0D11"/>
  <text x="12" y="26" font-family="${font}" font-size="18" fill="#4B5260">${slot}</text>
  <text x="72" y="80" text-anchor="middle" font-family="${font}" font-size="${offline ? 14 : 17}" fill="#4B5260">${msg}</text>
</svg>`);
  }

  const base = STATUS_STYLE[s.status] ?? STATUS_STYLE.unknown;
  const blinkOff = s.status === "blocked" && dim;
  // Blocked keys alternate between solid pink and pink-on-black so they catch your eye.
  const style = blinkOff ? { bg: "#000000", fg: base.bg, label: base.label } : base;
  const bg = style.bg;
  const light = bg !== "#000000";
  const label = s.status === "error" ? ERROR_LABEL[s.substate] ?? base.label : style.label;
  const sub = light ? style.fg : blinkOff ? style.fg : "#C9CFDA";
  const muted = light ? style.fg : blinkOff ? style.fg : "#8A93A3";
  const labelColor = style.accent ?? muted;
  const titleColor = light || blinkOff ? style.fg : s.status === "stopped" || s.status === "error" ? "#AEB6C4" : "#FFFFFF";

  const title = fit(s.title, 13);
  const titleSize = title.length > 10 ? 18 : title.length > 8 ? 21 : 24;
  const lines = [];
  // Claude is the default tool; name any other agent next to the repo/group.
  const tool = s.tool && !["claude", "shell"].includes(s.tool) ? ` · ${s.tool}` : "";
  const where = s.repo && s.repo.toLowerCase() !== String(s.title).toLowerCase() ? s.repo : s.group;
  if (where || tool) lines.push(fit((where || "") + tool, 15).replace(/^ · /, ""));
  if (s.branch) lines.push("⎇ " + fit(s.branch, 13));

  const lineSvg = lines
    .map((l, i) => `<text x="72" y="${86 + i * 21}" text-anchor="middle" font-family="${font}" font-size="16" fill="${sub}" opacity="0.85">${esc(l)}</text>`)
    .join("\n  ");

  const ring = s.viewers > 0 ? `<rect x="3" y="3" width="138" height="138" rx="10" fill="none" stroke="${light ? style.fg : "#5B8CFF"}" stroke-width="4" opacity="0.55"/>` : "";

  return svgUrl(`<svg xmlns="http://www.w3.org/2000/svg" width="144" height="144" viewBox="0 0 144 144">
  <rect width="144" height="144" fill="${bg}"/>
  ${ring}
  <text x="12" y="26" font-family="${font}" font-size="18" font-weight="600" fill="${muted}">${slot}</text>
  <text x="72" y="60" text-anchor="middle" font-family="${font}" font-size="${titleSize}" font-weight="700" fill="${titleColor}">${esc(title)}</text>
  ${lineSvg}
  <text x="72" y="132" text-anchor="middle" font-family="${font}" font-size="14" font-weight="600" letter-spacing="1" fill="${labelColor}">${esc(label)}</text>
</svg>`);
}

/** Text for the Neo Infobar summary. */
export function infobarSummary(list, offline) {
  if (offline) return { headline: "agent-deck offline", detail: "check the agent-deck path" };
  const c = { blocked: 0, working: 0, done: 0, error: 0 };
  for (const s of list) if (s.status in c) c[s.status]++;
  const errs = c.error ? ` · ${c.error} error${c.error === 1 ? "" : "s"}` : "";
  if (c.blocked) {
    const first = list.find((s) => s.status === "blocked");
    return { headline: `${c.blocked} need${c.blocked === 1 ? "s" : ""} you`, detail: `${first.number} ${first.title} · ${c.working} working` };
  }
  if (c.done) return { headline: `${c.done} ready to review`, detail: `${c.working} working${errs}` };
  if (c.working) return { headline: `${c.working} working`, detail: `nothing waiting on you${errs}` };
  return { headline: "Agent Zero", detail: `${list.length} sessions · all quiet${errs}` };
}
