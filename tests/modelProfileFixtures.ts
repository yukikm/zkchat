import type { LoadedPublicDeploymentProfile } from "@zkapi/solana-sdk/public-profile";

/** Synthetic authenticated-loader outputs; no provider or financial I/O. */
export function modelProfiles() {
  const tariff = {
    version: "1",
    provider: "openrouter",
    model: "*",
    pricing_basis: "provider_reported_usd",
    rates: [],
    operator_fee_micro_usdc: "0",
    tariff_hash: "c".repeat(64),
    valid_from: "100",
    valid_until: "9999999999",
  };
  const base = {
    profileSha256: "a".repeat(64),
    profile: {
      schema: 1,
      id: "deployment",
      revision: 1,
      sdkVersions: ["0.2.0-devnet.13"],
      protocolLayoutVersion: 2,
      mode: "direct_openrouter",
      bundle: {
        url: "https://assets.example/bundle.json",
        sha256: "b".repeat(64),
      },
      rpcUrl: "https://control.example/rpc",
      indexerOrigin: "https://control.example",
      directProviderBases: {
        direct_openrouter: "https://openrouter.ai/api/v1",
      },
      preparationCommitment: "finalized",
      models: [
        {
          id: "openai/gpt-4o-mini",
          provider: "openrouter",
          apis: ["chat"],
          tariff,
        },
      ],
      modelCapabilities: {
        "openai/gpt-4o-mini": { streaming: true, tools: true },
      },
    },
    assets: {
      verifiedManifest: {
        deployment_id: "deployment",
        pool: "pool",
        manifest_hash: "d".repeat(64),
        control_api_origin: "https://control.example",
        caps: { max_session_micro: "1000000" },
      },
    },
  } as unknown as LoadedPublicDeploymentProfile;
  const extra = structuredClone(base);
  Object.assign(extra, { profileSha256: "e".repeat(64) });
  Object.assign(extra.profile, {
    revision: 2,
    models: [
      { ...structuredClone(base.profile.models[0]), id: "openai/gpt-6.1-sol" },
    ],
    modelCapabilities: {
      "openai/gpt-6.1-sol": { streaming: true, tools: false },
    },
  });
  return { base, extra };
}
