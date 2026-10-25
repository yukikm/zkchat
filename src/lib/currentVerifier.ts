import type { LoadedDeploymentAssets } from "@zkapi/solana-sdk/deployment";
import { sha256Hex } from "@zkapi/solana-sdk/trust";
import { SDK_VERSION } from "./sdkVersion";

export const CURRENT_VERIFIER = Object.freeze({
  sdkVersion: "0.2.0-devnet.19",
  profileSha256:
    "5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a",
  deploymentId: "public-devnet-20261021-state-v1",
  pool: "2zAKvvfiV1RZtWw71EYthWVrR3ZiWgmy92DS75JpmG8R",
  originalWasmSha256:
    "c06a247e1ff88f1ac415ea127bcf49d486b5b4954715cdf00f133b5ac71c1f30",
  wasmSha256:
    "395465e39aef68ff1e9fd3167cb80d03a653bab09a54c83c18cbf8df06c60d84",
});

/** An independently installed verifier update for this exact funded profile.
 * Keep the profile, financial artifacts and custody binding untouched. Other
 * profiles and the two retired runtimes keep their original verifier bytes.
 */
export async function currentVerifier(
  config: { schema: number; profileSha256?: string },
  assets: LoadedDeploymentAssets,
  fetcher: typeof fetch = globalThis.fetch,
): Promise<{ wasm: Uint8Array; wasmSha256: string }> {
  if (
    SDK_VERSION !== CURRENT_VERIFIER.sdkVersion ||
    config.schema !== 2 ||
    config.profileSha256 !== CURRENT_VERIFIER.profileSha256
  )
    return { wasm: assets.wasm, wasmSha256: assets.wasmSha256 };
  if (
    assets.verifiedManifest.deployment_id !== CURRENT_VERIFIER.deploymentId ||
    assets.verifiedManifest.pool !== CURRENT_VERIFIER.pool ||
    assets.wasmSha256 !== CURRENT_VERIFIER.originalWasmSha256
  )
    throw new Error("Verifier update does not match this payment deployment.");
  const response = await fetcher(
    new URL(
      "../assets/zkapi-client-prover-0.2.0-devnet.16-395465e39aef68ff.wasm",
      import.meta.url,
    ),
    {
      method: "GET",
      credentials: "omit",
      redirect: "error",
      signal: AbortSignal.timeout(30_000),
    },
  );
  if (!response.ok) throw new Error("Payment verifier is unavailable.");
  const wasm = new Uint8Array(await response.arrayBuffer());
  if (
    (await sha256Hex(wasm)) !== CURRENT_VERIFIER.wasmSha256 ||
    !WebAssembly.validate(wasm)
  )
    throw new Error("Payment verifier hash mismatch.");
  return { wasm, wasmSha256: CURRENT_VERIFIER.wasmSha256 };
}
