// Vite selects the original SDK for the separate recovery build, including its worker.
export const LEGACY_SDK_VERSION = "0.2.0-devnet.3";
export const PREVIOUS_SDK_VERSION = "0.2.0-devnet.12";
export const SDK_VERSION: string =
  import.meta.env.VITE_ZKCHAT_SDK_VERSION ?? "0.2.0-devnet.16";
export const LOCAL_RECOVERY_PREVIEW = SDK_VERSION === "0.2.0-devnet.16";
export const SDK_SOURCE_URL = LOCAL_RECOVERY_PREVIEW
  ? "https://github.com/yukikm/solana-zkapi/tree/94e4969f3169bfc790fc6f4186fc2bf94dbe074a"
  : `https://github.com/yukikm/solana-zkapi/releases/tag/v${SDK_VERSION}`;
export const RECOVERY_RUNTIME = SDK_VERSION === LEGACY_SDK_VERSION;
export const PREVIOUS_RECOVERY_RUNTIME = SDK_VERSION === PREVIOUS_SDK_VERSION;
export const RETIRED_RUNTIME = RECOVERY_RUNTIME || PREVIOUS_RECOVERY_RUNTIME;
// A new Pool gets its own identity. Recovery builds retain the exact original
// names, note IDs and profile bindings; no journal is moved or reinterpreted.
export function storageVersionFor(sdkVersion: string) {
  switch (sdkVersion) {
    case LEGACY_SDK_VERSION:
      return LEGACY_SDK_VERSION;
    case PREVIOUS_SDK_VERSION:
      return "0.2.0-devnet.8";
    case "0.2.0-devnet.13":
    case "0.2.0-devnet.15":
    case "0.2.0-devnet.16":
      return "public-devnet-20261021-state-v1";
    default:
      throw new Error("Unsupported SDK runtime. Reopen the original app.");
  }
}
export const SDK_STORAGE_VERSION = storageVersionFor(SDK_VERSION);
export const SDK_STORAGE_NAME = `zkchat-sdk-${SDK_STORAGE_VERSION}`;
export const LEGACY_STORAGE_NAME = `zkchat-sdk-${LEGACY_SDK_VERSION}`;
export const PREVIOUS_STORAGE_NAME = "zkchat-sdk-0.2.0-devnet.8";
