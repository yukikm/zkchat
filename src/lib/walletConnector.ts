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
export function selectConnectedAccount(
  wallet: AppWallet,
  account: StandardAccount,
) {
  const client = getConnector();
  const connected = client.wallet.getState().connected;
  if (
    !connected ||
    (getWalletForHandle(connected.wallet) as unknown) !== wallet
  )
    throw new WalletConnectionError("Reconnect the selected wallet first.");
  const selected = connected.wallet.accounts.find(
    (candidate) => candidate.address === account.address,
  );
  if (!selected)
    throw new WalletConnectionError(
      "The selected account is no longer available. Reconnect the wallet to select it again.",
    );
  client.wallet.selectAccount(selected);
}
export async function disconnectSelectedWallet() {
  await getConnector().wallet.disconnect();
}
