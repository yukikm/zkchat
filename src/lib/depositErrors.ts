import { PublicProfileError } from "@zkapi/solana-sdk/public-profile";
import { AmountInputError } from "./chat";
import { DepositError } from "./deposits";
import {
  connectionCheckError,
  PublicOnboardingError,
} from "./publicDeployment";
import { WalletConnectionError } from "./walletErrors";

function isAppGuidance(error: unknown): error is Error {
  return (
    error instanceof AmountInputError ||
    error instanceof DepositError ||
    error instanceof PublicOnboardingError ||
    error instanceof WalletConnectionError
  );
}

function chainFailure(error: unknown) {
  if (!(error instanceof Error)) return null;
  if (error.message === "finalized indexer unavailable") return "unavailable";
  if (
    error.message === "RPC/indexer finalized cut changed; retry snapshot" ||
    error.message === "RPC finalized account cut block missing or invalid" ||
    error.message === "untrusted indexer root"
  )
    return "snapshot";
  return null;
}

/** Only for prepareDeposit: this SDK step cannot request a wallet signature. */
export function depositPreparationError(error: unknown): Error {
  if (isAppGuidance(error)) return error;
  if (error instanceof PublicProfileError) return connectionCheckError(error);

  // Match exact SDK diagnostics, never display arbitrary response/error text.
  const failure = chainFailure(error);
  if (failure === "unavailable")
    return new DepositError(
      "Could not prepare the deposit because the chain indexer is unavailable. No wallet signature was requested. Try Review deposit again later.",
    );
  if (failure === "snapshot")
    return new DepositError(
      "Could not verify current chain data for the deposit. No wallet signature was requested. Refresh status, then try Review deposit again later.",
    );
  return new DepositError(
    "Could not prepare the deposit. No wallet signature was requested. Refresh status, then follow the next step.",
  );
}

/** advanceWallet can sign or confirm; never infer whether funds moved here. */
export function walletStepError(error: unknown): Error {
  if (isAppGuidance(error)) return error;
  const failure = chainFailure(error);
  if (failure)
    return new DepositError(
      (failure === "unavailable"
        ? "Could not check the transaction on Solana because the chain indexer is unavailable."
        : "Could not verify current chain data for the transaction on Solana.") +
        " Keep this browser’s data and choose Refresh status, then follow the saved next step.",
    );
  return new DepositError(
    "Could not complete this step. Refresh status, then follow the next action below.",
  );
}
