import type { ModelConfiguration } from "@zkapi/solana-sdk";
import type { LoadedPublicDeploymentProfile } from "@zkapi/solana-sdk/public-profile";
import { jcsBytes } from "@zkapi/solana-sdk/trust";

export interface PublicModelSelection {
  models: readonly ModelConfiguration[];
  modelCapabilities: LoadedPublicDeploymentProfile["profile"]["modelCapabilities"];
}

function same(left: unknown, right: unknown): boolean {
  return (
    new TextDecoder().decode(jcsBytes(left)) ===
    new TextDecoder().decode(jcsBytes(right))
  );
}
function requireMatch(value: boolean): void {
  if (!value)
    throw new Error(
      "Model profile does not match the existing payment deployment.",
    );
}

/** Both inputs must first pass the SDK public-profile loader with independent
 * pins. This returns selection only; it never edits either authenticated profile
 * or replaces the original custody/profile binding or financial deployment. */
export function expandedModelSelection(
  original: LoadedPublicDeploymentProfile,
  additional: LoadedPublicDeploymentProfile,
): PublicModelSelection {
  const base = original.profile,
    extra = additional.profile;
  requireMatch(
    base.schema === 1 &&
      extra.schema === 1 &&
      base.mode === "direct_openrouter" &&
      base.models.length === 1 &&
      extra.revision > base.revision,
  );
  const identity = ({
    revision: _revision,
    models: _models,
    modelCapabilities: _capabilities,
    ...rest
  }: typeof base) => rest;
  // Includes SDK compatibility, bundle digest, origins and every future field.
  requireMatch(same(identity(base), identity(extra)));
  requireMatch(
    same(original.assets.verifiedManifest, additional.assets.verifiedManifest),
  );
  const template = base.models[0];
  requireMatch(
    template.provider === "openrouter" &&
      template.tariff.model === "*" &&
      template.tariff.pricing_basis === "provider_reported_usd",
  );
  const models = new Map(
    base.models.map((model) => [model.id, structuredClone(model)]),
  );
  const capabilities = structuredClone(base.modelCapabilities) as Record<
    string,
    { streaming: boolean; tools: boolean }
  >;
  for (const model of extra.models) {
    requireMatch(
      model.provider === "openrouter" &&
        same(model.apis, ["chat"]) &&
        same(model.tariff, template.tariff),
    );
    const capability = extra.modelCapabilities[model.id];
    requireMatch(!!capability);
    const existing = models.get(model.id);
    if (existing) {
      requireMatch(
        same(existing, model) && same(capabilities[model.id], capability),
      );
    } else {
      models.set(model.id, structuredClone(model));
      capabilities[model.id] = structuredClone(capability);
    }
  }
  requireMatch(models.size > base.models.length && models.size <= 32);
  return {
    models: [...models.values()].map((model) => ({
      ...model,
      capabilities: structuredClone(capabilities[model.id]),
    })),
    modelCapabilities: capabilities,
  };
}
