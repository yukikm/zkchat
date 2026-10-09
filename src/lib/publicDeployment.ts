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
  profile: "deployment profile",
  compatibility: "app compatibility",
  assets: "proof assets",
  models: "model configuration",
  rpc: "chain connection",
  pool: "finalized Pool configuration",
  control: "operator configuration",
  catalog: "model catalog",
  snapshot: "finalized chain snapshot",
  readiness: "live operator readiness",
};
export function connectionCheckError(error: PublicProfileError) {
  const label = Object.hasOwn(connectionCheckLabels, error.component)
    ? connectionCheckLabels[error.component]
    : "public deployment";
  const guidance =
    error.component === "rpc"
      ? "The public Devnet accepts localhost and HTTPS apps without origin registration. Check network/RPC availability; this error alone does not establish a CORS failure."
      : error.component === "snapshot"
        ? "The finalized chain snapshot could not be verified. Retry the connection check when the indexer is available; adding funds will not resolve this check."
        : "Try Verify connection again when the operator is ready.";
  return new PublicOnboardingError(
    `Connection checks are unavailable: ${label}. No AUTH, inference, or transaction was submitted. ${guidance}`,
  );
}

const profiles = new Map<string, LoadedPublicDeploymentProfile>();
const loadingProfiles = new Map<
  string,
  Promise<LoadedPublicDeploymentProfile>
>();
const key = (config: PublicAppConfig) =>
  `${config.profileSha256}:${config.profileUrl}`;
export async function loadAppProfile(config: PublicAppConfig) {
  const existing = profiles.get(key(config));
  if (existing) return existing;
  const pending = loadingProfiles.get(key(config));
  if (pending) return pending;
  const request = loadPublicDeploymentProfile(config.profileUrl, {
    profileSha256: config.profileSha256,
  })
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

export async function inspectPublicDeployment(config: PublicAppConfig) {
  try {
    const loaded = await loadAppProfile(config);
    const preflight = await preflightPublicDeployment(loaded);
    const readiness = await serviceReadiness(loaded);
    return { preflight, readiness };
  } catch (error) {
    if (error instanceof PublicProfileError) throw connectionCheckError(error);
    throw new PublicOnboardingError(
      "Operator readiness is unavailable. Try the connection check again; no wallet or funds are needed.",
    );
  }
}

function serviceReadiness(
  loaded: LoadedPublicDeploymentProfile,
  fetcher?: typeof fetch,
) {
  const manifest = loaded.assets.verifiedManifest;
  return checkServiceReadiness(
    {
      origin: manifest.control_api_origin,
      id: manifest.deployment_id,
      manifestHash: manifest.manifest_hash,
    },
    fetcher,
  );
}

/** A user-entered invitation is never persisted or copied from caller headers. */
export function invitationTransport(
  token?: string,
  fetcher: typeof fetch = globalThis.fetch,
) {
  let invitation = token,
    destination: string | undefined;
  if (invitation !== undefined && invitation !== "") {
    if (!/^[A-Za-z0-9_-]{43}$/.test(invitation))
      throw new PublicOnboardingError("Invalid invitation format.");
    const decoded = atob(
      invitation.replace(/-/g, "+").replace(/_/g, "/") + "=",
    );
    if (
      decoded.length !== 32 ||
      btoa(decoded)
        .replace(/\+/g, "-")
        .replace(/\//g, "_")
        .replace(/=+$/, "") !== invitation
    )
      throw new PublicOnboardingError("Invalid invitation format.");
  } else invitation = undefined;
  const scopedFetch: typeof fetch = (input, init) => {
    const request = input instanceof Request ? input : undefined;
    const url = request?.url ?? String(input),
      method = (init?.method ?? request?.method ?? "GET").toUpperCase();
    const headers = new Headers(init?.headers ?? request?.headers);
    headers.delete("x-zkapi-admission");
    if (invitation && destination && url === destination && method === "POST")
      headers.set("x-zkapi-admission", invitation);
    return fetcher(input, {
      ...init,
      headers,
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
  };
  return {
    fetch: scopedFetch,
    setAuthenticatedOrigin(origin: string) {
      const url = new URL(origin);
      if (
        url.protocol !== "https:" ||
        url.origin !== origin ||
        url.username ||
        url.password
      )
        throw new PublicOnboardingError(
          "Invalid authenticated control origin.",
        );
      destination = origin + "/zkapi/v1/sessions";
    },
    clear() {
      invitation = undefined;
      destination = undefined;
    },
    get available() {
      return invitation !== undefined;
    },
  };
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
  token?: string,
) {
  const transport = invitationTransport(token);
  try {
    const installed = localStorage.getItem(
      profileBindingKey(storageName, account),
    );
    if (installed !== null && installed !== config.profileSha256)
      throw new PublicOnboardingError(
        "Profile changed. Reopen the original profile for recovery.",
      );
    const loaded = await loadPublicDeploymentProfile(config.profileUrl, {
      profileSha256: config.profileSha256,
      installedProfileSha256: installed ?? undefined,
      fetch: transport.fetch,
    });
    transport.setAuthenticatedOrigin(
      loaded.assets.verifiedManifest.control_api_origin,
    );
    let preflight: PublicPreflightResult | null = null,
      readiness: ServiceReadiness | null = null,
      closed = false,
      unavailableComponent: string | null = null;
    const refreshPreflight = async () => {
      readiness = null;
      try {
        preflight = await preflightPublicDeployment(loaded);
        unavailableComponent = null;
      } catch (error) {
        preflight = null;
        unavailableComponent =
          error instanceof PublicProfileError ? error.component : "unavailable";
        if (installed === null) throw error;
      }
      if (preflight) {
        try {
          readiness = await serviceReadiness(loaded, transport.fetch);
        } catch {
          unavailableComponent = "readiness";
        }
      }
      return { preflight, readiness, unavailableComponent };
    };
    await refreshPreflight();
    await retainProfileBinding(config, storageName, account, initialize);
    return {
      options: publicProfileClientOptions(loaded),
      assets: loaded.assets,
      loaded,
      refreshPreflight,
      get diagnostic() {
        return { preflight, readiness, unavailableComponent };
      },
      get canAdmit() {
        return (
          !closed &&
          preflight?.chainAllowsNewOperations === true &&
          readiness?.servicesAvailable === true &&
          readiness.admission === "enabled" &&
          (!readiness.invitationRequired || transport.available)
        );
      },
      get freshAdmission() {
        return readiness !== null && readiness.expiresAt > Date.now();
      },
      clear() {
        closed = true;
        transport.clear();
      },
    };
  } catch (error) {
    transport.clear();
    if (error instanceof PublicProfileError) throw connectionCheckError(error);
    throw error;
  }
}
