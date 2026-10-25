import type { ClientStorage } from "@zkapi/solana-sdk";
import {
  BrowserStorageMissing,
  openBrowserStorage,
} from "@zkapi/solana-sdk/browser";
import {
  validateNoteJournal,
  type NoteJournal,
} from "@zkapi/solana-sdk/control";
import {
  EncryptedJournal,
  JournalConflictError,
} from "@zkapi/solana-sdk/journal";
import {
  createRecoveryKit,
  createRecoveryStorage,
  openRecoveryStorage,
  parseRecoveryKit,
  restoreRecoveryStorage,
  serializeRecoveryKit,
  RecoveryStorageError,
  type RecoveryKit,
  type RecoverySession,
  type RecoveryStorage,
} from "@zkapi/solana-sdk/recovery";
import {
  loadRecoverySession,
  saveRecoverySession,
} from "@zkapi/solana-sdk/recovery-browser";
import {
  CATALOG_ID,
  createDepositCatalog,
  validateCatalog,
  type CatalogValue,
} from "./deposits";

export type { RecoveryStorage } from "@zkapi/solana-sdk/recovery";
export const RECOVERY_SUPPORTED = true;
/** Installed application trust pin. Imported files cannot choose a service. */
export const RECOVERY_ENDPOINT =
  "https://d366buuvadnp3.cloudfront.net/recovery/v1";
const INTENT_ID = "zkchat-recovery-enrollment-intent-v1";
const COMPLETE_ID = "zkchat-recovery-enrollment-complete-v1";

export interface DepositRecoveryContext {
  storageName: string;
  deploymentId: string;
  pool: string;
  wallet: string;
  profileSha256: string;
}
export interface RecoveryCallOptions {
  fetch?: typeof fetch;
}
export interface RecoveryTransferOptions extends RecoveryCallOptions {
  previousOwnerStopped: true;
}
export type LocalRecoverySource = Awaited<
  ReturnType<typeof openBrowserStorage>
