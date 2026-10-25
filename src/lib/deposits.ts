import type { ClientStatus, ClientStorage } from "@zkapi/solana-sdk";
import { openBrowserStorage } from "@zkapi/solana-sdk/browser";
import { EncryptedJournal } from "@zkapi/solana-sdk/journal";

import { SDK_STORAGE_VERSION } from "./sdkVersion";
export const ORIGINAL_NOTE_ID = `zkchat-note-sdk-${SDK_STORAGE_VERSION}`;
export const CATALOG_ID = "zkchat-deposit-catalog-v1";
export class DepositError extends Error {}
export interface SavedDeposit {
  id: string;
  createdAt: number | null;
}
/** SDK journal status read at list refresh time; never an aggregate balance or
 * a claim that an unobserved on-chain transaction has completed. */
export interface SavedDepositSummary extends SavedDeposit {
  status: ClientStatus | null;
  checkedAt: number | null;
}
export interface CatalogValue {
  schema: 1;
  selectedId: string;
  deposits: SavedDeposit[];
}
export function validateCatalog(value: unknown): asserts value is CatalogValue {
  const v = value as CatalogValue | null;
  if (
    !v ||
    v.schema !== 1 ||
    !Array.isArray(v.deposits) ||
    !v.deposits.length ||
    v.deposits[0]?.id !== ORIGINAL_NOTE_ID ||
    v.deposits.some(
      (d) =>
        !d ||
        typeof d.id !== "string" ||
        (d.id !== ORIGINAL_NOTE_ID &&
          !/^zkchat-deposit-[0-9a-f-]{36}$/.test(d.id)) ||
        (d.createdAt !== null &&
          (!Number.isSafeInteger(d.createdAt) || d.createdAt < 0)),
    ) ||
    new Set(v.deposits.map((d) => d.id)).size !== v.deposits.length ||
    !v.deposits.some((d) => d.id === v.selectedId)
  )
    throw new DepositError(
      "Saved deposits could not be read. Keep browser data and reconnect with the original account.",
    );
}

/** The catalog lives alongside the notes in the SAME encrypted SDK custody.
 * It stores local IDs only; all balances, signatures and recovery stay in the SDK.
 * An absent catalog adopts the original ID, never a fresh financial note.
 */
export function createDepositCatalog(
  storage: ClientStorage,
  context: { deploymentId: string; pool: string },
  close = () => {},
) {
  const journal = new EncryptedJournal<CatalogValue>(
    storage.store,
    storage.key,
    context,
    validateCatalog,
  );
  const initial = (): CatalogValue => ({
    schema: 1,
    selectedId: ORIGINAL_NOTE_ID,
    deposits: [{ id: ORIGINAL_NOTE_ID, createdAt: null }],
  });
  return {
    async read() {
      return (await journal.read(CATALOG_ID))?.value ?? initial();
    },
    // All app mutations and selection changes share this cross-tab lock.
    withLock<T>(action: () => Promise<T>): Promise<T> {
      return journal.withNoteLock(CATALOG_ID, action);
    },
    async save(value: CatalogValue) {
      validateCatalog(value);
      const previous = await journal.read(CATALOG_ID);
      if (previous)
        await journal.compareAndSwap(CATALOG_ID, previous.revision, value);
      else await journal.create(CATALOG_ID, value);
    },
    close,
  };
}
export async function openDepositCatalog(
  storageName: string,
  deploymentId: string,
  pool: string,
  account: string,
) {
  // createBrowserClient has already verified and opened this custody. Never reset it.
  const storage = await openBrowserStorage(
    JSON.stringify([storageName, deploymentId, pool, account]),
  );
  return createDepositCatalog(storage, { deploymentId, pool }, storage.close);
}
export type DepositCatalog = Awaited<ReturnType<typeof openDepositCatalog>>;

export function canChangeDeposit(status: ClientStatus | null): boolean {
  return (
    !!status &&
    !status.busy &&
    !status.session &&
    !status.walletOperation &&
    status.wallet !== "pending_escape" &&
    (!status.emergencyEscape || status.emergencyEscape.phase === "settled")
  );
}
export function canAddDeposit(status: ClientStatus | null): boolean {
  return (
    canChangeDeposit(status) &&
    (status?.wallet === "active" || status?.wallet === "closed")
  );
}
export function hasLowBalance(status: ClientStatus | null): boolean {
  return (
    status?.wallet === "active" &&
    !status.session &&
    BigInt(status.settledBalanceMicroUsdc) <
      BigInt(status.authorizationCapMicroUsdc)
  );
}
