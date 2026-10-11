// Vite selects the original SDK for the separate recovery build, including its worker.
export const LEGACY_SDK_VERSION = "0.2.0-devnet.3";
export const SDK_VERSION: string =
  import.meta.env.VITE_ZKCHAT_SDK_VERSION ?? "0.2.0-devnet.12";
export const RECOVERY_RUNTIME = SDK_VERSION === LEGACY_SDK_VERSION;
// Custody identity is independent of the installed SDK. .12 opens the existing
// .8 profile binding, encrypted journals and deposit catalog without migration.
export const SDK_STORAGE_VERSION = RECOVERY_RUNTIME
  ? LEGACY_SDK_VERSION
  : "0.2.0-devnet.8";
export const SDK_STORAGE_NAME = `zkchat-sdk-${SDK_STORAGE_VERSION}`;
export const LEGACY_STORAGE_NAME = `zkchat-sdk-${LEGACY_SDK_VERSION}`;
