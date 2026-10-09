export class WalletConnectionError extends Error {
  readonly name = "WalletConnectionError";
  constructor(
    message: string,
    readonly code: number | null = null,
    options?: ErrorOptions,
  ) {
    super(message, options);
  }
}

// Show only known wallet messages/codes, never arbitrary provider payloads.
export function walletConnectionError(walletName: string, error: unknown) {
  if (error instanceof WalletConnectionError) return error;
  const code =
    error &&
    typeof error === "object" &&
    "code" in error &&
    typeof error.code === "number" &&
    Number.isSafeInteger(error.code)
      ? error.code
      : null;
  const suffix = code === null ? "" : ` (code ${code})`;
  let message: string;
  switch (code) {
    case 4001:
      message = `${walletName} connection was declined. Select the wallet again when you are ready.`;
      break;
    case -32002:
      message = `${walletName} already has a pending request. Open its window and approve or dismiss that request before trying again.`;
      break;
    case 4100:
      message = `${walletName} has not authorized this site or account. Open the wallet and review its connection permissions.`;
      break;
    case 4900:
      message = `${walletName} could not connect to its network. Check the wallet's connection before trying again.`;
      break;
    default:
      message =
        code === -32603 ||
        (error instanceof Error && error.message === "Unexpected error")
          ? `${walletName} returned an internal connection error${suffix}. Open and unlock the wallet, then reload this page before trying again.`
          : `Could not connect to ${walletName}${suffix}. Open and unlock the wallet, then review its connection request.`;
  }
  return new WalletConnectionError(
    `${message} No transaction was requested.`,
    code,
    { cause: error },
  );
}
