/** Retired SDKs retain their original custody. They have no portable recovery exports. */
import type { ClientStorage } from "@zkapi/solana-sdk";
import type {
  DepositRecoveryContext,
  RecoveryCallOptions,
  RecoveryTransferOptions,
  RecoveryStorage,
  LocalRecoverySource,
} from "./currentRecovery";
export type {
  DepositRecoveryContext,
  RecoveryCallOptions,
  RecoveryTransferOptions,
  RecoveryStorage,
  LocalRecoverySource,
} from "./currentRecovery";
export const RECOVERY_SUPPORTED = false;
export const RECOVERY_ENDPOINT = "";
export class RecoveryError extends Error {
  constructor(
    message = "Portable recovery is available in the current app only.",
  ) {
    super(message);
    this.name = "RecoveryError";
  }
}
export class RecoverySetupIncomplete extends RecoveryError {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateRecoveryFile(
  _context: DepositRecoveryContext,
  _file: string,
  _finishSetup = false,
): Promise<void> {
  throw new RecoveryError();
}
export function createRecoveryFile(_context: DepositRecoveryContext): string {
  throw new RecoveryError();
}
export async function getRecoveryStorage(
  _context: DepositRecoveryContext,
  _options?: RecoveryCallOptions,
): Promise<RecoveryStorage | null> {
  return null;
}
export async function assertLocalRecoveryNotMoved(
  _context: DepositRecoveryContext,
): Promise<void> {}
export async function openLocalRecoverySource(
  _context: DepositRecoveryContext,
): Promise<LocalRecoverySource> {
  throw new RecoveryError();
}
export async function enrollRecovery(
  _context: DepositRecoveryContext,
  _file: string,
  _source: ClientStorage,
  _options: RecoveryTransferOptions,
): Promise<RecoveryStorage> {
  throw new RecoveryError();
}
export async function restoreDeposits(
  _context: DepositRecoveryContext,
  _file: string,
  _options: RecoveryTransferOptions,
): Promise<RecoveryStorage> {
  throw new RecoveryError();
}
