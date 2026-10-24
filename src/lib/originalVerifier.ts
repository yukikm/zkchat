import type { LoadedDeploymentAssets } from "@zkapi/solana-sdk/deployment";

/** Vite selects this module for the two retired recovery builds. */
export async function currentVerifier(
  _config: unknown,
  assets: LoadedDeploymentAssets,
) {
  return { wasm: assets.wasm, wasmSha256: assets.wasmSha256 };
}
