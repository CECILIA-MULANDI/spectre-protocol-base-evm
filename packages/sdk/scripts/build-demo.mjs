// Bundles the browser prover + its npm deps (@noir-lang/*, @aztec/bb.js)
// into a single ESM file that the static demo page can load without a CDN.
import { build } from "esbuild";
import { mkdir, rm } from "node:fs/promises";
import { resolve } from "node:path";

const root = resolve(import.meta.dirname, "..");
const outDir = resolve(root, "../../docs/demo");
await rm(outDir, { recursive: true, force: true });
await mkdir(outDir, { recursive: true });

await build({
  entryPoints: [resolve(root, "scripts/demo-entry.ts")],
  bundle: true,
  format: "esm",
  platform: "browser",
  target: "es2022",
  outfile: resolve(outDir, "bundle.js"),
  loader: { ".wasm": "binary" },
  sourcemap: false,
  minify: true,
  logLevel: "info",
});
