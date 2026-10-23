import {
  loadPublicDeploymentProfile,
  preflightPublicDeployment,
  publicProfileClientOptions,
  PublicProfileError,
  type LoadedPublicDeploymentProfile,
  type PublicPreflightResult,
} from "@zkapi/solana-sdk/public-profile";
import { BrowserStorageMissing } from "@zkapi/solana-sdk/browser";
import { checkServiceReadiness, type ServiceReadiness } from "./readiness";
import { SDK_STORAGE_NAME, SDK_VERSION, RETIRED_RUNTIME } from "./sdkVersion";
import { createRpcReadFetch } from "./rpcReadFetch";

export interface PublicAppConfig {
  schema: 2;
  chain: "solana:devnet";
  label: string;
  profileUrl: string;
  profileSha256: string;
}
export class PublicOnboardingError extends Error {}

// Only the SDK's error class and allowlisted component labels reach the UI.
// Never display an underlying response, exception message or endpoint here.
const connectionCheckLabels: Readonly<Record<string, string>> = {
  profile: "service settings",
  compatibility: "app compatibility",
  assets: "payment setup",
  models: "model configuration",
  rpc: "chain connection",
  pool: "payment pool",
  control: "service configuration",
  catalog: "model catalog",
  snapshot: "finalized chain snapshot",
  readiness: "service status",
};

export function servicePauseReason(
  diagnostic: {
    preflight: PublicPreflightResult | null;
    readiness: ServiceReadiness | null;
    unavailableComponent: string | null;
  } | null,
) {
  if (diagnostic?.preflight?.paused)
    return "The operator has paused new payments. Check again later.";
  if (diagnostic?.unavailableComponent) {
    switch (diagnostic.unavailableComponent) {
      case "rpc":
        return "Could not verify the connection to Solana.";
      case "snapshot":
        return "Could not verify the latest confirmed Solana state.";
      case "readiness":
        return "Could not confirm that the payment service is ready.";
      default: {
        const label = Object.hasOwn(
          connectionCheckLabels,
          diagnostic.unavailableComponent,
        )
          ? connectionCheckLabels[diagnostic.unavailableComponent]
          : "the service connection";
        return `Could not verify ${label}.`;
      }
    }
  }
  if (diagnostic?.readiness?.admission === "suspended")
    return "The operator has paused new requests. Check again later.";
  if (diagnostic?.readiness?.invitationRequired)
    return "The operator has restricted new requests. Check again later.";
  if (diagnostic?.readiness && !diagnostic.readiness.servicesAvailable)
    return "A payment service is not ready. Check again later.";
  return "The service connection needs to be checked again.";
}

export function connectionCheckError(error: PublicProfileError) {
  const label = Object.hasOwn(connectionCheckLabels, error.component)
    ? connectionCheckLabels[error.component]
    : "service";
  const guidance =
    error.component === "rpc"
      ? "Check your internet connection, then try Check service again."
      : "Try Check service later. Adding funds will not fix this.";
  return new PublicOnboardingError(
    `Could not verify ${label}. ${guidance} No request or transaction was sent.`,
  );
}

const profiles = new Map<string, LoadedPublicDeploymentProfile>();
const loadingProfiles = new Map<
  string,
  Promise<LoadedPublicDeploymentProfile>
>();
const profileFetchers = new WeakMap<
  LoadedPublicDeploymentProfile,
  typeof fetch
>();
const key = (config: PublicAppConfig) =>
  `${config.profileSha256}:${config.profileUrl}`;
async function loadProfileWithRpcBackoff(
  config: PublicAppConfig,
  installedProfileSha256?: string,
) {
  // The retry target becomes available only after the SDK authenticates the
  // pinned profile. The SDK retains this same fetcher for its RPC connection.
  let rpcUrl: string | undefined;
  const fetcher = createRpcReadFetch(() => rpcUrl, globalThis.fetch);
  const loaded = await loadPublicDeploymentProfile(config.profileUrl, {
    profileSha256: config.profileSha256,
    installedProfileSha256,
    fetch: fetcher,
  });
  rpcUrl = loaded.profile.rpcUrl;
  profileFetchers.set(loaded, fetcher);
  return loaded;
}
export async function loadAppProfile(config: PublicAppConfig) {
  const existing = profiles.get(key(config));
  if (existing) return existing;
  const pending = loadingProfiles.get(key(config));
  if (pending) return pending;
  const request = loadProfileWithRpcBackoff(config)
    .then((profile) => {
      profiles.set(key(config), profile);
      return profile;
    })
    .finally(() => {
      loadingProfiles.delete(key(config));
    });
  loadingProfiles.set(key(config), request);
  return request;
}
export const cachedAppProfile = (config: PublicAppConfig) =>
  profiles.get(key(config));

