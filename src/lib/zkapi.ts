import { createSolanaRpc } from "@solana/kit";
import { getWallets } from "@wallet-standard/app";
import {
  discoveredWallets,
  subscribeWallets,
  connectSelectedWallet,
  selectConnectedAccount,
} from "./walletConnector";
import type {
  ClientStatus,
  ModelConfiguration,
  Mode,
  ZkApiClient,
} from "@zkapi/solana-sdk";
import {
  BrowserStorageMissing,
  createBrowserClient,
  walletStandardAdapter,
  type BrowserStoragePersistence,
  type StandardAccount,
  type StandardWallet,
} from "@zkapi/solana-sdk/browser";
import {
  loadDeploymentAssets,
  type LoadedDeploymentAssets,
} from "@zkapi/solana-sdk/deployment";
import { parseStrictJson } from "@zkapi/solana-sdk/trust";
import {
  cachedAppProfile,
  connectPublicDeployment,
  loadAppProfile,
  PublicOnboardingError,
  assertRuntimeCustody,
  type PublicAppConfig,
} from "./publicDeployment";
import type { PublicPreflightResult } from "@zkapi/solana-sdk/public-profile";
import type { ServiceReadiness } from "./readiness";
import { WalletConnectionError } from "./walletErrors";
import {
  openDepositCatalog,
  ORIGINAL_NOTE_ID,
  canChangeDeposit,
  canAddDeposit,
  DepositError,
  type DepositCatalog,
  type SavedDeposit,
} from "./deposits";
export { BrowserStorageMissing };
export type { StandardAccount };
export const CHAIN = "solana:devnet" as const;
import { SDK_STORAGE_NAME } from "./sdkVersion";
export const STORAGE_NAME = SDK_STORAGE_NAME;
export const NOTE_ID = ORIGINAL_NOTE_ID;
export type AppConfig = LegacyAppConfig | PublicAppConfig;
export interface LegacyAppConfig {
  schema: 1;
  chain: typeof CHAIN;
  label: string;
  bundleUrl: string;
  bundleSha256: string;
  rpcUrl: string;
  indexerUrl: string;
  mode: Mode;
  models: ModelConfiguration[];
  directProviderBases?: Partial<
    Record<"direct_oa" | "direct_openrouter", string>
  >;
  oaVerifier?: { base: string; stationId: string };
}
export interface AppWallet extends StandardWallet {
  readonly name: string;
  readonly icon: string;
  readonly chains: readonly string[];
}
export interface BrowserClientHandle {
  client: ZkApiClient;
  account: StandardAccount;
  wallet: AppWallet;
  persistence: BrowserStoragePersistence;
  readonly deposits: readonly SavedDeposit[];
  readonly selectedDepositId: string;
  addDeposit(): Promise<void>;
  selectDeposit(id: string): Promise<void>;
  readonly invalidated: boolean;
  readonly publicAdmissionReady: boolean;
  readonly diagnostic: {
    preflight: PublicPreflightResult | null;
    readiness: ServiceReadiness | null;
    unavailableComponent: string | null;
  } | null;
  refreshPreflight(): Promise<void>;
  deployment: { id: string; pool: string; mint: string; environment: "devnet" };
  assertActiveAccount(): void;
  dispose(): void;
}
function object(value: unknown, label: string): Record<string, unknown> {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error(`${label} must be an object.`);
  return value as Record<string, unknown>;
}
function string(
  value: unknown,
  label: string,
  maximum = 2048,
): asserts value is string {
  if (typeof value !== "string" || !value.length || value.length > maximum)
    throw new Error(`${label} is missing or invalid.`);
}
function endpoint(value: unknown, label: string, originOnly = false): void {
  string(value, label);
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    throw new Error(`${label} must be an absolute URL.`);
  }
  const loopback = ["localhost", "127.0.0.1", "[::1]"].includes(url.hostname);
  if (
    url.username ||
    url.password ||
    url.hash ||
    url.search ||
    (url.protocol !== "https:" && !(url.protocol === "http:" && loopback)) ||
    (originOnly && (url.origin !== value || url.protocol !== "https:"))
  )
    throw new Error(
      `${label} must be ${originOnly ? "an HTTPS origin without a trailing slash" : "HTTPS or localhost HTTP, without credentials, query, or fragment"}.`,
    );
}
function decimal(value: unknown, label: string, positive = false): void {
  if (
    typeof value !== "string" ||
    !/^(0|[1-9][0-9]{0,38})$/.test(value) ||
    (positive && BigInt(value) === 0n)
  )
    throw new Error(`${label} must be an integer string.`);
}
function digest(value: unknown, label: string): void {
  if (typeof value !== "string" || !/^[a-f0-9]{64}$/.test(value))
    throw new Error(`${label} must be a lowercase SHA-256 digest.`);
}
/** Configuration belongs to the independently deployed app. bundleSha256 must be installed independently of the bundle. */
export function parseConfig(value: unknown): AppConfig {
  const c = object(value, "Configuration");
  if (c.schema === 2) {
    const keys = ["schema", "chain", "label", "profileUrl", "profileSha256"];
    if (
      Object.keys(c).length !== keys.length ||
      !keys.every((name) => Object.hasOwn(c, name)) ||
      c.chain !== CHAIN
    )
      throw new Error(
        "Public-profile configuration fields or Devnet chain are invalid.",
      );
    string(c.label, "Deployment label", 100);
    endpoint(c.profileUrl, "Public profile URL");
    if (new URL(c.profileUrl as string).protocol !== "https:")
      throw new Error("Public profile must use HTTPS.");
    digest(c.profileSha256, "Public profile SHA-256");
    return structuredClone(c) as unknown as PublicAppConfig;
  }
  const allowed = [
    "schema",
    "chain",
    "label",
    "bundleUrl",
    "bundleSha256",
    "rpcUrl",
    "indexerUrl",
    "mode",
    "models",
    "directProviderBases",
    "oaVerifier",
  ];
  if (Object.keys(c).some((key) => !allowed.includes(key)))
    throw new Error("Configuration contains an unsupported field.");
  if (c.schema !== 1 || c.chain !== CHAIN)
    throw new Error(
      "This app supports reviewed configuration schemas 1 and 2 on Solana Devnet only.",
    );
  string(c.label, "Deployment label", 100);
  endpoint(c.bundleUrl, "Bundle URL");
  digest(c.bundleSha256, "Bundle SHA-256");
  endpoint(c.rpcUrl, "RPC URL");
  // The released SDK requires HTTPS indexer origins for devnet.
  endpoint(c.indexerUrl, "Indexer URL", true);
  if (!["proxy", "direct_oa", "direct_openrouter"].includes(String(c.mode)))
    throw new Error("Select an explicit provider mode.");
  if (!Array.isArray(c.models) || !c.models.length || c.models.length > 100)
    throw new Error("Configure between 1 and 100 models.");
  const ids = new Set<string>();
  for (const raw of c.models) {
    const m = object(raw, "Model");
    string(m.id, "Model ID", 200);
    if (!/^[\x21-\x7e]+$/.test(m.id) || m.id === "*" || ids.has(m.id))
      throw new Error("Model IDs must be unique printable identifiers.");
    ids.add(m.id);
    if (m.label !== undefined) string(m.label, "Model label", 100);
    if (
      !Array.isArray(m.apis) ||
      !m.apis.includes("chat") ||
      m.apis.some((api) => !["chat", "responses"].includes(api))
    )
      throw new Error("Every configured model must support Chat Completions.");
    if (!["openai", "openrouter", "oa"].includes(String(m.provider)))
      throw new Error("Unsupported Chat Completions provider.");
    if (m.provider === "openrouter" && m.apis.some((api) => api !== "chat"))
      throw new Error("The released OpenRouter adapter supports chat.");
    const tariff = object(m.tariff, "Model tariff");
    digest(tariff.tariff_hash, "Tariff hash");
    for (const key of ["version", "provider", "model", "pricing_basis"])
      string(tariff[key], `Tariff ${key}`, 200);
    for (const key of ["valid_from", "valid_until", "operator_fee_micro_usdc"])
      decimal(tariff[key], `Tariff ${key}`);
    if (
      BigInt(tariff.valid_until as string) <=
      BigInt(tariff.valid_from as string)
    )
      throw new Error("Tariff validity interval must be positive.");
    if (!Array.isArray(tariff.rates) || tariff.rates.length > 100)
      throw new Error("Tariff rates are invalid.");
    for (const rawRate of tariff.rates) {
      const rate = object(rawRate, "Tariff rate");
      string(rate.unit, "Tariff rate unit", 100);
      decimal(rate.nano_usdc_numerator, "Tariff numerator");
      decimal(rate.unit_denominator, "Tariff denominator", true);
    }
    if (
      tariff.provider !== m.provider ||
      (c.mode === "proxy"
        ? !["openai", "openrouter"].includes(String(m.provider)) ||
          tariff.model !== m.id ||
          tariff.pricing_basis !== "fixed_usage_rates"
        : m.provider !== (c.mode === "direct_oa" ? "oa" : "openrouter") ||
          tariff.model !== "*" ||
          tariff.pricing_basis !== "provider_reported_usd")
    )
      throw new Error("Model, tariff, provider, and mode must agree.");
  }
  if (c.directProviderBases !== undefined) {
    const bases = object(c.directProviderBases, "Direct provider bases");
    for (const [key, value] of Object.entries(bases)) {
      if (!["direct_oa", "direct_openrouter"].includes(key))
        throw new Error("Unsupported direct provider base.");
      endpoint(value, "Direct provider base");
    }
  }
  if (
    c.mode !== "proxy" &&
    !(c.directProviderBases as Record<string, unknown> | undefined)?.[
      c.mode as string
    ]
  )
    throw new Error(
      "Direct mode requires its independently installed provider base.",
    );
  if (c.oaVerifier !== undefined) {
    const verifier = object(c.oaVerifier, "OA verifier");
    endpoint(verifier.base, "OA verifier base");
    string(verifier.stationId, "OA station ID", 200);
  }
  if (c.mode === "direct_oa" && !c.oaVerifier)
    throw new Error(
      "Direct OA requires independently installed verifier pins.",
    );
  return structuredClone(c) as unknown as AppConfig;
}
/** Missing file or literal JSON null keeps live service unavailable. */
export async function loadConfig(): Promise<AppConfig | null> {
  const response = await fetch(`${import.meta.env.BASE_URL}zkapi-config.json`, {
    credentials: "omit",
    cache: "no-store",
    redirect: "error",
    signal: AbortSignal.timeout(15_000),
  });
  if (response.status === 404) {
    await response.body?.cancel();
    return null;
  }
  if (!response.ok) {
    await response.body?.cancel();
    throw new Error(
      `Deployment configuration unavailable (HTTP ${response.status}).`,
    );
  }
  const reader = response.body?.getReader();
  if (!reader) throw new Error("Deployment configuration is empty.");
  const chunks: Uint8Array[] = [];
  let total = 0;
  try {
    for (;;) {
      const next = await reader.read();
      if (next.done) break;
      total += next.value.length;
      if (total > 256 * 1024)
        throw new Error("Deployment configuration exceeds 256 KiB.");
      chunks.push(next.value);
    }
  } finally {
    await reader.cancel().catch(() => {});
    reader.releaseLock();
  }
  const bytes = new Uint8Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    bytes.set(chunk, offset);
    offset += chunk.length;
  }
  const parsed = parseStrictJson(bytes, 256 * 1024);
  if (parsed === null) return null;
  const config = parseConfig(parsed);
  if (config.schema === 2) await loadAppProfile(config);
  return config;
}
function supportsV0(wallet: AppWallet): boolean {
  const feature = wallet.features["solana:signTransaction"];
  return (
    wallet.chains.includes(CHAIN) &&
    Array.isArray(feature?.supportedTransactionVersions) &&
    feature.supportedTransactionVersions.includes(0) &&
    typeof feature.signTransaction === "function"
  );
}
export function listWallets(): AppWallet[] {
  return discoveredWallets().filter(supportsV0);
}
export function watchWallets(listener: () => void): () => void {
  return subscribeWallets(listener);
}
export function watchWallet(
  wallet: AppWallet,
  listener: () => void,
): () => void {
  const events = wallet.features["standard:events"] as
    { on?: (event: "change", callback: () => void) => () => void } | undefined;
  return typeof events?.on === "function"
    ? events.on("change", listener)
    : () => {};
}
export function compatibleAccounts(wallet: AppWallet): StandardAccount[] {
  if (!supportsV0(wallet)) return [];
  return wallet.accounts.filter(
    (account) =>
      account.chains.includes(CHAIN) &&
      account.features.includes("solana:signTransaction"),
  );
}
export async function connectWallet(
  wallet: AppWallet,
): Promise<StandardAccount[]> {
  if (!supportsV0(wallet))
    throw new WalletConnectionError(
      "A Solana Devnet wallet with v0 support is required.",
    );
  await connectSelectedWallet(wallet);
  const accounts = compatibleAccounts(wallet);
  if (!accounts.length)
    throw new WalletConnectionError(
      "Select an account supporting Solana Devnet and v0 transactions.",
    );
  return accounts;
}
let assetCache:
  { key: string; promise: Promise<LoadedDeploymentAssets> } | undefined;