>;
export class RecoveryError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "RecoveryError";
  }
}
export class RecoverySetupIncomplete extends RecoveryError {
  constructor() {
    super(
      "Backup setup was interrupted. Use your saved recovery file in the original browser to finish setup. Your original deposit data is kept.",
    );
    this.name = "RecoverySetupIncomplete";
  }
}
export class RecoveryAccessMoved extends RecoveryError {
  constructor() {
    super(
      "Access to these deposits moved to another browser. Use that browser, or restore here with your recovery file after closing zkChat on other devices.",
    );
    this.name = "RecoveryAccessMoved";
  }
}
interface Marker {
  schema: 1;
  vaultId: string;
  endpoint: string;
  context: { deploymentId: string; pool: string; wallet: string };
  profileSha256: string;
  /** Only the completion record has this field. Additional deposits remain in the live catalog. */
  requiredNoteIds?: string[];
}
function checkedContext(value: DepositRecoveryContext): DepositRecoveryContext {
  if (
    !value ||
    [value.storageName, value.deploymentId, value.pool, value.wallet].some(
      (v) => typeof v !== "string" || !v.length || v.length > 256,
    ) ||
    !/^[0-9a-f]{64}$/.test(value.profileSha256)
  )
    throw new RecoveryError(
      "This recovery setup does not match a verified payment deployment.",
    );
  return { ...value };
}
function baseContext(c: DepositRecoveryContext) {
  return { deploymentId: c.deploymentId, pool: c.pool, wallet: c.wallet };
}
function sameContext(
  a: { deploymentId: string; pool: string; wallet: string },
  b: DepositRecoveryContext,
): boolean {
  return (
    a.deploymentId === b.deploymentId &&
    a.pool === b.pool &&
    a.wallet === b.wallet
  );
}
function bindingName(c: DepositRecoveryContext): string {
  return JSON.stringify([
    "zkchat-recovery-v1",
    c.storageName,
    c.deploymentId,
    c.pool,
    c.wallet,
  ]);
}
function marker(
  c: DepositRecoveryContext,
  kit: Pick<RecoveryKit, "vaultId">,
  requiredNoteIds?: string[],
): Marker {
  return {
    schema: 1,
    vaultId: kit.vaultId,
    endpoint: RECOVERY_ENDPOINT,
    context: baseContext(c),
    profileSha256: c.profileSha256,
    ...(requiredNoteIds ? { requiredNoteIds: [...requiredNoteIds] } : {}),
  };
}
function validateMarker(value: unknown): asserts value is Marker {
  const v = value as Marker;
  if (
    !v ||
    v.schema !== 1 ||
    !/^[0-9a-f]{64}$/.test(v.vaultId) ||
    v.endpoint !== RECOVERY_ENDPOINT ||
    !v.context ||
    typeof v.context.deploymentId !== "string" ||
    typeof v.context.pool !== "string" ||
    typeof v.context.wallet !== "string" ||
    !/^[0-9a-f]{64}$/.test(v.profileSha256) ||
    (v.requiredNoteIds !== undefined &&
      (!Array.isArray(v.requiredNoteIds) ||
        v.requiredNoteIds.some((id) => typeof id !== "string" || !id.length) ||
        new Set(v.requiredNoteIds).size !== v.requiredNoteIds.length))
  )
    throw new RecoveryError(
      "The saved recovery setup could not be verified. Keep your original data.",
    );
}
function checkMarker(
  value: Marker,
  c: DepositRecoveryContext,
  vaultId?: string,
): void {
  validateMarker(value);
  if (
    !sameContext(value.context, c) ||
    value.profileSha256 !== c.profileSha256 ||
    (vaultId && value.vaultId !== vaultId)
  )
    throw new RecoveryError(
      "This browser already holds a different recovery setup. Use its original recovery file and payment deployment.",
    );
}
function markerJournal(storage: ClientStorage, c: DepositRecoveryContext) {
  return new EncryptedJournal<Marker>(
    storage.store,
    storage.key,
    c,
    validateMarker,
  );
}
function noteJournal(storage: ClientStorage, c: DepositRecoveryContext) {
  return new EncryptedJournal<NoteJournal>(
    storage.store,
    storage.key,
    c,
    validateNoteJournal,
  );
}
function catalogJournal(storage: ClientStorage, c: DepositRecoveryContext) {
  return new EncryptedJournal<CatalogValue>(
    storage.store,
    storage.key,
    c,
    validateCatalog,
  );
}
function checkSession(
  session: RecoverySession,
  c: DepositRecoveryContext,
  vaultId?: string,
): void {
  if (
    session.endpoint !== RECOVERY_ENDPOINT ||
    !sameContext(session.context, c) ||
    (vaultId && session.vaultId !== vaultId)
  )
    throw new RecoveryError(
      "This browser already holds a different recovery setup. Keep its existing deposits and recovery file.",
    );
}
function parseFile(c: DepositRecoveryContext, text: string): RecoveryKit {
  let kit: RecoveryKit;
  try {
    kit = parseRecoveryKit(text);
  } catch {
    throw new RecoveryError("Choose a valid zkChat recovery file.");
  }
  if (kit.endpoint !== RECOVERY_ENDPOINT)
    throw new RecoveryError(
      "This recovery file uses a different backup service.",
    );
  if (kit.context.wallet !== c.wallet)
    throw new RecoveryError(
      "Connect the wallet used for these deposits, then choose the recovery file again.",
    );
  if (!sameContext(kit.context, c))
    throw new RecoveryError(
      "This recovery file belongs to a different payment deployment. Open its original app.",
    );
  return kit;
}
function requireStopped(options: RecoveryTransferOptions): void {
  if (options.previousOwnerStopped !== true)
    throw new RecoveryError(
      "Close zkChat in your other tabs and devices before continuing.",
    );
}
export function createRecoveryFile(context: DepositRecoveryContext): string {
  const c = checkedContext(context);
  return serializeRecoveryKit(
    createRecoveryKit({ endpoint: RECOVERY_ENDPOINT, context: baseContext(c) }),
  );
}
/** Opens original custody only. Never creates a replacement key. Caller closes it. */
export async function openLocalRecoverySource(
  context: DepositRecoveryContext,
): Promise<LocalRecoverySource> {
  const c = checkedContext(context);
  return openBrowserStorage(
    JSON.stringify([c.storageName, c.deploymentId, c.pool, c.wallet]),
  );
}
async function optionalSource(
  c: DepositRecoveryContext,
): Promise<LocalRecoverySource | null> {
  try {
    return await openLocalRecoverySource(c);
  } catch (error) {
    if (error instanceof BrowserStorageMissing) return null;
    throw error;
  }
}
async function checkSource(
  c: DepositRecoveryContext,
  source: ClientStorage,
  vaultId?: string,
  rejectUnmigrated = false,
): Promise<Marker | null> {
  const intent =
    (await markerJournal(source, c).read(INTENT_ID))?.value ?? null;
  if (intent) checkMarker(intent, c, vaultId);
  else if (rejectUnmigrated) {
    const catalog = await createDepositCatalog(source, c).read(),
      notes = noteJournal(source, c);
    for (const deposit of catalog.deposits)
      if (await notes.read(deposit.id))
        throw new RecoveryError(
          "This browser has deposits that are not in this recovery setup. Protect or withdraw them before restoring another backup.",
        );
  }
  return intent;
}
/** Read-only checks before stopping a usable client. Ownership and bindings are
 * checked again by enrollment/restoration under their mutation lock. */
