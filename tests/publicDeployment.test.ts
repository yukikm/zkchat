import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
const sdk = vi.hoisted(() => ({
  load: vi.fn(),
  preflight: vi.fn(),
  options: vi.fn(),
  browser: vi.fn(),
  readiness: vi.fn(),
  catalog: vi.fn(),
  recovery: vi.fn(),
  localRecoveryGuard: vi.fn(),
  assertAccount: vi.fn(),
  walletListeners: new Set<() => void>(),
}));
vi.mock("../src/lib/deposits", async (original) => ({
  ...(await original<typeof import("../src/lib/deposits")>()),
  openDepositCatalog: sdk.catalog,
  createDepositCatalog: sdk.catalog,
}));
vi.mock("../src/lib/currentRecovery", async (original) => ({
  ...(await original<typeof import("../src/lib/currentRecovery")>()),
  getRecoveryStorage: sdk.recovery,
  assertLocalRecoveryNotMoved: sdk.localRecoveryGuard,
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
import { memoryCustody } from "./depositStore";
import { PublicProfileError } from "@zkapi/solana-sdk/public-profile";
import {
  connectPublicDeployment,
  PublicOnboardingError,
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
  const { createDepositCatalog } = await vi.importActual<
    typeof import("../src/lib/deposits")
  >("../src/lib/deposits");
  sdk.catalog.mockImplementation(() =>
    createDepositCatalog(custody, { deploymentId: "deployment", pool: "pool" }),
  );
  sdk.recovery.mockResolvedValue({ ...custody, close: vi.fn() });
  sdk.localRecoveryGuard.mockResolvedValue(undefined);
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
      installedProfileSha256: undefined,
      fetch: expect.any(Function),
    });
    expect(configuredModels(config).map((m) => m.id)).toEqual(["model"]);
    expect(configuredStreaming(config, "model")).toBe(false);
    sdk.load.mockRejectedValueOnce(new PublicProfileError("profile"));
    await expect(
      connectPublicDeployment(config, "zkchat-v1", "account", true),
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
      connectPublicDeployment(config, "zkchat-v1", "account", true),
    ).rejects.toThrow(/Profile changed/);
    expect(sdk.browser).not.toHaveBeenCalled();
    expect(storage.get(profileBindingKey("zkchat-v1", "account"))).toBe(
      "b".repeat(64),
    );
  });
  it("preflight failure before new initialization creates no binding or custody", async () => {
    sdk.preflight.mockRejectedValueOnce(new PublicProfileError("pool"));
    await expect(
      connectPublicDeployment(config, "zkchat-v1", "account", true),
    ).rejects.toThrow();
    expect(storage.size).toBe(0);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
  it("retains a new binding through later preflight failures and permits a service refresh", async () => {
    const connection = await connectPublicDeployment(
      config,
      "zkchat-v1",
      "account",
      true,
    );
    expect(storage.get(profileBindingKey("zkchat-v1", "account"))).toBe(
      config.profileSha256,
    );
    expect(connection.canAdmit).toBe(true);
    sdk.preflight.mockRejectedValueOnce(new PublicProfileError("snapshot"));
    await expect(connection.refreshPreflight()).resolves.toMatchObject({
      preflight: null,
      unavailableComponent: "snapshot",
    });
    expect(connection.canAdmit).toBe(false);
    expect(storage.get(profileBindingKey("zkchat-v1", "account"))).toBe(
      config.profileSha256,
    );
    await connection.refreshPreflight();
    expect(connection.canAdmit).toBe(true);
    connection.clear();
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
      status: vi.fn(async () => ({ noteId: NOTE_ID, canRequest: true })),
      chat: vi.fn(async () => new Response()),
      request: vi.fn(),
      prepareDeposit: vi.fn(),
      prepareWithdrawal: vi.fn(),
      observeWallet: vi.fn(async () => ({ state: "pending" })),
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
        observeWallet: vi.fn(async () => ({ state: "pending" })),
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
  it("uses the same backed-up storage for every selected deposit and closes it with the handle", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const remote = await sdk.recovery.mock.results[0].value;
    expect(handle.recoveryEnabled).toBe(true);
    await handle.addDeposit();
    for (const [options] of sdk.browser.mock.calls)
      expect(options.storage).toBe(remote);
    expect(remote.close).not.toHaveBeenCalled();
    handle.dispose();
    expect(remote.close).toHaveBeenCalledTimes(1);
    expect(handle.invalidated).toBe(true);
  });
  it("requires backup for new funds but keeps existing local chat and withdrawal available", async () => {
    sdk.recovery.mockResolvedValue(null);
    const { account, wallet, client } = make();
    const handle = await connectZkapi(config, wallet as any, account as any);
    expect(handle.recoveryEnabled).toBe(false);
    await expect(handle.client.prepareDeposit("2000000")).rejects.toThrow(
      /recovery file/,
    );
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    await handle.client.chat({
      model: "model",
      stream: false,
      maxOutputTokens: 128,
    } as any);
    await handle.client.prepareWithdrawal("account");
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(client.prepareWithdrawal).toHaveBeenCalledTimes(1);
    expect(sdk.localRecoveryGuard).toHaveBeenCalled();
    handle.dispose();
  });
  it("never falls back to original local custody when opening the saved backup fails", async () => {
    const { account, wallet } = make();
    sdk.recovery.mockRejectedValueOnce(new Error("backup unavailable"));
    await expect(
      connectZkapi(config, wallet as any, account as any),
    ).rejects.toThrow("backup unavailable");
    expect(sdk.browser).not.toHaveBeenCalled();
    expect(sdk.catalog).not.toHaveBeenCalled();
  });
  it("fences an already open local client after backup enrollment begins elsewhere", async () => {
    sdk.recovery.mockResolvedValue(null);
    const { account, wallet, client } = make();
    const handle = await connectZkapi(config, wallet as any, account as any);
    sdk.localRecoveryGuard.mockRejectedValueOnce(
      new Error("local custody moved"),
    );
    await expect(handle.client.prepareWithdrawal("account")).rejects.toThrow(
      "local custody moved",
    );
    expect(client.prepareWithdrawal).not.toHaveBeenCalled();
    handle.dispose();
  });
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
    await expect(
      (second.client as any).observeWallet("saved-signature"),
    ).rejects.toThrow(/another operation or tab/);
    await expect(second.addDeposit()).rejects.toThrow(
      /another operation or tab/,
    );
    expect(f.opened[1].client.prepareDeposit).not.toHaveBeenCalled();
    expect(f.opened[1].client.chat).not.toHaveBeenCalled();
    expect(f.opened[1].client.observeWallet).not.toHaveBeenCalled();
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
  it("rejects a delayed status from a deposit replaced during its journal read", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const previous = structuredClone(f.states.get(NOTE_ID));
    let finish!: (status: typeof previous) => void;
    f.opened[0].client.status.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const delayed = handle.client.status().catch((error) => error);
    await handle.addDeposit();
    finish(previous);
    expect(await delayed).toBeInstanceOf(Error);
    expect((await delayed).message).toMatch(/selected deposit changed/i);
    expect(await handle.client.status()).toMatchObject({
      noteId: handle.selectedDepositId,
      settledBalanceMicroUsdc: "0",
      canRequest: false,
    });
    handle.dispose();
  });
  it("does not deliver a slower notification over a newer deposit balance", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const previous = structuredClone(f.states.get(NOTE_ID));
    let finish!: (status: typeof previous) => void;
    f.opened[0].client.status.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const listener = vi.fn();
    const unsubscribe = handle.client.subscribe(listener);
    f.states.set(NOTE_ID, {
      ...previous,
      settledBalanceMicroUsdc: "150000",
    });
    await handle.refreshPreflight();
    await vi.waitFor(() =>
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({ settledBalanceMicroUsdc: "150000" }),
      ),
    );
    finish(previous);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).toHaveBeenCalledTimes(1);
    unsubscribe();
    handle.dispose();
  });
  it("rereads the selected journal when a delayed SDK event carries older state", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const previous = structuredClone(f.states.get(NOTE_ID));
    const listener = vi.fn();
    handle.client.subscribe(listener);
    await vi.waitFor(() => expect(listener).toHaveBeenCalledTimes(1));
    f.states.set(NOTE_ID, {
      ...previous,
      settledBalanceMicroUsdc: "0",
      wallet: "closed",
    });
    const sdkEvent = f.opened[0].client.subscribe.mock.calls[0][0];
    sdkEvent({ ...previous, canRequest: true });
    await vi.waitFor(() =>
      expect(listener).toHaveBeenLastCalledWith(
        expect.objectContaining({
          wallet: "closed",
          settledBalanceMicroUsdc: "0",
          canRequest: false,
        }),
      ),
    );
    handle.dispose();
  });
  it("discards a pending notification superseded by an explicit status refresh", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const previous = structuredClone(f.states.get(NOTE_ID));
    let finish!: (status: typeof previous) => void;
    f.opened[0].client.status.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const listener = vi.fn();
    handle.client.subscribe(listener);
    f.states.set(NOTE_ID, {
      ...previous,
      settledBalanceMicroUsdc: "0",
      wallet: "closed",
    });
    expect(await handle.client.status()).toMatchObject({
      wallet: "closed",
      settledBalanceMicroUsdc: "0",
    });
    finish(previous);
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(listener).not.toHaveBeenCalled();
    handle.dispose();
  });
  it("does not return a pending status after the handle is disposed", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    let finish!: (status: unknown) => void;
    f.opened[0].client.status.mockImplementationOnce(
      () => new Promise((resolve) => (finish = resolve)),
    );
    const delayed = handle.client.status().catch((error) => error);
    handle.dispose();
    finish(f.states.get(NOTE_ID));
    expect(await delayed).toBeInstanceOf(Error);
  });
  it("serializes transaction observation and rechecks the account before entering the SDK", async () => {
    const f = depositFixture("active");
    const handle = await f.connect();
    const observe = (signature: string) =>
      (handle.client as any).observeWallet(signature);
    await expect(observe("saved-signature")).resolves.toEqual({
      state: "pending",
    });
    expect(f.opened[0].client.observeWallet).toHaveBeenCalledExactlyOnceWith(
      "saved-signature",
    );
    expect(f.opened[0].client.advanceWallet).not.toHaveBeenCalled();
    const catalog = await sdk.catalog.mock.results[0].value;
    let release!: () => void;
    let entered!: () => void;
    const locked = new Promise<void>((resolve) => (entered = resolve));
    const lock = catalog.withLock(async () => {
      entered();
      await new Promise<void>((resolve) => (release = resolve));
    });
    await locked;
    const queued = observe("saved-signature").catch((error: unknown) => error);
    f.wallet.accounts = [];
    release();
    await lock;
    expect((await queued).message).toMatch(/changed or disconnected/);
    expect(f.opened[0].client.observeWallet).toHaveBeenCalledTimes(1);
    handle.dispose();
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
      connectZkapi(config, wallet as any, account as any, true),
    ).rejects.toBe(error);
    expect(storage.size).toBe(0);
    expect(sdk.browser).not.toHaveBeenCalled();
  });
  it.each([false, true])(
    "blocks funding/chat after a later preflight failure and retains recovery (initialize=%s)",
    async (initialize) => {
      const { account, wallet, client } = make();
      if (initialize) storage.clear();
      const handle = await connectZkapi(
        config,
        wallet as any,
        account as any,
        initialize,
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
    },
  );
  it("rejects unsupported streaming/output cap before underlying SDK chat", async () => {
    const { account, wallet, client } = make();
    const handle = await connectZkapi(
      config,
      wallet as any,
      account as any,
      false,
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
        maxOutputTokens: 4097,
      } as any),
    ).rejects.toThrow(/4096/);
    expect(client.chat).not.toHaveBeenCalled();
    await handle.client.chat({
      model: "model",
      stream: false,
      maxOutputTokens: 4096,
    } as any);
    expect(client.chat).toHaveBeenCalledTimes(1);
    expect(client.chat).toHaveBeenCalledWith(
      expect.objectContaining({ maxOutputTokens: 4096 }),
    );
    handle.dispose();
  });
  it("rechecks a transient preflight transport failure before sending chat once", async () => {
    const { account, wallet, client } = make();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const handle = await connectZkapi(config, wallet as any, account as any);
    sdk.preflight.mockClear();
    sdk.preflight.mockImplementationOnce(async (_loaded, options) => {
      await options.fetch("https://control.example/zkapi/v1/tree/snapshot");
      throw new PublicProfileError("snapshot");
    });
    await handle.client.chat({
      model: "model",
      stream: false,
      maxOutputTokens: 128,
    } as any);
    expect(handle.publicAdmissionReady).toBe(true);
    expect(sdk.preflight).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(client.chat).toHaveBeenCalledTimes(1);
    handle.dispose();
  });
  it("reports exhausted snapshot checks without suggesting an invitation or sending", async () => {
    const { account, wallet, client } = make();
    const fetcher = vi.fn(async () => new Response(null, { status: 503 }));
    vi.stubGlobal("fetch", fetcher);
    const handle = await connectZkapi(config, wallet as any, account as any);
    sdk.preflight.mockClear();
    sdk.preflight.mockImplementation(async (_loaded, options) => {
      await options.fetch("https://control.example/zkapi/v1/tree/snapshot");
      throw new PublicProfileError("snapshot");
    });
    const error = await handle.client
      .chat({ model: "model", stream: false, maxOutputTokens: 128 } as any)
      .catch((error) => error);
    expect(error.message).toContain(
      "Could not verify finalized chain snapshot",
    );
    expect(error.message).not.toContain("invitation");
    expect(error.message).toContain("Recovery remains available");
    expect(sdk.preflight).toHaveBeenCalledTimes(2);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(client.chat).not.toHaveBeenCalled();
    handle.dispose();
  });
  it.each([200, 429])(
    "backs off one authenticated RPC read without replaying preflight (retry HTTP %s)",
    async (status) => {
      vi.useFakeTimers();
      try {
        const { account, wallet, client } = make();
        const rpcUrl = "https://control.example/rpc";
        const profile = loaded();
        Object.assign(profile.profile, { rpcUrl });
        sdk.load.mockResolvedValue(profile);
        sdk.readiness.mockImplementation(async () => ({
          admission: "enabled",
          invitationRequired: false,
          recovery: "enabled",
          servicesAvailable: true,
          expiresAt: Date.now() + 5000,
          checkedAt: Date.now(),
        }));
        let started!: () => void;
        const firstRead = new Promise<void>((resolve) => {
          started = resolve;
        });
        const fetcher = vi
          .fn<typeof fetch>()
          .mockImplementationOnce(async () => {
            started();
            return new Response(null, { status: 429 });
          })
          .mockResolvedValueOnce(new Response(null, { status }));
        vi.stubGlobal("fetch", fetcher);
        const handle = await connectZkapi(
          config,
          wallet as any,
          account as any,
        );
        sdk.preflight.mockClear();
        sdk.preflight.mockImplementation(async (_loaded, options) => {
          const response = await options.fetch(rpcUrl, {
            method: "POST",
            body: JSON.stringify({
              jsonrpc: "2.0",
              id: 1,
              method: "getBlock",
              params: [1],
            }),
          });
          if (!response.ok) throw new PublicProfileError("rpc");
          return { chainAllowsNewOperations: true, paused: false };
        });
        const result = handle.client
          .chat({ model: "model", stream: false, maxOutputTokens: 128 } as any)
          .catch((error) => error);
        await Promise.race([
          firstRead,
          result.then((error) => {
            throw error;
          }),
        ]);
        await vi.advanceTimersByTimeAsync(9999);
        expect(fetcher).toHaveBeenCalledTimes(1);
        expect(client.chat).not.toHaveBeenCalled();
        await vi.advanceTimersByTimeAsync(1);
        const outcome = await result;
        expect(fetcher).toHaveBeenCalledTimes(2);
        expect(sdk.preflight).toHaveBeenCalledTimes(1);
        expect(client.chat).toHaveBeenCalledTimes(status === 200 ? 1 : 0);
        if (status === 429)
          expect(outcome.message).toContain("chain connection");
        handle.dispose();
      } finally {
        vi.useRealTimers();
      }
    },
  );
  it.each(["recovered", "unavailable", "stopped"])(
    "handles a transient runtime snapshot within one chat operation: %s",
    async (outcome) => {
      const { account, wallet, client } = make();
      let firstRead!: () => void;
      const snapshotStarted = new Promise<void>((resolve) => {
        firstRead = resolve;
      });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockImplementationOnce(async () => {
          firstRead();
          return new Response(null, { status: 503 });
        })
        .mockResolvedValue(
          new Response(null, {
            status: outcome === "unavailable" ? 503 : 200,
          }),
        );
      sdk.options.mockReturnValue({
        deployment: { indexerOrigin: origin, fetch: fetcher },
        mode: "direct_openrouter",
        models: [],
      });
      const handle = await connectZkapi(config, wallet as any, account as any);
      const runtimeFetch: typeof fetch =
        sdk.browser.mock.calls[0][0].deployment.fetch;
      const infer = vi.fn(() => new Response("reply"));
      // Exercise the actual app-to-SDK fetch wiring, including the fact that
      // SDK snapshot reads have a deadline distinct from the caller's signal.
      client.chat.mockImplementation(async () => {
        const response = await runtimeFetch(
          origin + "/zkapi/v1/tree/snapshot",
          {
            credentials: "omit",
            redirect: "error",
            cache: "no-store",
            signal: new AbortController().signal,
          },
        );
        if (!response.ok) throw new Error("finalized indexer unavailable");
        return infer();
      });
      const controller = new AbortController();
      const request = {
        operationId: "11111111-1111-4111-8111-111111111111",
        model: "model",
        maxOutputTokens: 128,
        signal: controller.signal,
      };
      vi.useFakeTimers();
      try {
        const result = handle.client
          .chat(request as any)
          .catch((error) => error);
        await snapshotStarted;
        if (outcome === "stopped") controller.abort();
        await vi.advanceTimersByTimeAsync(2_500);
        const response = await result;
        expect(client.chat).toHaveBeenCalledExactlyOnceWith(request);
        if (outcome === "recovered") {
          expect(response).toBeInstanceOf(Response);
          expect(infer).toHaveBeenCalledOnce();
        } else {
          expect(response).toBeInstanceOf(Error);
          expect(infer).not.toHaveBeenCalled();
        }
        expect(fetcher).toHaveBeenCalledTimes(outcome === "stopped" ? 1 : 2);
      } finally {
        vi.useRealTimers();
        handle.dispose();
      }
    },
  );
  it("uses the public gateway's 60-second session TTL on every deposit client", async () => {
    const f = depositFixture("closed");
    const handle = await f.connect();
    await handle.addDeposit();
    expect(sdk.browser).toHaveBeenCalledTimes(2);
    for (const [options] of sdk.browser.mock.calls) {
      expect(options.keyReuseSeconds).toBe(60);
      expect(options.storageName).toBe(STORAGE_NAME);
    }
    handle.dispose();
  });
  it("preserves recovery but refuses new work for restricted deployments", async () => {
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
      /restricted/,
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
      connectZkapi(config, wallet as any, account as any, false),
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
    await expect(
      (handle.client as any).observeWallet("saved-signature"),
    ).rejects.toThrow(/changed or disconnected/);
    expect(client.prepareDeposit).not.toHaveBeenCalled();
    expect(client.observeWallet).not.toHaveBeenCalled();
    handle.dispose();
    expect(sdk.walletListeners.size).toBe(0);
  });
});

