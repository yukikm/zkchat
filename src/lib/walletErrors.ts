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
      message = `${walletName} connection was declined. Select it again to retry.`;
      break;
    case -32002:
      message = `${walletName} has a pending request. Open the wallet to approve or dismiss it.`;
      break;
    case 4100:
      message = `${walletName} has not authorized this site. Open the wallet and allow this connection.`;
      break;
    case 4900:
      message = `${walletName} could not connect to its network. Check its network settings.`;
      break;
    default:
      message =
        code === -32603 ||
        (error instanceof Error && error.message === "Unexpected error")
          ? `${walletName} returned an internal connection error${suffix}. Unlock the wallet, then reload this page.`
          : `Could not connect to ${walletName}${suffix}. Unlock it and approve the connection.`;
  }
  return new WalletConnectionError(
    `${message} No transaction was requested.`,
    code,
    { cause: error },
  );
}
