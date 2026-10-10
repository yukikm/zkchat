import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { build } from "vite";
import "./verify-sdk.mjs";

function sdkBoundary(legacy) {
  const expected = legacy ? "@zkapi/solana-sdk-legacy" : "@zkapi/solana-sdk";
  return {
    name: "verify-sdk-runtime-boundary",
    generateBundle() {
      const sdkModules = [...this.getModuleIds()].filter((id) =>
        id.includes("/node_modules/@zkapi/solana-sdk"),
      );
      if (
        !sdkModules.length ||
        sdkModules.some((id) => !id.includes(`/node_modules/${expected}/`))
      )
        throw new Error(
          `Unexpected SDK in ${legacy ? "recovery" : "current"} bundle`,
        );
    },
  };
}

const { values } = parseArgs({
  options: { base: { type: "string", default: "/" } },
});
const base = values.base.endsWith("/") ? values.base : `${values.base}/`;
if (!base.startsWith("/") || base.startsWith("//") || /[?#]/.test(base))
  throw new Error("Use an absolute same-origin base path, e.g. /chat/.");
await build({
  base,
  plugins: [sdkBoundary(false)],
  worker: { plugins: () => [sdkBoundary(false)] },
});
// Same origin preserves IndexedDB and profile bindings; the SDKs never share custody.
await build({
  mode: "recovery",
  base: `${base}recovery-v3/`,
  plugins: [sdkBoundary(true)],
  worker: { plugins: () => [sdkBoundary(true)] },
  build: { outDir: resolve("dist/recovery-v3") },
});
