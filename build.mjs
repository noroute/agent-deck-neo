import { build } from "esbuild";
await build({
  entryPoints: ["src/plugin.js"],
  bundle: true,
  platform: "node",
  target: "node20",
  format: "esm",
  outfile: "plugin/local.agentzero.agentdeck.sdPlugin/bin/plugin.js",
  banner: { js: "import { createRequire } from 'module'; const require = createRequire(import.meta.url);" },
  logLevel: "info",
});
