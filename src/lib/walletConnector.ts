import { createClient } from "@solana/kit";
import { walletWithoutSigner } from "@solana/kit-plugin-wallet";
import { getWalletForHandle } from "@wallet-standard/ui-registry";
import type { AppWallet, StandardAccount } from "./zkapi";
import { walletConnectionError, WalletConnectionError } from "./walletErrors";

function createConnector() {
  return createClient().use(
    walletWithoutSigner({
      chain: "solana:devnet",
      autoConnect: false,
      storage: null,
      filter: (wallet) => wallet.features.includes("solana:signTransaction"),
    }),
  );
}
let connector: ReturnType<typeof createConnector> | undefined;
const getConnector = () => (connector ??= createConnector());

export function discoveredWallets(): AppWallet[] {
  return getConnector()
    .wallet.getState()
    .wallets.map(
      (wallet) => getWalletForHandle(wallet) as unknown as AppWallet,
    );
}
export function subscribeWallets(listener: () => void) {
  return getConnector().wallet.subscribe(listener);
}
export async function connectSelectedWallet(wallet: AppWallet) {
  const client = getConnector();
  const selected = client.wallet
    .getState()
    .wallets.find(
      (candidate) => (getWalletForHandle(candidate) as unknown) === wallet,
    );
  if (!selected)
    throw new WalletConnectionError(
      "The selected wallet is no longer available. Reload the page to discover it again.",
    );
  try {
    await client.wallet.connect(selected);
  } catch (error) {
    const failure = walletConnectionError(wallet.name, error);
    if (import.meta.env.DEV)
      console.warn("Wallet connection error", failure.code, failure.message);
    throw failure;
  }
}
export function getConnectedWalletAccount(
  wallet: AppWallet,
): StandardAccount | null {
  const connected = getConnector().wallet.getState().connected;
  if (
    !connected ||
    (getWalletForHandle(connected.wallet) as unknown) !== wallet
  )
    return null;
  // Preserve the wallet's original account object: signing adapters can require
  // reference identity, while the connector exposes a Wallet Standard UI copy.
  return (
    wallet.accounts.find(
      (candidate) => candidate.address === connected.account.address,
    ) ?? null
  );
}

/** Validate the connection without overriding the account chosen at connect. */
export function selectConnectedAccount(
  wallet: AppWallet,
  account: StandardAccount,
) {
  const selected = getConnectedWalletAccount(wallet);
  if (!selected)
    throw new WalletConnectionError("Reconnect the selected wallet first.");
  if (selected !== account)
    throw new WalletConnectionError(
      "Your wallet account changed. Connect again to continue with the active account.",
    );
}
export async function disconnectSelectedWallet() {
  await getConnector().wallet.disconnect();
}