/** Retry a failed read-only preflight once only when its transport failed.
 * Never wrap quotes, AUTH, inference, wallet actions or failed trust checks. */
async function checkPreflight(
  loaded: LoadedPublicDeploymentProfile,
  fetcher: typeof fetch = profileFetchers.get(loaded) ?? globalThis.fetch,
  signal?: AbortSignal,
) {
  for (let attempt = 0; ; attempt++) {
    let transportFailed = false;
    const observedFetch: typeof fetch = async (input, init) => {
      try {
        const response = await fetcher(input, init);
        // A rate-limited RPC read already waited and retried once. Never
        // restart the whole preflight immediately after another HTTP 429.
        if ([502, 503, 504].includes(response.status)) transportFailed = true;
        return response;
      } catch (error) {
        if (
          error instanceof TypeError ||
          (error instanceof DOMException && error.name === "TimeoutError")
        )
          transportFailed = true;
        throw error;
      }
    };
    try {
      return await preflightPublicDeployment(loaded, {
        fetch: observedFetch,
        signal,
        timeoutMs: 180_000,
      });
    } catch (error) {
      signal?.throwIfAborted();
      if (attempt !== 0 || !transportFailed) throw error;
    }
  }
}

export async function inspectPublicDeployment(config: PublicAppConfig) {
  try {
    const loaded = await loadAppProfile(config);
    const preflight = await checkPreflight(loaded);
    const readiness = await serviceReadiness(loaded);
    return { preflight, readiness };
  } catch (error) {
    if (error instanceof PublicProfileError) throw connectionCheckError(error);
    throw new PublicOnboardingError(
      "Service unavailable. Try Check service later. No funds are needed.",
    );
  }
}

function serviceReadiness(
  loaded: LoadedPublicDeploymentProfile,
  fetcher?: typeof fetch,
  signal?: AbortSignal,
) {
  const manifest = loaded.assets.verifiedManifest;
  return checkServiceReadiness(
    {
      origin: manifest.control_api_origin,
      id: manifest.deployment_id,
      manifestHash: manifest.manifest_hash,
    },
    fetcher,
    signal,
  );
}

export function profileBindingKey(storageName: string, account: string) {
  return JSON.stringify(["zkchat-public-profile-v1", storageName, account]);
}
function matchesCustody(name: unknown, storageName: string, account: string) {
  if (typeof name !== "string") return false;
  try {
    const scope = JSON.parse(name);
    return (
      Array.isArray(scope) &&
      scope.length === 4 &&
      scope[0] === storageName &&
      scope[3] === account
    );
  } catch {
    return false;
  }
}
/** Inspect names/keys only, without opening a new journal or creating custody. */
export async function existingAppCustody(
  storageName: string,
  account: string,
): Promise<boolean> {
  if (typeof indexedDB.databases !== "function")
    throw new PublicOnboardingError(
      "This browser cannot safely inspect existing storage. Restore the original configuration.",
    );
  const databases = await indexedDB.databases();
  if (databases.some((db) => matchesCustody(db.name, storageName, account)))
    return true;
  if (!databases.some((db) => db.name === "zkapi-browser-custody-v1"))
    return false;
  return new Promise<boolean>((resolve, reject) => {
    const request = indexedDB.open("zkapi-browser-custody-v1");
    request.onupgradeneeded = () => {
      request.transaction?.abort();
      reject(
        new PublicOnboardingError(
          "Original custody changed; no reset allowed.",
        ),
      );
    };
    request.onerror = request.onblocked = () =>
      reject(new PublicOnboardingError("Original custody is unavailable."));
    request.onsuccess = () => {
      const db = request.result;
      try {
        const tx = db.transaction("keys", "readonly"),
          keys = tx.objectStore("keys").getAllKeys();
        tx.oncomplete = () => {
          db.close();
          resolve(
            keys.result.some((name) =>
              matchesCustody(name, storageName, account),
            ),
          );
        };
        tx.onabort = tx.onerror = () => {
          db.close();
          reject(new PublicOnboardingError("Original custody is unavailable."));
        };
      } catch {
        db.close();
        reject(new PublicOnboardingError("Original custody is unavailable."));
      }
    };
  });
}
/** Recovery opens only its original namespace; current setup is explicitly separate. */
export async function assertRuntimeCustody(account: string) {
  if (!RETIRED_RUNTIME) return;
  const original =
    localStorage.getItem(profileBindingKey(SDK_STORAGE_NAME, account)) !==
      null || (await existingAppCustody(SDK_STORAGE_NAME, account));
  if (!original)
    throw new PublicOnboardingError(
      `No original SDK ${SDK_VERSION} storage was found for this account. Use the current app for a new installation.`,
    );
}
/** Pin before opening new custody; never adopt an existing unbound journal. */
export async function retainProfileBinding(
  config: PublicAppConfig,
  storageName: string,
  account: string,
  initialize: boolean,
  hasCustody = () => existingAppCustody(storageName, account),
) {
  const binding = profileBindingKey(storageName, account);
  return navigator.locks.request(binding, { mode: "exclusive" }, async () => {
    const installed = localStorage.getItem(binding);
    if (installed !== null && installed !== config.profileSha256)
      throw new PublicOnboardingError(
        "Profile changed. Reopen the original profile for recovery; migration is never automatic.",
      );
    if (installed === null) {
      if (await hasCustody())
        throw new PublicOnboardingError(
          "Existing storage has no public-profile binding. Restore its original schema 1 configuration; explicit migration requires separate review.",
        );
      if (!initialize) throw new BrowserStorageMissing();
      localStorage.setItem(binding, config.profileSha256);
      if (localStorage.getItem(binding) !== config.profileSha256)
        throw new PublicOnboardingError("Profile binding could not be saved.");
    }
    return installed !== null;
  });
}

