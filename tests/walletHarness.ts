// Test-only Wallet Standard wallet. Never bundled into the production app.
import { getWallets } from "@wallet-standard/app";
import type { Wallet } from "@wallet-standard/base";
import { listWallets, connectWallet } from "../src/lib/zkapi";
import {
  selectConnectedAccount,
  disconnectSelectedWallet,
} from "../src/lib/walletConnector";

export async function runWalletLifecycle(failureCode?: number) {
  const unregister = registerTestWallet(failureCode);
  try {
    const wallet = listWallets().find(
      (wallet) => wallet.name === "Integration Test Wallet",
    )!;
    const accounts = await connectWallet(wallet);
    selectConnectedAccount(wallet, accounts[0]);
    const sameAccount = accounts[0] === wallet.accounts[0];
    await disconnectSelectedWallet();
    return {
      sameAccount,
      address: accounts[0].address,
      remaining: wallet.accounts.length,
    };
  } finally {
    unregister();
  }
}
export function registerTestWallet(failureCode?: number) {
  const account = Object.freeze({
    address: "11111111111111111111111111111111",
    publicKey: new Uint8Array(32),
    chains: ["solana:devnet"] as const,
    features: ["solana:signTransaction"] as const,
  });
  let accounts: readonly (typeof account)[] = [];
  const listeners = new Set<(value: { accounts: typeof accounts }) => void>();
  const update = () => listeners.forEach((fn) => fn({ accounts }));
  const wallet = {
    version: "1.0.0",
    name: "Integration Test Wallet",
    icon: 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>',
    chains: ["solana:devnet"],
    get accounts() {
      return accounts;
    },
    features: {
      "standard:connect": {
        version: "1.0.0",
        async connect() {
          if (failureCode !== undefined)
            throw Object.assign(new Error("Unexpected error"), {
              code: failureCode,
            });
          accounts = [account];
          update();
          return { accounts };
        },
      },
      "standard:disconnect": {
        version: "1.0.0",
        async disconnect() {
          accounts = [];
          update();
        },
      },
      "standard:events": {
        version: "1.0.0",
        on(_event: string, fn: (value: { accounts: typeof accounts }) => void) {
          listeners.add(fn);
          return () => listeners.delete(fn);
        },
      },
      "solana:signTransaction": {
        version: "1.0.0",
        supportedTransactionVersions: [0],
        async signTransaction() {
          throw new Error("No signing in this fixture");
        },
      },
    },
  } as const;
  return getWallets().register(wallet as unknown as Wallet);
}
