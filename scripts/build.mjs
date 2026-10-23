import { parseArgs } from "node:util";
import { resolve } from "node:path";
import { build } from "vite";
import "./verify-sdk.mjs";

function sdkBoundary(expected) {
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
        throw new Error(`Unexpected SDK in ${expected} bundle`);
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
  plugins: [sdkBoundary("@zkapi/solana-sdk")],
  worker: { plugins: () => [sdkBoundary("@zkapi/solana-sdk")] },
});
// Same origin preserves IndexedDB and profile bindings; the SDKs never share custody.
for (const [mode, directory, sdk] of [
  ["recovery-v12", "recovery-v12", "@zkapi/solana-sdk-previous"],
  ["recovery", "recovery-v3", "@zkapi/solana-sdk-legacy"],
]) {
  await build({
    mode,
    base: `${base}${directory}/`,
    plugins: [sdkBoundary(sdk)],
    worker: { plugins: () => [sdkBoundary(sdk)] },
    build: { outDir: resolve(`dist/${directory}`) },
  });
}