it("new Pool profile binding uses separate custody without adopting old bindings", async () => {
  const oldKey = profileBindingKey("zkchat-v1", "account");
  storage.set(oldKey, "b".repeat(64));
  expect(STORAGE_NAME).toBe("zkchat-sdk-public-devnet-20261021-state-v1");
  expect(NOTE_ID).toBe("zkchat-note-sdk-public-devnet-20261021-state-v1");
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

describe("retired custody stays separate from the new Pool", () => {
  it.each(["zkchat-sdk-0.2.0-devnet.3", "zkchat-sdk-0.2.0-devnet.8"])(
    "preserves %s binding and requires explicit setup for the new namespace",
    async (previous) => {
      const original = profileBindingKey(previous, "account");
      storage.set(original, "original-profile-digest");
      await expect(assertRuntimeCustody("account")).resolves.toBeUndefined();
      await expect(
        connectPublicDeployment(config, STORAGE_NAME, "account", false),
      ).rejects.toBeInstanceOf(BrowserStorageMissing);
      expect(storage.size).toBe(1);
      await connectPublicDeployment(config, STORAGE_NAME, "account", true);
      expect(storage.get(original)).toBe("original-profile-digest");
      expect(storage.get(profileBindingKey(STORAGE_NAME, "account"))).toBe(
        config.profileSha256,
      );
      expect(storage.size).toBe(2);
      expect(sdk.browser).not.toHaveBeenCalled();
    },
  );
  it("does not open or rewrite retired unbound databases", async () => {
    const open = vi.fn();
    vi.stubGlobal("indexedDB", {
      open,
      databases: async () => [
        {
          name: JSON.stringify([
            "zkchat-sdk-0.2.0-devnet.8",
            "old-deployment",
            "old-pool",
            "account",
          ]),
        },
      ],
    });
    await assertRuntimeCustody("account");
    await retainProfileBinding(config, STORAGE_NAME, "account", true);
    expect(open).not.toHaveBeenCalled();
    expect(storage.size).toBe(1);
  });
  it.each([
    ["0.2.0-devnet.12", "zkchat-sdk-0.2.0-devnet.8"],
    ["0.2.0-devnet.3", "zkchat-sdk-0.2.0-devnet.3"],
  ])(
    "%s recovery requires original storage and refuses new admission",
    async (version, namespace) => {
      vi.stubEnv("VITE_ZKCHAT_SDK_VERSION", version);
      vi.resetModules();
      try {
        const recovery = await import("../src/lib/publicDeployment");
        await expect(recovery.assertRuntimeCustody("account")).rejects.toThrow(
          "No original SDK",
        );
        storage.set(
          profileBindingKey(namespace, "account"),
          config.profileSha256,
        );
        await expect(
          recovery.assertRuntimeCustody("account"),
        ).resolves.toBeUndefined();
        const connection = await recovery.connectPublicDeployment(
          config,
          namespace,
          "account",
          false,
        );
        expect(connection.canAdmit).toBe(false);
        expect(() => connection.assertAdmission()).toThrow("Pool is retired");
        expect(storage.size).toBe(1);
        const { connectZkapi: connectRecovery } =
          await import("../src/lib/zkapi");
        const account = {
          address: "account",
          chains: ["solana:devnet"],
          features: ["solana:signTransaction"],
        };
        await expect(
          connectRecovery(
            config,
            { accounts: [account] } as any,
            account as any,
            true,
          ),
        ).rejects.toThrow("Recovery requires existing storage");
        expect(sdk.browser).not.toHaveBeenCalled();
      } finally {
        vi.unstubAllEnvs();
        vi.resetModules();
      }
    },
  );
});

it("RPC failures do not invent an origin-registration requirement or expose payloads", () => {
  const failure = new PublicProfileError("rpc");
  failure.message = "private backend credential";
  const message = connectionCheckError(failure).message;
  expect(message).toContain("Check your internet connection");
  expect(message).not.toMatch(/CORS|register|origin registration/);
  expect(message).not.toContain("private backend");
});

describe("optional model selection preserves original custody", () => {
  const settings = (name: string): PublicAppConfig => ({
    ...config,
    profileUrl: `https://assets.example/${name}-original.json`,
    modelProfile: {
      url: `https://assets.example/${name}-models.json`,
      sha256: "e".repeat(64),
    },
  });
  async function mockProfiles(c: PublicAppConfig) {
    const { modelProfiles } = await import("./modelProfileFixtures");
    const fixture = modelProfiles();
    sdk.load.mockImplementation(async (url: string) =>
      url === c.modelProfile!.url ? fixture.extra : fixture.base,
    );
    sdk.options.mockReturnValue({
      deployment: { original: true },
      mode: "direct_openrouter",
      models: fixture.base.profile.models,
    });
    return fixture;
  }

  it("pins additional selection independently while retaining the funded binding and original deployment", async () => {
    const c = settings("funded"),
      fixture = await mockProfiles(c);
    const before = structuredClone(fixture);
    const binding = profileBindingKey("funded-storage", "account");
    storage.set(binding, c.profileSha256);
    const connection = await connectPublicDeployment(
      c,
      "funded-storage",
      "account",
      false,
    );
    expect(sdk.load.mock.calls[0][1].installedProfileSha256).toBe(
      c.profileSha256,
    );
    expect(sdk.load.mock.calls[1]).toEqual([
      c.modelProfile!.url,
      {
        profileSha256: c.modelProfile!.sha256,
        fetch: expect.any(Function),
      },
    ]);
    expect(connection.options.models.map((m) => m.id)).toEqual([
      "openai/gpt-4o-mini",
      "openai/gpt-6.1-sol",
    ]);
    expect(connection.options.deployment).toEqual({ original: true });
    expect(connection.loaded).toBe(fixture.base);
    expect(storage.get(binding)).toBe(c.profileSha256);
    expect(storage.size).toBe(1);
    expect(fixture).toEqual(before);
    expect(connection.canAdmit).toBe(true);
    expect(configuredModels(c).map((m) => m.id)).toEqual([
      "openai/gpt-4o-mini",
      "openai/gpt-6.1-sol",
    ]);
    expect(configuredStreaming(c, "openai/gpt-6.1-sol")).toBe(true);
  });

  it("keeps original recovery open when extra selection fails, blocking new work until reconnect", async () => {
    const c = settings("unavailable");
    const fixture = await mockProfiles(c);
    const binding = profileBindingKey("funded-storage", "account");
    storage.set(binding, c.profileSha256);
    sdk.load.mockImplementation(async (url: string) => {
      if (url === c.modelProfile!.url) throw new PublicProfileError("profile");
      return fixture.base;
    });
    const connection = await connectPublicDeployment(
      c,
      "funded-storage",
      "account",
      false,
    );
    expect(connection.loaded).toBe(fixture.base);
    expect(connection.options.models).toEqual(fixture.base.profile.models);
    expect(connection.canAdmit).toBe(false);
    expect(connection.diagnostic.unavailableComponent).toBe("models");
    expect(() => connection.assertAdmission()).toThrow(
      /Reconnect the same wallet/,
    );
    await connection.refreshPreflight();
    expect(connection.canAdmit).toBe(false);
    expect(storage.get(binding)).toBe(c.profileSha256);
    expect(storage.size).toBe(1);
    expect(sdk.browser).not.toHaveBeenCalled();
    await mockProfiles(c);
    const reconnected = await connectPublicDeployment(
      c,
      "funded-storage",
      "account",
      false,
    );
    expect(reconnected.canAdmit).toBe(true);
    expect(configuredModels(c)).toHaveLength(2);
    expect(storage.get(binding)).toBe(c.profileSha256);
  });

  it("rejects mismatched selection before new custody and never replaces an existing pin", async () => {
    const c = settings("mismatch"),
      fixture = await mockProfiles(c);
    fixture.extra.assets.verifiedManifest.pool = "different-pool";
    await expect(
      connectPublicDeployment(c, "new-storage", "account", true),
    ).rejects.toThrow(/model configuration/);
    expect(storage.size).toBe(0);
    expect(sdk.browser).not.toHaveBeenCalled();
    storage.set(profileBindingKey("funded-storage", "account"), "f".repeat(64));
    sdk.load.mockClear();
    await expect(
      connectPublicDeployment(c, "funded-storage", "account", false),
    ).rejects.toThrow(/Profile changed/);
    expect(sdk.load).not.toHaveBeenCalled();
  });

  it("accepts only an independently pinned HTTPS model profile configuration", () => {
    const c = settings("config");
    expect(parseConfig(c)).toEqual(c);
    for (const modelProfile of [
      { url: "https://assets.example/models.json" },
      { url: "http://assets.example/models.json", sha256: "e".repeat(64) },
      { url: "https://assets.example/models.json", sha256: "BAD" },
      { ...c.modelProfile, models: ["untrusted"] },
    ])
      expect(() => parseConfig({ ...c, modelProfile })).toThrow();
  });
});
