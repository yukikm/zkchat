import { readFile } from "node:fs/promises";
import { describe, expect, it, vi } from "vitest";
import type { LoadedDeploymentAssets } from "@zkapi/solana-sdk/deployment";
import { CURRENT_VERIFIER, currentVerifier } from "../src/lib/currentVerifier";

const config = { schema: 2, profileSha256: CURRENT_VERIFIER.profileSha256 };
const assets = () =>
  ({
    wasm: new Uint8Array([0]),
    wasmSha256: CURRENT_VERIFIER.originalWasmSha256,
    verifiedManifest: {
      deployment_id: CURRENT_VERIFIER.deploymentId,
      pool: CURRENT_VERIFIER.pool,
    },
  }) as LoadedDeploymentAssets;

describe("independently pinned current verifier", () => {
  it("loads the installed WASM while keeping financial deployment inputs unchanged", async () => {
    const original = assets();
    const before = structuredClone(original);
    const bytes = await readFile(
      new URL(
        "../src/assets/zkapi-client-prover-0.2.0-devnet.16-395465e39aef68ff.wasm",
        import.meta.url,
      ),
    );
    const fetcher = vi.fn(async () => new Response(bytes));
    const result = await currentVerifier(config, original, fetcher);
    expect(result.wasmSha256).toBe(CURRENT_VERIFIER.wasmSha256);
    expect(result.wasm).toEqual(new Uint8Array(bytes));
    expect(original).toEqual(before);
    expect(fetcher).toHaveBeenCalledOnce();
  });

  it("preserves other profile runtimes and rejects mismatched current deployment or bytes", async () => {
    const original = assets();
    const fetcher = vi.fn(async () => new Response(new Uint8Array([0])));
    expect(
      await currentVerifier(
        { schema: 2, profileSha256: "a".repeat(64) },
        original,
        fetcher,
      ),
    ).toEqual({ wasm: original.wasm, wasmSha256: original.wasmSha256 });
    expect(fetcher).not.toHaveBeenCalled();
    for (const field of ["pool", "deployment_id"] as const) {
      const wrong = assets();
      wrong.verifiedManifest[field] = "different";
      await expect(currentVerifier(config, wrong, fetcher)).rejects.toThrow(
        "does not match",
      );
    }
    const wrong = assets();
    wrong.wasmSha256 = "a".repeat(64);
    await expect(currentVerifier(config, wrong, fetcher)).rejects.toThrow(
      "does not match",
    );
    expect(fetcher).not.toHaveBeenCalled();
    await expect(currentVerifier(config, original, fetcher)).rejects.toThrow(
      "hash mismatch",
    );
  });
});
