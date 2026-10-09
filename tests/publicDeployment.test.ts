import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  preflight: vi.fn(),
  options: vi.fn(),
  browser: vi.fn(),
  readiness: vi.fn(),
}));
vi.mock("../src/lib/readiness", () => ({
  checkServiceReadiness: sdk.readiness,
}));
vi.mock("../src/lib/walletConnector", () => ({
  selectConnectedAccount: vi.fn(),
  discoveredWallets: () => [],
  subscribeWallets: () => () => {},
  connectSelectedWallet: vi.fn(),
}));
vi.mock("@zkapi/solana-sdk/public-profile", async (original) => ({
  ...(await original<typeof import("@zkapi/solana-sdk/public-profile")>()),
  loadPublicDeploymentProfile: sdk.load,
  preflightPublicDeployment: sdk.preflight,
  publicProfileClientOptions: sdk.options,
}));
vi.mock("@zkapi/solana-sdk/browser", async (original) => ({
  ...(await original<typeof import("@zkapi/solana-sdk/browser")>()),
  createBrowserClient: sdk.browser,
  walletStandardAdapter: (wallet: any, account: any) => {
    if (!wallet.accounts.includes(account)) throw new Error("account changed");
    return { publicKey: account.address };
  },
}));
import { BrowserStorageMissing } from "@zkapi/solana-sdk/browser";
import { PublicProfileError } from "@zkapi/solana-sdk/public-profile";
import {
  connectPublicDeployment,
  PublicOnboardingError,
  invitationTransport,
  retainProfileBinding,
  profileBindingKey,
  connectionCheckError,
  type PublicAppConfig,
} from "../src/lib/publicDeployment";
import {
  connectZkapi,
  STORAGE_NAME,
  NOTE_ID,
  parseConfig,
  loadConfig,
  configuredModels,
  configuredStreaming,
} from "../src/lib/zkapi";
const config: PublicAppConfig = {
  schema: 2,
  chain: "solana:devnet",
  label: "Fixture",
  profileUrl: "https://assets.example/profile.json",
  profileSha256: "a".repeat(64),
};
const token = "A".repeat(43),
  origin = "https://control.example";
