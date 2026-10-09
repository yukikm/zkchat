import { afterEach, describe, expect, it, vi } from "vitest";
import { loadConfig, parseConfig } from "../src/lib/zkapi";
const config = () => ({
  schema: 1,
  chain: "solana:devnet",
  label: "Test deployment",
  bundleUrl: "https://assets.example/bundle.json",
  bundleSha256: "a".repeat(64),
  rpcUrl: "https://rpc.example",
  indexerUrl: "https://indexer.example",
  mode: "proxy",
  models: [
    {
      id: "test-model",
      provider: "openai",
      apis: ["chat"],
      tariff: {
        tariff_hash: "b".repeat(64),
        version: "1",
        provider: "openai",
        model: "test-model",
        pricing_basis: "fixed_usage_rates",
        valid_from: "1",
        valid_until: "2",
        operator_fee_micro_usdc: "0",
        rates: [
          {
            unit: "input_tokens",
            nano_usdc_numerator: "1",
            unit_denominator: "1",
          },
        ],
      },
    },
  ],
});
describe("independent operator configuration", () => {
  afterEach(() => { vi.unstubAllGlobals(); vi.unstubAllEnvs(); });
  it("accepts a reviewed shape without mutating it (cryptographic validation happens in SDK)", () => {
    const original = config();
    const parsed = parseConfig(original);
    expect(parsed).toEqual(original);
    expect(parsed).not.toBe(original);
  });
  it.each(["solana:mainnet", "solana:mainnet-beta", "solana:testnet"])(
    "rejects chain %s",
    (chain) => {
      expect(() => parseConfig({ ...config(), chain })).toThrow();
    },
  );
  it.each([
    "http://assets.example/bundle.json",
    "https://user:secret@assets.example/bundle.json",
    "https://assets.example/bundle.json?key=secret",
    "https://assets.example/bundle.json#hash",
    "javascript:alert(1)",
  ])("rejects unsafe asset URL %s", (bundleUrl) => {
    expect(() => parseConfig({ ...config(), bundleUrl })).toThrow();
  });
  it("refuses unspecified trust digest, mixed provider/tariff, and secret fields", () => {
    expect(() => parseConfig({ ...config(), bundleSha256: "" })).toThrow();
    expect(() => parseConfig({ ...config(), apiKey: "secret" })).toThrow();
    const mismatched = config();
    mismatched.models[0].tariff.model = "different-model";
    expect(() => parseConfig(mismatched)).toThrow();
  });
  it("requires explicit direct provider bases and OA verifier; never falls back", () => {
    const c = config();
    c.mode = "direct_oa";
    c.models[0].provider = "oa";
    c.models[0].tariff = {
      ...c.models[0].tariff,
      provider: "oa",
      model: "*",
      pricing_basis: "provider_reported_usd",
    };
    expect(() => parseConfig(c)).toThrow();
    expect(() =>
      parseConfig({
        ...c,
        directProviderBases: { direct_oa: "https://oa.example/v1" },
      }),
    ).toThrow();
    expect(
      parseConfig({
        ...c,
        directProviderBases: { direct_oa: "https://oa.example/v1" },
        oaVerifier: { base: "https://oa.example", stationId: "test" },
      }).mode,
    ).toBe("direct_oa");
  });
  it("loads null config with no credentials and no redirects", async () => {
    const fetcher = vi.fn(async () => new Response("null"));
    vi.stubGlobal("fetch", fetcher);
    expect(await loadConfig()).toBeNull();
    expect(fetcher).toHaveBeenCalledWith(
      "/zkapi-config.json",
      expect.objectContaining({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      }),
    );
  });
  it("rejects duplicate trust keys and oversized configuration", async () => {
    vi.stubGlobal(
      "fetch",
      async () => new Response('{"bundleSha256":"a","bundleSha256":"b"}'),
    );
    await expect(loadConfig()).rejects.toThrow();
    vi.stubGlobal(
      "fetch",
      async () => new Response(" ".repeat(256 * 1024 + 1)),
    );
    await expect(loadConfig()).rejects.toThrow(/256 KiB/);
  });
});


it("fetches configuration under the built release base instead of the hostname root", async () => {
  vi.stubEnv("BASE_URL", "/releases/reviewed-revision/chat/");
  const fetcher = vi.fn(async () => Response.json(null));
  vi.stubGlobal("fetch", fetcher);
  expect(await loadConfig()).toBeNull();
  expect(fetcher.mock.calls[0][0]).toBe("/releases/reviewed-revision/chat/zkapi-config.json");
  vi.unstubAllGlobals(); vi.unstubAllEnvs();
});