function deploymentAssets(
  config: LegacyAppConfig,
): Promise<LoadedDeploymentAssets> {
  const key = `${config.bundleSha256}:${config.bundleUrl}`;
  if (assetCache?.key === key) return assetCache.promise;
  const promise = loadDeploymentAssets(config.bundleUrl, {
    bundleSha256: config.bundleSha256,
  });
  assetCache = { key, promise };
  void promise.catch(() => {
    if (assetCache?.promise === promise) assetCache = undefined;
  });
  return promise;
}
export function configuredModels(
  config: AppConfig | null,
): readonly ModelConfiguration[] {
  if (!config) return [];
  return config.schema === 1
    ? config.models
    : (cachedAppProfile(config)?.profile.models ?? []);
}
export function configuredMode(config: AppConfig): Mode | undefined {
  return config.schema === 1
    ? config.mode
    : cachedAppProfile(config)?.profile.mode;
}
export function configuredStreaming(
  config: AppConfig | null,
  model: string,
): boolean {
  if (!config || config.schema === 1) return true;
  return (
    cachedAppProfile(config)?.profile.modelCapabilities[model]?.streaming ===
    true
  );
}
export async function connectZkapi(
  config: AppConfig,
  wallet: AppWallet,
  account: StandardAccount,
  initializeStorage = false,
  admissionToken?: string,
): Promise<BrowserClientHandle> {
  const installed = parseConfig(config);
  if (
    !globalThis.isSecureContext ||
    !globalThis.crypto?.subtle ||
    !globalThis.Worker ||
    !globalThis.indexedDB ||
    !globalThis.navigator?.locks
  )
    throw new Error(
      "Use HTTPS or localhost with IndexedDB, Web Locks, Web Crypto, and module Workers.",
    );
  const signer = walletStandardAdapter(wallet, account, CHAIN);
  await assertRuntimeCustody(signer.publicKey);
  selectConnectedAccount(wallet, account);
  const publicConnection =
    installed.schema === 2
      ? await connectPublicDeployment(
          installed,
          STORAGE_NAME,
          signer.publicKey,
          initializeStorage,
          admissionToken,
        )
      : undefined;
  const assets =
    publicConnection?.assets ??
    (await deploymentAssets(installed as LegacyAppConfig));
  if (
    assets.verifiedManifest.deployment_environment !== "devnet" ||
    assets.trust.expected.deployment_environment !== "devnet"
  ) {
    publicConnection?.clear();
    throw new Error("This app refuses deployments outside Solana Devnet.");
  }
  try {
    walletStandardAdapter(wallet, account, CHAIN);
  } catch (error) {
    publicConnection?.clear();
    throw error;
  }
  const legacy = installed as LegacyAppConfig;
  let raw: Awaited<ReturnType<typeof createBrowserClient>>;
  const openClient = (noteId: string, initialize = false) =>
    createBrowserClient({
      ...(publicConnection?.options ?? {
        deployment: {
          manifest: assets.manifest,
          trust: assets.trust,
          artifacts: assets.artifacts,
          connection: createSolanaRpc(legacy.rpcUrl),
          indexerOrigin: legacy.indexerUrl,
          preparationCommitment: "confirmed" as const,
        },
        mode: legacy.mode,
        models: legacy.models,
        directProviderBases: legacy.directProviderBases,
        oaVerifier: legacy.oaVerifier,
      }),
      storageName: STORAGE_NAME,
      noteId,
      initializeStorage: initialize,
      wallet: signer,
      createWorker: () =>
        new Worker(new URL("./prover.worker.ts", import.meta.url), {
          type: "module",
          name: "zkchat-prover",
        }),
      wasm: assets.wasm,
      wasmSha256: assets.wasmSha256,
    });
  let catalog: DepositCatalog;
  let saved: Awaited<ReturnType<DepositCatalog["read"]>>;
  try {
    raw = await openClient(NOTE_ID, initializeStorage);
  } catch (error) {
    publicConnection?.clear();
    throw error;
  }
  try {
    catalog = await openDepositCatalog(
      STORAGE_NAME,
      assets.verifiedManifest.deployment_id,
      assets.verifiedManifest.pool,
      signer.publicKey,
    );
    saved = await catalog.read();
    if (saved.selectedId !== NOTE_ID) {
      const selected = await openClient(saved.selectedId);
      raw.dispose();
      raw = selected;
    }
  } catch (error) {
    raw.dispose();
    catalog!?.close();
    publicConnection?.clear();
    throw error;
  }
  let selectedId = saved.selectedId;
  let invalidated = false,
    disposed = false,
    switching = false;
  const observers = new Set<(status: ClientStatus) => void>();
  const selectedStillActive = () =>
    !disposed &&
    supportsV0(wallet) &&
    wallet.accounts.includes(account) &&
    account.chains.includes(CHAIN) &&
    account.features.includes("solana:signTransaction");
  const project = (status: ClientStatus): ClientStatus =>
    invalidated ||
    switching ||
    !selectedStillActive() ||
    (publicConnection && !publicConnection.canAdmit)
      ? { ...status, canRequest: false }
      : status;
  const assertActiveAccount = () => {
    if (invalidated || !selectedStillActive()) {
      invalidated = true;
      throw new Error(
        "The selected wallet account changed or disconnected. Reconnect the same account to continue.",
      );
    }
  };
  const notifyObservers = () => {
    const current = raw.client;
    void current
      .status()
      .then((status) => {
        if (current !== raw.client || disposed) return;
        for (const listener of observers) {
          try {
            listener(project(status));
          } catch {
            /* Observers cannot interrupt financial state. */
          }
        }
      })
      .catch(() => {});
  };
  const subscribeRaw = () => {
    const current = raw.client;
    return current.subscribe((status) => {
      if (current !== raw.client || disposed) return;
      for (const listener of observers) {
        try {
          listener(project(status));
        } catch {
          /* Isolate UI observers. */
        }
      }
    });
  };
  let offClient = subscribeRaw();
  const assertSelectedDeposit = async (requestedId: string) => {
    const latest = await catalog.read();
    if (
      disposed ||
      requestedId !== selectedId ||
      latest.selectedId !== selectedId
    )
      throw new DepositError(
        "The selected deposit changed in another operation or tab. Reconnect to load your saved deposits before continuing.",
      );
    saved = latest;
  };
  const changeDeposit = async (id?: string) => {
    const requestedId = selectedId;
    await catalog.withLock(async () => {
      assertActiveAccount();
      await assertSelectedDeposit(requestedId);
      if (id === selectedId) return;
      const status = await raw.client.status();
      if (!canChangeDeposit(status) || (!id && !canAddDeposit(status)))
        throw new DepositError(
          "Finish the current deposit, withdrawal or settlement before changing deposits. Your saved operation is retained.",
        );
      if (id && !saved.deposits.some((d) => d.id === id))
        throw new DepositError("This deposit is not in the saved account.");
      switching = true;
      notifyObservers();
      let next: typeof raw | undefined;
      try {
        if (!id && publicConnection) {
          await publicConnection.refreshPreflight();
          if (!publicConnection.canAdmit || !publicConnection.freshAdmission)
            throw new PublicOnboardingError(
              "New deposits are unavailable. Refresh operator readiness; your existing deposits remain available.",
            );
        }
        const nextId = id ?? `zkchat-deposit-${crypto.randomUUID()}`;
        next = await openClient(nextId);
        assertActiveAccount();
        const updated = {
          ...saved,
          selectedId: nextId,
          deposits: id
            ? saved.deposits
            : [...saved.deposits, { id: nextId, createdAt: Date.now() }],
        };
        // Save the ID before exposing a client capable of preparing or signing.
        await catalog.save(updated);
        offClient();
        const previous = raw;
        raw = next;
        next = undefined;
        selectedId = nextId;
        saved = updated;
        offClient = subscribeRaw();
        previous.dispose();
      } finally {
        next?.dispose();
        switching = false;
        notifyObservers();
      }
    });
  };
  const offWallet = watchWallet(wallet, () => {
    if (selectedStillActive()) return;
    invalidated = true;
    notifyObservers();
  });
  const offRegistry = getWallets().on("unregister", (...removed) => {
    if ((removed as unknown as AppWallet[]).includes(wallet)) {
      invalidated = true;
      notifyObservers();
    }
  });
  const guarded = new Set<PropertyKey>([
    "chat",
    "request",
    "prepareDeposit",
    "prepareWithdrawal",
    "prepareEmergencyEscape",
    "advanceWallet",
    "resumeWalletProof",
    "retryRejectedWalletOperation",
    "recoverExpiredWalletSetup",
    "fallbackToEscape",
    "prepareFinalizeEscape",
  ]);
  // Route through the selected SDK client; preserve every previous journal.
  const client = new Proxy(raw.client, {
    get(_target, property) {
      const target = raw.client;
      if (property === "status")
        return async () => {
          const current = raw.client;
          const latest = await catalog.read();
          const status = project(await current.status());
          return latest.selectedId === selectedId
            ? status
            : { ...status, canRequest: false };
        };
      if (property === "subscribe")
        return (listener: (status: ClientStatus) => void) => {
          observers.add(listener);
          notifyObservers();
          return () => {
            observers.delete(listener);
          };
        };
      const value = Reflect.get(target, property, target);
      if (typeof value !== "function") return value;
      if (property !== "listModels" && property !== "dispose")
        return async (...args: unknown[]) => {
          const requestedId = selectedId;
          return catalog.withLock(async () => {
            await assertSelectedDeposit(requestedId);
            const target = raw.client;
            if (guarded.has(property)) assertActiveAccount();
            if (
              publicConnection &&
              ["chat", "request", "prepareDeposit"].includes(String(property))
            ) {
              const signal =
                property === "prepareDeposit"
                  ? undefined
                  : (args[0] as { signal?: AbortSignal }).signal;
              signal?.throwIfAborted();
              await publicConnection.refreshPreflight();
              signal?.throwIfAborted();
              assertActiveAccount();
              if (
                !publicConnection.canAdmit ||
                !publicConnection.freshAdmission
              )
                throw new PublicOnboardingError(
                  "New work is unavailable. Refresh operator readiness and check whether this deployment requires an invitation. Recovery remains available.",
                );
              if (property === "chat") {
                const input = args[0] as {
                  model?: string;
                  stream?: boolean;
                  maxOutputTokens?: number;
                };
                const capability =
                  publicConnection.loaded.profile.modelCapabilities[
                    input.model ?? ""
                  ];
                if (!capability || (input.stream && !capability.streaming))
                  throw new Error(
                    "The selected public profile does not support this request capability.",
                  );
                if (
                  !Number.isSafeInteger(input.maxOutputTokens) ||
                  input.maxOutputTokens! < 1 ||
                  input.maxOutputTokens! > 128
                )
                  throw new Error(
                    "This public Devnet preview allows at most 128 output tokens.",
                  );
              }
            }
            return Reflect.apply(
              Reflect.get(target, property, target),
              target,
              args,
            );
          });
        };
      return value.bind(target);
    },
  });
  try {
    assertActiveAccount();
  } catch (error) {
    offWallet();
    offRegistry();
    offClient();
    raw.dispose();
    catalog.close();
    publicConnection?.clear();
    throw error;
  }
  return {
    client,
    account,
    wallet,
    persistence: raw.persistence,
    get deposits() {
      return saved.deposits.map((d) => ({ ...d }));
    },
    get selectedDepositId() {
      return selectedId;
    },
    addDeposit: () => changeDeposit(),
    selectDeposit: (id) => changeDeposit(id),
    get publicAdmissionReady() {
      return publicConnection?.canAdmit ?? true;
    },
    get diagnostic() {
      return publicConnection?.diagnostic ?? null;
    },
    async refreshPreflight() {
      if (publicConnection) await publicConnection.refreshPreflight();
      notifyObservers();
    },
    get invalidated() {
      return invalidated;
    },
    deployment: {
      id: assets.verifiedManifest.deployment_id,
      pool: assets.verifiedManifest.pool,
      mint: assets.verifiedManifest.mint,
      environment: "devnet",
    },
    assertActiveAccount,
    dispose() {
      if (disposed) return;
      offClient();
      raw.dispose();
      catalog.close();
      publicConnection?.clear();
      disposed = true;
      offWallet();
      offRegistry();
      observers.clear();
    },
  };
}