let storage: Map<string, string>;
const loaded = () => ({
  profile: {
    mode: "direct_openrouter",
    models: [{ id: "model", provider: "openrouter", apis: ["chat"] }],
    modelCapabilities: { model: { streaming: false, tools: false } },
  },
  assets: {
    trust: { expected: { deployment_environment: "devnet" } },
    verifiedManifest: {
      deployment_environment: "devnet",
      environment: "devnet",
      control_api_origin: origin,
      deployment_id: "deployment",
      pool: "pool",
      mint: "mint",
    },
    proverWasm: {
      jsUrl: "https://assets.example/prover.js",
      wasmUrl: "https://assets.example/prover.wasm",
      wasmSha256: "b".repeat(64),
    },
  },
});
beforeEach(() => {
  vi.clearAllMocks();
  storage = new Map();
  vi.stubGlobal("localStorage", {
    getItem: (k: string) => storage.get(k) ?? null,
    setItem: (k: string, v: string) => storage.set(k, v),
  });
  vi.stubGlobal("navigator", {
    locks: {
      request: async (_key: string, _options: unknown, fn: () => unknown) =>
        fn(),
    },
  });
  vi.stubGlobal("indexedDB", { databases: async () => [] });
  vi.stubGlobal("window", { isSecureContext: true });
  vi.stubGlobal("isSecureContext", true);
  vi.stubGlobal("Worker", class {});
  sdk.load.mockResolvedValue(loaded());
  sdk.preflight.mockResolvedValue({
    chainAllowsNewOperations: true,
    paused: false,
  });
  sdk.options.mockReturnValue({
    deployment: {},
    mode: "direct_openrouter",
    models: [],
  });
  sdk.readiness.mockResolvedValue({
    admission: "enabled",
    invitationRequired: false,
    recovery: "enabled",
    servicesAvailable: true,
    expiresAt: Date.now() + 5000,
    checkedAt: Date.now(),
  });
});
afterEach(() => vi.unstubAllGlobals());
describe("in-memory invitation transport", () => {
  it("sends only exact authenticated session POST and strips caller spoofing elsewhere", async () => {
    const fetcher = vi.fn(async () => new Response(null));
    const transport = invitationTransport(token, fetcher);
    await transport.fetch(origin + "/zkapi/v1/sessions", {
      method: "POST",
      headers: { "X-Zkapi-Admission": "spoof" },
    });
    expect(
      new Headers(fetcher.mock.calls.at(-1)![1]?.headers).has(
        "x-zkapi-admission",
      ),
    ).toBe(false);
    transport.setAuthenticatedOrigin(origin);
    for (const [url, method] of [
      [origin + "/zkapi/v1/config", "POST"],
      [origin + "/zkapi/v1/sessions?x=1", "POST"],
      [origin + "/zkapi/v1/sessions/", "POST"],
      ["https://other.example/zkapi/v1/sessions", "POST"],
      [origin + "/zkapi/v1/sessions", "GET"],
    ]) {
      await transport.fetch(url, {
        method,
        headers: { "x-zkapi-admission": "spoof" },
      });
      expect(
        new Headers(fetcher.mock.calls.at(-1)![1]?.headers).has(
          "x-zkapi-admission",
        ),
      ).toBe(false);
    }
    const controller = new AbortController();
    const request = new Request(origin + "/zkapi/v1/sessions", {
      method: "POST",
      body: "exact AUTH",
      signal: controller.signal,
      headers: {
        "content-type": "application/json",
        "x-zkapi-admission": "spoof",
      },
    });
    await transport.fetch(request);
    const [input, init] = fetcher.mock.calls.at(-1)!;
    expect(input).toBe(request);
    expect(await request.text()).toBe("exact AUTH");
    expect(new Headers(init.headers).get("x-zkapi-admission")).toBe(token);
    expect(new Headers(init.headers).get("content-type")).toBe(
      "application/json",
    );
    expect(init).toMatchObject({
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    transport.clear();
    await transport.fetch(origin + "/zkapi/v1/sessions", { method: "POST" });
    expect(
      new Headers(fetcher.mock.calls.at(-1)![1]?.headers).has(
        "x-zkapi-admission",
      ),
    ).toBe(false);
    expect(storage.size).toBe(0);
  });
  it("rejects noncanonical invitation and origin without exposing their values", () => {
    for (const input of [
      token + "=",
      token + "\n",
      "A".repeat(42) + "B",
      "secret",
    ])
      expect(() => invitationTransport(input)).toThrow(
        /^Invalid invitation format\.$/,
      );
    for (const input of [
      "http://control.example",
      origin + "/",
      origin + "?key=private",
      "https://private@control.example",
    ])
      expect(() =>
        invitationTransport(token).setAuthenticatedOrigin(input),
      ).toThrow();
  });
  it("does not replay an aborted or failed AUTH", async () => {
    const fetcher = vi.fn(async () => {
      throw new DOMException("Aborted", "AbortError");
    });
    const transport = invitationTransport(token, fetcher);
    transport.setAuthenticatedOrigin(origin);
    await expect(
      transport.fetch(origin + "/zkapi/v1/sessions", {
        method: "POST",
        signal: AbortSignal.abort(),
      }),
    ).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
describe("profile and original custody binding", () => {
  it("requires explicit initialization and refuses existing unbound custody even with initialize", async () => {
    await expect(
      retainProfileBinding(
        config,
        "zkchat-v1",
        "account",
        false,
        async () => false,
      ),
    ).rejects.toBeInstanceOf(BrowserStorageMissing);
    await expect(
      retainProfileBinding(
        config,
        "zkchat-v1",
        "account",
        true,
        async () => true,
      ),
    ).rejects.toThrow(/original schema 1/);
    expect(storage.size).toBe(0);
    await retainProfileBinding(
      config,
      "zkchat-v1",
      "account",
      true,
      async () => false,
    );
    expect(storage.get(profileBindingKey("zkchat-v1", "account"))).toBe(
      config.profileSha256,
    );
    await expect(
      retainProfileBinding(
        { ...config, profileSha256: "b".repeat(64) },
        "zkchat-v1",
        "account",
        true,
      ),
    ).rejects.toThrow(/Profile changed/);
  });
  it("inspects other deployment journals before binding", async () => {
    vi.stubGlobal("indexedDB", {
      databases: async () => [
        {
          name: JSON.stringify([
            "zkchat-v1",
            "old-deployment",
            "old-pool",
            "account",
          ]),
        },
      ],
    });
    await expect(
      retainProfileBinding(config, "zkchat-v1", "account", true),
    ).rejects.toThrow(/original schema 1/);
    expect(storage.size).toBe(0);
  });
  it("passes independently installed hash to SDK and derives UI data only after validation", async () => {
    expect(parseConfig(config)).toEqual(config);
    for (const bad of [
      { ...config, models: [] },
      { ...config, rpcUrl: "https://rpc.example" },
      { ...config, profileSha256: "BAD" },
      { ...config, profileUrl: "http://localhost/profile.json" },
      { ...config, invitation: token },
    ])
      expect(() => parseConfig(bad)).toThrow();
    vi.stubGlobal(
      "fetch",
      vi.fn(async () => Response.json(config)),
    );
    await loadConfig();
    expect(sdk.load).toHaveBeenCalledWith(config.profileUrl, {
      profileSha256: config.profileSha256,
    });
    expect(configuredModels(config).map((m) => m.id)).toEqual(["model"]);
    expect(configuredStreaming(config, "model")).toBe(false);
    sdk.load.mockRejectedValueOnce(new PublicProfileError("profile"));
    await expect(
      connectPublicDeployment(config, "zkchat-v1", "account", true, token),
    ).rejects.toMatchObject({
      message: expect.stringContaining(
        "Connection checks are unavailable: deployment profile.",
      ),
    });
    expect(storage.size).toBe(0);
  });
  it("allows original-bound recovery on preflight failure, blocks new work, and refreshes", async () => {
    storage.set(
      profileBindingKey("zkchat-v1", "account"),
      config.profileSha256,
    );
    sdk.preflight.mockRejectedValueOnce(new PublicProfileError("catalog"));
    const connection = await connectPublicDeployment(
      config,
      "zkchat-v1",
      "account",
      false,
      token,
    );
    expect(connection.canAdmit).toBe(false);
    expect(connection.diagnostic.unavailableComponent).toBe("catalog");
    expect(sdk.load.mock.calls[0][1].installedProfileSha256).toBe(
      config.profileSha256,
    );
    await connection.refreshPreflight();
    expect(connection.canAdmit).toBe(true);
    connection.clear();
    expect(connection.canAdmit).toBe(false);
  });
  it("rechecks a binding changed during async preflight before opening custody", async () => {
    sdk.preflight.mockImplementationOnce(async () => {
      storage.set(profileBindingKey("zkchat-v1", "account"), "b".repeat(64));
      return { chainAllowsNewOperations: true };
    });
    await expect(
      connectPublicDeployment(config, "zkchat-v1", "account", true, token),
    ).rejects.toThrow(/Profile changed/);
    expect(sdk.browser).not.toHaveBeenCalled();
    expect(storage.get(profileBindingKey("zkchat-v1", "account"))).toBe(
      "b".repeat(64),
    );
  });
  it("preflight failure before new initialization creates no binding or custody", async () => {
    sdk.preflight.mockRejectedValueOnce(new PublicProfileError("pool"));
    await expect(
      connectPublicDeployment(config, "zkchat-v1", "account", true, token),
    ).rejects.toThrow();
    expect(storage.size).toBe(0);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
});
describe("existing application adapter with public profile", () => {
  const make = () => {
    const account = {
      address: "account",
      chains: ["solana:devnet"],
      features: ["solana:signTransaction"],
    };
    const wallet = {
      accounts: [account],
      chains: ["solana:devnet"],
      features: {
        "solana:signTransaction": {
          supportedTransactionVersions: [0],
          signTransaction: vi.fn(),
        },
      },
    };
    const client = {
      status: vi.fn(async () => ({ canRequest: true })),
      chat: vi.fn(async () => new Response()),
      request: vi.fn(),
      prepareDeposit: vi.fn(),
      prepareWithdrawal: vi.fn(),
      recover: vi.fn(),
      subscribe: vi.fn(() => () => {}),
    };
    sdk.browser.mockResolvedValue({
      client,
      dispose: vi.fn(),
      persistence: "persistent",
    });
    storage.set(
      profileBindingKey(STORAGE_NAME, "account"),
      config.profileSha256,
    );
    return { account, wallet, client };
  };
  it.each([false, true])(
    "reports unavailable snapshot before custody or financial admission (initialize=%s)",
    async (initialize) => {
      const { account, wallet, client } = make();
      storage.clear();
      const fetcher = vi.fn(async () => {
        throw new Error("unexpected network request");
      });
      vi.stubGlobal("fetch", fetcher);
      const failure = new PublicProfileError("snapshot");
      failure.message =
        "private backend https://private.invalid/?key=secret USDC";
      sdk.preflight.mockRejectedValueOnce(failure);
      const error = await connectZkapi(
        config,
        wallet as any,
        account as any,
        initialize,
        token,
      ).catch((error: unknown) => error);
      expect(error).toBeInstanceOf(PublicOnboardingError);
      expect((error as Error).message).toBe(
        "Connection checks are unavailable: finalized chain snapshot. No AUTH, inference, or transaction was submitted. The finalized chain snapshot could not be verified. Retry the connection check when the indexer is available; adding funds will not resolve this check.",
      );
      expect((error as Error).message).not.toMatch(
        /private|secret|balance|pending|https:/,
      );
      expect(storage.size).toBe(0);
      expect(sdk.load).toHaveBeenCalledTimes(1);
      expect(sdk.preflight).toHaveBeenCalledTimes(1);
      expect(sdk.options).not.toHaveBeenCalled();
      expect(sdk.browser).not.toHaveBeenCalled();
      expect(
        wallet.features["solana:signTransaction"].signTransaction,
      ).not.toHaveBeenCalled();
      expect(client.prepareDeposit).not.toHaveBeenCalled();
      expect(client.request).not.toHaveBeenCalled();
      expect(client.chat).not.toHaveBeenCalled();
      expect(fetcher).not.toHaveBeenCalled();
    },
  );
  it("does not trust a lookalike component field on an unrelated error", async () => {
    const { account, wallet } = make();
    storage.clear();
    const error = Object.assign(new Error("opaque failure"), {
      component: "snapshot",
    });
    sdk.preflight.mockRejectedValueOnce(error);
    await expect(
      connectZkapi(config, wallet as any, account as any, true, token),
    ).rejects.toBe(error);
    expect(storage.size).toBe(0);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
  it("blocks new funding/chat after fresh readiness failure but retains recovery/withdrawal", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
      token,
    );
    sdk.preflight.mockRejectedValue(new PublicProfileError("catalog"));
    await expect(handle.client.prepareDeposit(2000000n)).rejects.toThrow(
      /Recovery remains/,
    );
    await expect(
      handle.client.chat({
        model: "model",
        stream: false,
        maxOutputTokens: 128,
      } as any),
    ).rejects.toThrow(/Recovery remains/);
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    expect(client.chat).not.toHaveBeenCalled();
    await handle.client.recover();
    await handle.client.prepareWithdrawal();
    expect(client.recover).toHaveBeenCalledTimes(1);
    expect(client.prepareWithdrawal).toHaveBeenCalledTimes(1);
    expect((await handle.client.status()).canRequest).toBe(false);
    handle.dispose();
  });
  it("rejects unsupported streaming/output cap before underlying SDK chat", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
      token,
    );
    await expect(
      handle.client.chat({
        model: "model",
        stream: true,
        maxOutputTokens: 128,
      } as any),
    ).rejects.toThrow(/capability/);
    await expect(
      handle.client.chat({
        model: "model",
        stream: false,
        maxOutputTokens: 129,
      } as any),
    ).rejects.toThrow(/128/);
    expect(client.chat).not.toHaveBeenCalled();
    await handle.client.chat({
      model: "model",
      stream: false,
      maxOutputTokens: 128,
    } as any);
    expect(client.chat).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
  it("permits recovery without an invitation but rejects new funding when required", async () => {
    sdk.readiness.mockResolvedValue({
      admission: "enabled",
      invitationRequired: true,
      servicesAvailable: true,
      expiresAt: Date.now() + 5000,
    });
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
    );
    await expect(handle.client.prepareDeposit(2000000n)).rejects.toThrow(
      /invitation/,
    );
    await handle.client.recover();
    expect(client.recover).toHaveBeenCalledTimes(1);
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    handle.dispose();
  });
  it("allows a public deposit and chat without an invitation, but honors admission suspension", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
    );
    await handle.client.prepareDeposit("2000000");
    await handle.client.chat({ model: "model", maxOutputTokens: 128 } as any);
    expect(client.prepareDeposit).toHaveBeenCalledTimes(1);
    expect(client.chat).toHaveBeenCalledTimes(1);
    sdk.readiness.mockResolvedValue({
      admission: "suspended",
      invitationRequired: false,
      servicesAvailable: true,
      expiresAt: Date.now() + 5000,
    });
    await expect(
      handle.client.chat({ model: "model", maxOutputTokens: 128 } as any),
    ).rejects.toThrow(/New work/);
    expect(client.chat).toHaveBeenCalledTimes(1);
    await handle.client.recover();
    expect(client.recover).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
  it("blocks funding on expired or failed readiness without losing original-profile recovery", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
    );
    sdk.readiness.mockResolvedValue({
      admission: "enabled",
      invitationRequired: false,
      servicesAvailable: true,
      expiresAt: 0,
    });
    await expect(handle.client.prepareDeposit("2000000")).rejects.toThrow(
      /New work/,
    );
    sdk.readiness.mockRejectedValue(new Error("unavailable"));
    await expect(handle.client.prepareDeposit("2000000")).rejects.toThrow(
      /New work/,
    );
    expect(handle.diagnostic?.unavailableComponent).toBe("readiness");
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    await handle.client.prepareWithdrawal();
    expect(client.prepareWithdrawal).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
  it("does not begin a billable request cancelled during read-only preflight", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
    );
    const controller = new AbortController();
    sdk.preflight.mockImplementationOnce(async () => {
      controller.abort();
      return { chainAllowsNewOperations: true };
    });
    await expect(
      handle.client.chat({
        model: "model",
        maxOutputTokens: 128,
        signal: controller.signal,
      } as any),
    ).rejects.toThrow();
    expect(client.chat).not.toHaveBeenCalled();
    handle.dispose();
  });
  it("rechecks selected account after asynchronous profile loading before client creation", async () => {
    const { account, wallet } = make();
    sdk.preflight.mockImplementationOnce(async () => {
      wallet.accounts = [];
      return { chainAllowsNewOperations: true };
    });
    await expect(
      connectZkapi(config, wallet as any, account as any, false, token),
    ).rejects.toThrow(/account changed/);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
});

it("SDK .3 profile binding uses fresh custody without adopting the retained R2 binding", async () => {
  const oldKey = profileBindingKey("zkchat-v1", "account");
  storage.set(oldKey, "b".repeat(64));
  expect(STORAGE_NAME).toBe("zkchat-sdk-0.2.0-devnet.3");
  expect(NOTE_ID).toBe("zkchat-note-sdk-0.2.0-devnet.3");
  const newKey = profileBindingKey(STORAGE_NAME, "account");
  expect(newKey).not.toBe(oldKey);
  const hasNewCustody = vi.fn(async () => false);
  await retainProfileBinding(
    config,
    STORAGE_NAME,
    "account",
    true,
    hasNewCustody,
  );
  expect(hasNewCustody).toHaveBeenCalledTimes(1);
  expect(storage.get(newKey)).toBe(config.profileSha256);
  expect(storage.get(oldKey)).toBe("b".repeat(64));
  expect(storage.size).toBe(2);
});

it("RPC failures do not invent an origin-registration requirement or expose payloads", () => {
  const failure = new PublicProfileError("rpc");
  failure.message = "private backend credential";
  const message = connectionCheckError(failure).message;
  expect(message).toContain("without origin registration");
  expect(message).toContain("does not establish a CORS failure");
  expect(message).not.toContain("private backend");
});