export async function validateRecoveryFile(
  context: DepositRecoveryContext,
  fileText: string,
  finishSetup = false,
): Promise<void> {
  const c = checkedContext(context),
    kit = parseFile(c, fileText),
    existing = await loadRecoverySession(bindingName(c));
  if (existing) checkSession(existing.session, c, kit.vaultId);
  const source = finishSetup
    ? await openLocalRecoverySource(c)
    : await optionalSource(c);
  try {
    if (source)
      await createDepositCatalog(source, c).withLock(async () => {
        await checkSource(c, source, kit.vaultId, !finishSetup);
      });
  } finally {
    source?.close();
  }
}
async function verifyComplete(
  c: DepositRecoveryContext,
  storage: RecoveryStorage,
): Promise<void> {
  const complete = (await markerJournal(storage, c).read(COMPLETE_ID))?.value;
  if (!complete || complete.requiredNoteIds === undefined)
    throw new RecoverySetupIncomplete();
  checkMarker(complete, c, storage.session.vaultId);
  const catalog = await catalogJournal(storage, c).read(CATALOG_ID);
  if (!catalog) throw new RecoverySetupIncomplete();
  const ids = new Set(catalog.value.deposits.map((d) => d.id)),
    notes = noteJournal(storage, c);
  for (const id of complete.requiredNoteIds)
    if (!ids.has(id) || !(await notes.read(id)))
      throw new RecoveryError(
        "The deposit backup is incomplete. Keep the original browser data and recovery file.",
      );
  // Validate every currently saved financial record, including deposits added later.
  for (const deposit of catalog.value.deposits) await notes.read(deposit.id);
}
/** A missing binding cannot revive local custody after enrollment has started. */
export async function getRecoveryStorage(
  context: DepositRecoveryContext,
  options: RecoveryCallOptions = {},
): Promise<RecoveryStorage | null> {
  const c = checkedContext(context),
    local = await loadRecoverySession(bindingName(c)),
    source = await optionalSource(c);
  try {
    if (local) checkSession(local.session, c);
    const intent = source
      ? await checkSource(c, source, local?.session.vaultId)
      : null;
    if (!local) {
      if (intent) throw new RecoverySetupIncomplete();
      return null;
    }
    // Binding persistence precedes the source fence. A crash between those
    // writes must offer same-file enrollment, never accept the backup as done.
    if (source && !intent) throw new RecoverySetupIncomplete();
  } finally {
    source?.close();
  }
  let opened: RecoveryStorage | undefined;
  try {
    opened = await openRecoveryStorage(local.session, {
      key: local.key,
      expectedEndpoint: RECOVERY_ENDPOINT,
      fetch: options.fetch,
    });
    await verifyComplete(c, opened);
    return opened;
  } catch (error) {
    opened?.close();
    if (
      error instanceof RecoveryStorageError &&
      error.code === "ownership_changed"
    )
      throw new RecoveryAccessMoved();
    throw error;
  }
}
/** Caller holds the original catalog lock, so this check and mutation cannot race enrollment. */
export async function assertLocalRecoveryNotMoved(
  context: DepositRecoveryContext,
): Promise<void> {
  const c = checkedContext(context);
  if (await loadRecoverySession(bindingName(c)))
    throw new RecoverySetupIncomplete();
  const source = await openLocalRecoverySource(c);
  try {
    if (await checkSource(c, source)) throw new RecoverySetupIncomplete();
  } finally {
    source.close();
  }
}
/** Caller must quiesce/dispose its client first; this function owns the source catalog lock.
 * The kit is never persisted. Its device binding and encrypted intent fence local
 * writes before the first copy. A completion record commits enrollment last. */