export async function connectPublicDeployment(
  config: PublicAppConfig,
  storageName: string,
  account: string,
  initialize: boolean,
) {
  try {
    const installed = localStorage.getItem(
      profileBindingKey(storageName, account),
    );
    if (installed !== null && installed !== config.profileSha256)
      throw new PublicOnboardingError(
        "Profile changed. Reopen the original profile for recovery.",
      );
    const loaded = await loadProfileWithRpcBackoff(
      config,
      installed ?? undefined,
    );
    const fetcher = profileFetchers.get(loaded)!;
    let preflight: PublicPreflightResult | null = null,
      readiness: ServiceReadiness | null = null,
      closed = false,
      profileRetained = installed !== null,
      unavailableComponent: string | null = null;
    const refreshPreflight = async (signal?: AbortSignal) => {
      readiness = null;
      try {
        preflight = await checkPreflight(loaded, fetcher, signal);
        unavailableComponent = null;
      } catch (error) {
        preflight = null;
        unavailableComponent =
          error instanceof PublicProfileError ? error.component : "unavailable";
        if (!profileRetained) throw error;
      }
      if (preflight) {
        try {
          readiness = await serviceReadiness(loaded, fetcher, signal);
        } catch {
          unavailableComponent = "readiness";
          signal?.throwIfAborted();
        }
      }
      return { preflight, readiness, unavailableComponent };
    };
    await refreshPreflight();
    await retainProfileBinding(config, storageName, account, initialize);
    profileRetained = true;
    const canAdmit = () =>
      !RETIRED_RUNTIME &&
      !closed &&
      preflight?.chainAllowsNewOperations === true &&
      readiness?.servicesAvailable === true &&
      readiness.admission === "enabled" &&
      !readiness.invitationRequired;
    return {
      options: publicProfileClientOptions(loaded),
      assets: loaded.assets,
      loaded,
      refreshPreflight,
      get diagnostic() {
        return { preflight, readiness, unavailableComponent };
      },
      get canAdmit() {
        return canAdmit();
      },
      get freshAdmission() {
        return readiness !== null && readiness.expiresAt > Date.now();
      },
      assertAdmission(prefix = "New work is unavailable.") {
        if (RETIRED_RUNTIME)
          throw new PublicOnboardingError(
            "This Pool is retired. Keep its saved data for recovery and use the current app for new deposits and chats.",
          );
        if (canAdmit() && readiness && readiness.expiresAt > Date.now()) return;
        let reason = "Choose Refresh status to check the service again.";
        if (closed) reason = "Reconnect the same wallet to continue.";
        else if (unavailableComponent) {
          const label = Object.hasOwn(
            connectionCheckLabels,
            unavailableComponent,
          )
            ? connectionCheckLabels[unavailableComponent]
            : "service";
          reason = `Could not verify ${label}. Choose Refresh status to check again.`;
        } else if (preflight?.paused || readiness?.admission === "suspended")
          reason = "The operator has paused new requests. Check again later.";
        else if (readiness && !readiness.servicesAvailable)
          reason =
            "A payment service is unavailable. Choose Refresh status to check again.";
        else if (readiness?.invitationRequired)
          reason =
            "The operator has restricted new requests. Check again later.";
        else if (readiness && readiness.expiresAt <= Date.now())
          reason =
            "The service check expired. Choose Refresh status to check again.";
        throw new PublicOnboardingError(
          `${prefix} ${reason} Recovery remains available.`,
        );
      },
      clear() {
        closed = true;
      },
    };
  } catch (error) {
    if (error instanceof PublicProfileError) throw connectionCheckError(error);
    throw error;
  }
}
