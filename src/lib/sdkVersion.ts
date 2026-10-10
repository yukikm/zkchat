// Vite selects the original SDK for the separate recovery build, including its worker.
export const LEGACY_SDK_VERSION = "0.2.0-devnet.3";
export const SDK_VERSION: string =
  import.meta.env.VITE_ZKCHAT_SDK_VERSION ?? "0.2.0-devnet.8";
export const RECOVERY_RUNTIME = SDK_VERSION === LEGACY_SDK_VERSION;
export const SDK_STORAGE_NAME = `zkchat-sdk-${SDK_VERSION}`;
export const LEGACY_STORAGE_NAME = `zkchat-sdk-${LEGACY_SDK_VERSION}`;