export async function enrollRecovery(
  context: DepositRecoveryContext,
  fileText: string,
  source: ClientStorage,
  options: RecoveryTransferOptions,
): Promise<RecoveryStorage> {
  const c = checkedContext(context);
  requireStopped(options);
  const kit = parseFile(c, fileText);
  return createDepositCatalog(source, c).withLock(async () => {
    const existing = await loadRecoverySession(bindingName(c));
    if (existing) checkSession(existing.session, c, kit.vaultId);
    const intent = await checkSource(c, source, kit.vaultId);
    let target: RecoveryStorage;
    if (existing || intent)
      target = await restoreRecoveryStorage(kit, {
        ...options,
        expectedEndpoint: RECOVERY_ENDPOINT,
      });
    else {
      try {
        target = await createRecoveryStorage(kit, { fetch: options.fetch });
      } catch (error) {
        if (!(error instanceof JournalConflictError)) throw error;
        target = await restoreRecoveryStorage(kit, {
          ...options,
          expectedEndpoint: RECOVERY_ENDPOINT,
        });
      }
    }
    try {
      const remoteMarker = markerJournal(target, c),
        completed = await remoteMarker.read(COMPLETE_ID);
      if (completed && !existing && !intent)
        throw new RecoveryError(
          "This recovery file already protects other deposits. Use Restore deposits to open it without replacing this browser's deposits.",
        );
      // Save before copying so a reload cannot silently fall back to local writes.
      await saveRecoverySession(bindingName(c), target.session, {
        replaceOwner: true,
      });
      const originalMarker = markerJournal(source, c);
      if (!intent) await originalMarker.create(INTENT_ID, marker(c, kit));
      if (completed) {
        await verifyComplete(c, target);
        return target;
      }
      const catalog = createDepositCatalog(source, c),
        saved = await catalog.read(),
        notes = noteJournal(source, c);
      const requiredNoteIds: string[] = [];
      for (const deposit of saved.deposits) {
        const copied = await notes.copyTo(deposit.id, target);
        if (copied) requiredNoteIds.push(deposit.id);
      }
      const destinationCatalog = catalogJournal(target, c),
        existingCatalog = await destinationCatalog.read(CATALOG_ID);
      if (existingCatalog) {
        if (JSON.stringify(existingCatalog.value) !== JSON.stringify(saved))
          throw new RecoveryError(
            "The saved deposit lists differ. Keep both copies and reconnect without creating new deposits.",
          );
      } else await destinationCatalog.create(CATALOG_ID, saved);
      await remoteMarker.create(COMPLETE_ID, marker(c, kit, requiredNoteIds));
      await verifyComplete(c, target);
      return target;
    } catch (error) {
      target.close();
      throw error;
    }
  });
}
/** Restores only a completed backup for the independently verified current app/profile. */
export async function restoreDeposits(
  context: DepositRecoveryContext,
  fileText: string,
  options: RecoveryTransferOptions,
): Promise<RecoveryStorage> {
  const c = checkedContext(context);
  requireStopped(options);
  const kit = parseFile(c, fileText);
  const existing = await loadRecoverySession(bindingName(c));
  if (existing) checkSession(existing.session, c, kit.vaultId);
  const source = await optionalSource(c);
  const restore = async () => {
    const intent = source
      ? await checkSource(c, source, kit.vaultId, true)
      : null;
    const target = await restoreRecoveryStorage(kit, {
      ...options,
      expectedEndpoint: RECOVERY_ENDPOINT,
    });
    try {
      await verifyComplete(c, target);
      // An already initialized, empty browser also keeps an independent fence
      // if its separate recovery-binding database is later lost.
      if (source && !intent)
        await markerJournal(source, c).create(INTENT_ID, marker(c, kit));
      await saveRecoverySession(bindingName(c), target.session, {
        replaceOwner: true,
      });
      return target;
    } catch (error) {
      target.close();
      throw error;
    }
  };
  try {
    return source
      ? await createDepositCatalog(source, c).withLock(restore)
      : await restore();
  } finally {
    source?.close();
  }
}
