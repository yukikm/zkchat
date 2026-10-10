import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  preflight: vi.fn(),
  options: vi.fn(),
  browser: vi.fn(),
  readiness: vi.fn(),
  catalog: vi.fn(),
  assertAccount: vi.fn(),
  walletListeners: new Set<() => void>(),
}));
vi.mock("../src/lib/deposits", async (original) => ({
  ...(await original<typeof import("../src/lib/deposits")>()),
  openDepositCatalog: sdk.catalog,
}));
vi.mock("../src/lib/readiness", () => ({
  checkServiceReadiness: sdk.readiness,
}));
vi.mock("../src/lib/walletConnector", () => ({
  selectConnectedAccount: sdk.assertAccount,
  discoveredWallets: () => [],
  subscribeWallets: (listener: () => void) => {
    sdk.walletListeners.add(listener);
    return () => sdk.walletListeners.delete(listener);
  },
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
import { createDepositCatalog } from "../src/lib/deposits";
import { memoryCustody } from "./depositStore";
import { PublicProfileError } from "@zkapi/solana-sdk/public-profile";
import {
  connectPublicDeployment,
  PublicOnboardingError,
  invitationTransport,
  retainProfileBinding,
  profileBindingKey,
  connectionCheckError,
  assertRuntimeCustody,
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
beforeEach(async () => {
  vi.clearAllMocks();
  sdk.assertAccount.mockReset();
  sdk.walletListeners.clear();
  const custody = await memoryCustody();
  sdk.catalog.mockImplementation(async () =>
    createDepositCatalog(custody, { deploymentId: "deployment", pool: "pool" }),
  );
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
      message: expect.stringContaining("Could not verify service settings."),
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
  const depositFixture = (initialWallet = "closed") => {
    const { account, wallet } = make();
    const states = new Map<string, any>([
      [
        NOTE_ID,
        {
          noteId: NOTE_ID,
          wallet: initialWallet,
          canRequest: false,
          busy: false,
          session: null,
          walletOperation: null,
          emergencyEscape: null,
          settledBalanceMicroUsdc: "200000",
          authorizationCapMicroUsdc: "1000000",
        },
      ],
    ]);
    const opened: any[] = [];
    sdk.browser.mockImplementation(async (options) => {
      const id = options.noteId;
      if (!states.has(id))
        states.set(id, {
          ...states.get(NOTE_ID),
          noteId: id,
          wallet: "empty",
          settledBalanceMicroUsdc: "0",
        });
      const client = {
        status: vi.fn(async () => structuredClone(states.get(id))),
        subscribe: vi.fn(() => () => {}),
        prepareDeposit: vi.fn(async (amount) => {
          states.set(id, {
            ...states.get(id),
            wallet: "unfunded",
            walletOperation: {
              kind: "deposit",
              phase: "ready",
              signature: null,
            },
            settledBalanceMicroUsdc: amount,
          });
        }),
        advanceWallet: vi.fn(async () => {
          states.set(id, {
            ...states.get(id),
            wallet: "active",
            canRequest: true,
            walletOperation: null,
          });
        }),
        prepareWithdrawal: vi.fn(),
        chat: vi.fn(),
        recover: vi.fn(),
      };
      const raw = { client, dispose: vi.fn(), persistence: "persistent", id };
      opened.push(raw);
      return raw;
    });
    const connect = () => connectZkapi(config, wallet as any, account as any);
    return { connect, states, opened, wallet };
  };
  it.each(["closed", "active"])(
    "adds funds after %s, restores selected deposit, and retains original balance/history",
    async (state) => {
      const f = depositFixture(state);
      const handle = await f.connect();
      const original = structuredClone(f.states.get(NOTE_ID));
      await handle.addDeposit();
      const id = handle.selectedDepositId;
      expect(id).not.toBe(NOTE_ID);
      expect(handle.deposits.map((d) => d.id)).toEqual([NOTE_ID, id]);
      expect(f.states.get(NOTE_ID)).toEqual(original);
      expect(f.opened[0].client.prepareDeposit).not.toHaveBeenCalled();
      expect((await handle.client.status()).wallet).toBe("empty");
      await handle.client.prepareDeposit("2000000");
      await expect(handle.selectDeposit(NOTE_ID)).rejects.toThrow(/Finish/);
      handle.dispose();
      const reopened = await f.connect();
      expect(reopened.selectedDepositId).toBe(id);
      expect((await reopened.client.status()).walletOperation?.kind).toBe(
        "deposit",
      );
      await reopened.client.advanceWallet();
      expect((await reopened.client.status()).canRequest).toBe(true);
      await reopened.selectDeposit(NOTE_ID);
      expect(f.states.get(NOTE_ID)).toEqual(original);
      await reopened.client.prepareWithdrawal("account");
      expect(f.opened.at(-1).id).toBe(NOTE_ID);
      expect(f.opened.at(-1).client.prepareWithdrawal).toHaveBeenCalledWith(
        "account",
      );
      await reopened.selectDeposit(id);
      expect((await reopened.client.status()).settledBalanceMicroUsdc).toBe(
        "2000000",
      );
      reopened.dispose();
    },
  );
  it.each([
    { session: { phase: "settlement_pending" } },
    { walletOperation: { kind: "deposit", phase: "failed", signature: null } },
    { walletOperation: { kind: "mutual_close", signature: "submitted" } },
    { wallet: "pending_escape" },
    { busy: true },
  ])("cannot add a deposit around unresolved operations: %o", async (patch) => {
    const f = depositFixture("active");
    const h = await f.connect();
    f.states.set(NOTE_ID, { ...f.states.get(NOTE_ID), ...patch });
    await expect(h.addDeposit()).rejects.toThrow(/Finish/);
    expect(h.deposits).toHaveLength(1);
    expect(f.opened).toHaveLength(1);
    h.dispose();
  });
  it("blocks a stale tab from sending or depositing after another tab changes selection", async () => {
    const f = depositFixture("active");
    const first = await f.connect(),
      second = await f.connect();
    await first.addDeposit();
    await expect(second.client.prepareDeposit("2000000")).rejects.toThrow(
      /another operation or tab/,
    );
    await expect(second.client.chat({} as any)).rejects.toThrow(
      /another operation or tab/,
    );
    await expect(second.addDeposit()).rejects.toThrow(
      /another operation or tab/,
    );
    expect(f.opened[1].client.prepareDeposit).not.toHaveBeenCalled();
    expect(f.opened[1].client.chat).not.toHaveBeenCalled();
    expect((await second.client.status()).canRequest).toBe(false);
    first.dispose();
    second.dispose();
  });
  it("keeps the old client and catalog when opening or saving a new deposit fails", async () => {
    const f = depositFixture();
    const h = await f.connect();
    sdk.browser.mockRejectedValueOnce(new Error("offline"));
    await expect(h.addDeposit()).rejects.toThrow("offline");
    const catalog = await sdk.catalog.mock.results[0].value;
    vi.spyOn(catalog, "save").mockRejectedValueOnce(new Error("storage full"));
    await expect(h.addDeposit()).rejects.toThrow("storage full");
    expect(h.selectedDepositId).toBe(NOTE_ID);
    expect((await catalog.read()).deposits).toHaveLength(1);
    expect(f.opened[0].dispose).not.toHaveBeenCalled();
    expect(f.opened.at(-1).dispose).toHaveBeenCalled();
    h.dispose();
  });
  it("rechecks admission for new deposits, but permits returning to previous funds while admission is down", async () => {
    const f = depositFixture("active");
    const h = await f.connect();
    await h.addDeposit();
    sdk.readiness.mockResolvedValue({
      admission: "suspended",
      servicesAvailable: true,
      expiresAt: Date.now() + 5000,
    });
    await h.selectDeposit(NOTE_ID);
    await expect(h.addDeposit()).rejects.toThrow(
      /New deposits are unavailable/,
    );
    expect(h.selectedDepositId).toBe(NOTE_ID);
    expect(h.deposits).toHaveLength(2);
    h.dispose();
  });
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
        "Could not verify finalized chain snapshot. Try Check service later. Adding funds will not fix this. No request or transaction was sent.",
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
  it("rejects an active-account switch during profile loading even if the original account remains authorized", async () => {
    const { account, wallet } = make();
    sdk.preflight.mockImplementationOnce(async () => {
      sdk.assertAccount.mockImplementation(() => {
        throw new Error("active account changed");
      });
      return { chainAllowsNewOperations: true };
    });
    await expect(
      connectZkapi(config, wallet as any, account as any),
    ).rejects.toThrow("active account changed");
    expect(wallet.accounts).toContain(account);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
  it.each(["profile", "client"])(
    "does not offer new storage for a stale account after %s setup fails",
    async (stage) => {
      const { account, wallet } = make();
      const switchAccount = () => {
        sdk.assertAccount.mockImplementation(() => {
          throw new Error("active account changed");
        });
      };
      if (stage === "profile") {
        storage.delete(profileBindingKey(STORAGE_NAME, account.address));
        sdk.preflight.mockImplementationOnce(async () => {
          switchAccount();
          return { chainAllowsNewOperations: true };
        });
      } else {
        sdk.browser.mockImplementationOnce(async () => {
          switchAccount();
          throw new BrowserStorageMissing();
        });
      }
      await expect(
        connectZkapi(config, wallet as any, account as any),
      ).rejects.toThrow("active account changed");
    },
  );
  it("invalidates an initialized SDK when the connector switches active accounts", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(config, wallet as any, account as any);
    sdk.assertAccount.mockImplementation(() => {
      throw new Error("active account changed");
    });
    for (const listener of sdk.walletListeners) listener();

    expect(wallet.accounts).toContain(account);
    expect(handle.invalidated).toBe(true);
    expect((await handle.client.status()).canRequest).toBe(false);
    await expect(handle.client.prepareDeposit("2000000")).rejects.toThrow(
      /changed or disconnected/,
    );
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    handle.dispose();
    expect(sdk.walletListeners.size).toBe(0);
  });
});

it("SDK .8 profile binding uses fresh custody without adopting the retained R2 binding", async () => {
  const oldKey = profileBindingKey("zkchat-v1", "account");
  storage.set(oldKey, "b".repeat(64));
  expect(STORAGE_NAME).toBe("zkchat-sdk-0.2.0-devnet.8");
  expect(NOTE_ID).toBe("zkchat-note-sdk-0.2.0-devnet.8");
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

describe("original custody is never opened or bypassed by SDK .8", () => {
  it("blocks an original profile binding before loading a profile or opening a client", async () => {
    const account = {
      address: "account",
      chains: ["solana:devnet"],
      features: ["solana:signTransaction"],
    };
    const wallet = { accounts: [account] };
    const original = profileBindingKey(
      "zkchat-sdk-0.2.0-devnet.3",
      account.address,
    );
    storage.set(original, "original-profile-digest");
    await expect(
      connectZkapi(config, wallet as any, account as any, true),
    ).rejects.toThrow(/Recover an older deposit/);
    expect(sdk.load).not.toHaveBeenCalled();
    expect(sdk.browser).not.toHaveBeenCalled();
    expect(storage.size).toBe(1);
    expect(storage.get(original)).toBe("original-profile-digest");
  });
  it("blocks original unbound databases without opening or rewriting them", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", {
      open,
      databases: async () => [
        {
          name: JSON.stringify([
            "zkchat-sdk-0.2.0-devnet.3",
            "deployment",
            "pool",
            "account",
          ]),
        },
      ],
    });
    await expect(assertRuntimeCustody("account")).rejects.toThrow(
      /Recover an older deposit/,
    );
    expect(open).not.toHaveBeenCalled();
    expect(storage.size).toBe(0);
  });
  it("allows a new account without changing another account's binding", async () => {
    storage.set(
      profileBindingKey("zkchat-sdk-0.2.0-devnet.3", "old-account"),
      "original",
    );
    await expect(assertRuntimeCustody("new-account")).resolves.toBeUndefined();
    expect(storage.size).toBe(1);
  });
});

it("RPC failures do not invent an origin-registration requirement or expose payloads", () => {
  const failure = new PublicProfileError("rpc");
  failure.message = "private backend credential";
  const message = connectionCheckError(failure).message;
  expect(message).toContain("Check your internet connection");
  expect(message).not.toMatch(/CORS|register|origin registration/);
  expect(message).not.toContain("private backend");
});
