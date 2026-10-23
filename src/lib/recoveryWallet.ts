import type { ClientStatus } from "@zkapi/solana-sdk";
import type { V0Wallet } from "@zkapi/solana-sdk/transport";

/** Retired Pools may confirm old deposits, but never sign a new deposit step,
 * including a replacement transaction requested during expiry recovery. */
export function recoveryWallet(
  wallet: V0Wallet,
  readStatus: () => Promise<ClientStatus | undefined>,
): V0Wallet {
  return {
    ...wallet,
    async signTransaction(transaction) {
      const status = await readStatus();
      if (
        !status?.walletOperation ||
        !["mutual_close", "initiate_escape", "finalize_escape"].includes(
          status.walletOperation.kind,
        )
      )
        throw new Error(
          "This Pool is retired. New deposit signatures are disabled; keep the saved operation for recovery.",
        );
      return wallet.signTransaction(transaction);
    },
  };
}
