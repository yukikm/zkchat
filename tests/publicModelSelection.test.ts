import { describe, expect, it } from "vitest";
import { expandedModelSelection } from "../src/lib/publicModelSelection";
import { modelProfiles } from "./modelProfileFixtures";

describe("independently authenticated same-deployment model selection", () => {
  it("retains original model/capabilities and neither authenticated profile is mutated", () => {
    const { base, extra } = modelProfiles();
    const original = structuredClone({ base, extra });
    const selection = expandedModelSelection(base, extra);
    expect(selection.models.map((m) => m.id)).toEqual([
      "openai/gpt-4o-mini",
      "openai/gpt-6.1-sol",
    ]);
    expect(selection.models[1].capabilities).toEqual({
      streaming: true,
      tools: false,
    });
    expect(selection.modelCapabilities["openai/gpt-4o-mini"]).toEqual({
      streaming: true,
      tools: true,
    });
    expect({ base, extra }).toEqual(original);
  });

  it.each([
    [
      "Pool",
      (v: any) => {
        v.assets.verifiedManifest.pool = "other";
      },
    ],
    [
      "manifest cap",
      (v: any) => {
        v.assets.verifiedManifest.caps.max_session_micro = "2000000";
      },
    ],
    [
      "bundle",
      (v: any) => {
        v.profile.bundle.sha256 = "f".repeat(64);
      },
    ],
    [
      "provider origin",
      (v: any) => {
        v.profile.directProviderBases.direct_openrouter =
          "https://other.example";
      },
    ],
    [
      "provider",
      (v: any) => {
        v.profile.models[0].provider = "openai";
      },
    ],
    [
      "tariff",
      (v: any) => {
        v.profile.models[0].tariff.operator_fee_micro_usdc = "1";
      },
    ],
    [
      "SDK compatibility",
      (v: any) => {
        v.profile.sdkVersions = ["0.2.0-devnet.16"];
      },
    ],
    [
      "RPC",
      (v: any) => {
        v.profile.rpcUrl = "https://other.example/rpc";
      },
    ],
    [
      "revision",
      (v: any) => {
        v.profile.revision = 1;
      },
    ],
    [
      "mode",
      (v: any) => {
        v.profile.mode = "proxy";
      },
    ],
    [
      "API",
      (v: any) => {
        v.profile.models[0].apis = ["responses"];
      },
    ],
    [
      "future field",
      (v: any) => {
        v.profile.newTrustInput = "changed";
      },
    ],
  ])("rejects changed %s", (_label, alter) => {
    const { base, extra } = modelProfiles();
    alter(extra);
    expect(() => expandedModelSelection(base, extra)).toThrow(/does not match/);
  });

  it("rejects changed original capability and count overflow without truncating", () => {
    const { base, extra } = modelProfiles();
    Object.assign(extra.profile, {
      models: [...base.profile.models, ...extra.profile.models],
      modelCapabilities: {
        ...base.profile.modelCapabilities,
        ...extra.profile.modelCapabilities,
        "openai/gpt-4o-mini": { streaming: false, tools: true },
      },
    });
    expect(() => expandedModelSelection(base, extra)).toThrow(/does not match/);
    const overflow = modelProfiles();
    const models = Array.from({ length: 32 }, (_, i) => ({
      ...structuredClone(overflow.extra.profile.models[0]),
      id: `openai/model-${i}`,
    }));
    Object.assign(overflow.extra.profile, {
      models,
      modelCapabilities: Object.fromEntries(
        models.map((m) => [m.id, { streaming: true, tools: true }]),
      ),
    });
    expect(() => expandedModelSelection(overflow.base, overflow.extra)).toThrow(
      /does not match/,
    );
  });
});
