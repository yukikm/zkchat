import { openBrowserStorage } from "@zkapi/solana-sdk/browser";
import {
  ControlClient,
  validateNoteJournal,
  type NoteJournal,
} from "@zkapi/solana-sdk/control";
import { EncryptedJournal } from "@zkapi/solana-sdk/journal";
import { RecoveryStorageError } from "@zkapi/solana-sdk/recovery";
import { loadRecoverySession } from "@zkapi/solana-sdk/recovery-browser";
import type { ClientStorage } from "@zkapi/solana-sdk";
import {
  assertLocalRecoveryNotMoved,
  createRecoveryFile,
  enrollRecovery,
  getRecoveryStorage,
  restoreDeposits,
  RecoveryAccessMoved,
  RecoverySetupIncomplete,
  type RecoveryStorage,
} from "../../src/lib/currentRecovery";
import { createDepositCatalog, ORIGINAL_NOTE_ID } from "../../src/lib/deposits";
import {
  fundedNote,
  pendingNote,
  recoveryContext,
  secondNoteId,
  thirdNoteId,
} from "./recoveryData";

const context = {
  ...recoveryContext,
  // Stable for this Pool across browser/SDK changes, independent of old Pools.
  storageName: "zkchat-sdk-synthetic-nonexpiring-pool-v1",
  deploymentId: "synthetic-nonexpiring-recovery-deployment",
  pool: "synthetic-nonexpiring-pool",
  profileSha256: "cd".repeat(32),
};
const expiry = "18446744073709551615";
let heldOwner: RecoveryStorage;
let cachedRecord: Awaited<ReturnType<EncryptedJournal<NoteJournal>["read"]>>;
function notes(storage: ClientStorage) {
  return new EncryptedJournal<NoteJournal>(
    storage.store,
    storage.key,
    context,
    validateNoteJournal,
  );
}
function deposit(id: number, pending = false) {
  const note = pending ? pendingNote() : fundedNote(id);
  note.witness!.expiry = expiry;
  if (note.pending) {
    const request = note.pending.prepared.request;
    for (const binding of [request.authorization, request.quote.body]) {
      binding.deployment_id = context.deploymentId;
      binding.pool = context.pool;
    }
    note.pending.exactRequest = JSON.stringify(request);
  }
  return note;
}
async function snapshot(storage: ClientStorage) {
  const catalog = await createDepositCatalog(storage, context).read();
  return {
    catalog,
    notes: await Promise.all(
      catalog.deposits.map(async ({ id }) => {
        const record = await notes(storage).read(id);
        return {
          id,
          record: record
            ? { revision: record.revision, value: record.value }
            : null,
        };
      }),
    ),
  };
}
async function binding() {
  const saved = await loadRecoverySession(
    JSON.stringify([
      "zkchat-recovery-v1",
      context.storageName,
      context.deploymentId,
      context.pool,
      context.wallet,
    ]),
  );
  return {
    exists: !!saved,
    extractable: saved?.key.extractable,
    hasKeyHex: saved ? "keyHex" in saved.session : null,
  };
}

/** Synthetic notes, real app enrollment + SDK encryption, IndexedDB and remote CAS.
 * Keep one old owner open to verify its cached journal cannot write after takeover. */
export async function initialize() {
  const source = await openBrowserStorage(
    JSON.stringify([
      context.storageName,
      context.deploymentId,
      context.pool,
      context.wallet,
    ]),
    { initialize: true },
  );
  try {
    await notes(source).create(ORIGINAL_NOTE_ID, deposit(1));
    await notes(source).create(secondNoteId, deposit(2, true));
    await createDepositCatalog(source, context).save({
      schema: 1,
      selectedId: secondNoteId,
      deposits: [
        { id: ORIGINAL_NOTE_ID, createdAt: null },
        { id: secondNoteId, createdAt: 1792857600000 },
      ],
    });
    const before = await snapshot(source);
    const file = createRecoveryFile(context);
    heldOwner = await enrollRecovery(context, file, source, {
      previousOwnerStopped: true,
    });
    const migrated = await snapshot(heldOwner);
    await notes(heldOwner).create(thirdNoteId, deposit(3));
    const catalog = createDepositCatalog(heldOwner, context);
    const saved = await catalog.read();
    saved.deposits.push({ id: thirdNoteId, createdAt: 1792857601000 });
    saved.selectedId = thirdNoteId;
    await catalog.save(saved);
    const first = (await notes(heldOwner).read(ORIGINAL_NOTE_ID))!;
    first.value.state.balance_micro_usdc = "1994736";
    await notes(heldOwner).compareAndSwap(
      ORIGINAL_NOTE_ID,
      first.revision,
      first.value,
    );
    cachedRecord = await notes(heldOwner).read(ORIGINAL_NOTE_ID);
    return {
      context,
      file,
      before,
      migrated,
      latest: await snapshot(heldOwner),
      thirdNoteId,
      binding: await binding(),
      sourceExtractable: source.key.extractable,
    };
  } finally {
    source.close();
  }
}

export async function openState() {
  const storage = await getRecoveryStorage(context);
  try {
    return storage ? await snapshot(storage) : null;
  } finally {
    storage?.close();
  }
}

export async function rejectMismatchedFiles(file: string) {
  const result: Record<string, string> = {};
  for (const kind of ["pool", "wallet", "malformed"] as const) {
    const changed = JSON.parse(file);
    if (kind !== "malformed") changed.context[kind] = "another-context";
    try {
      (
        await restoreDeposits(
          context,
          kind === "malformed" ? "{}" : JSON.stringify(changed),
          { previousOwnerStopped: true },
        )
      ).close();
      result[kind] = "accepted";
    } catch (error) {
      result[kind] = String(error);
    }
  }
  return result;
}

export async function rejectWrongSecret(file: string) {
  const changed = JSON.parse(file);
  changed.secret =
    (changed.secret[0] === "0" ? "1" : "0") + changed.secret.slice(1);
  let rejected = false;
  try {
    (
      await restoreDeposits(context, JSON.stringify(changed), {
        previousOwnerStopped: true,
      })
    ).close();
  } catch (error) {
    rejected = error instanceof RecoveryStorageError;
  }
  return { rejected, binding: await binding() };
}

export async function restore(file: string) {
  const storage = await restoreDeposits(context, file, {
    previousOwnerStopped: true,
  });
  try {
    const restoredState = await snapshot(storage);
    const prepared = (await notes(storage).read(secondNoteId))!.value.pending!
      .prepared;
    const quote = prepared.request.quote.body;
    let financialCalls = 0;
    const field = (n: number) => "0x" + n.toString(16).padStart(64, "0");
    const control = new ControlClient({
      context: {
        deployment_id: context.deploymentId,
        pool: context.pool,
        vault_binding: field(1),
        state_key: [field(2), field(3)],
        cap_micro_usdc: "100",
        control_api_origin: quote.control_api_origin,
        inference_api_origin: quote.inference_api_origin,
        quote_public_key: "00".repeat(32),
        receipt_public_key: "00".repeat(32),
        request_vk_sha256: "00".repeat(32),
        tariff_hashes: ["33".repeat(32)],
      },
      journal: notes(storage),
      verifier: {
        async prepare() {},
        async settle() {
          throw new Error("must never settle");
        },
      },
      fetch: async () => {
        financialCalls++;
        throw new Error("unexpected financial call");
      },
      now: () => 150n,
    });
    let prepareError = "",
      sendError = "";
    try {
      await control.prepare(secondNoteId, prepared, field(14));
    } catch (error) {
      prepareError = String(error);
    }
    try {
      await control.sendDirectOperation(
        secondNoteId,
        "12345678-1234-4123-8123-123456789016",
        "/v1/chat/completions",
        new TextEncoder().encode('{"model":"fixture","messages":[]}'),
      );
    } catch (error) {
      sendError = String(error);
    }
    return {
      context,
      restoredState,
      binding: await binding(),
      prepareError,
      sendError,
      financialCalls,
    };
  } finally {
    storage.close();
  }
}

export async function oldOwnerAccess() {
  let reopened = true,
    cachedWrite = true,
    localFallback = true;
  try {
    (await getRecoveryStorage(context))?.close();
  } catch (error) {
    if (error instanceof RecoveryAccessMoved) reopened = false;
    else throw error;
  }
  try {
    const value = structuredClone(cachedRecord!.value);
    value.state.balance_micro_usdc = "1";
    await notes(heldOwner).compareAndSwap(
      ORIGINAL_NOTE_ID,
      cachedRecord!.revision,
      value,
    );
  } catch (error) {
    if (
      error instanceof RecoveryStorageError &&
      error.code === "ownership_changed"
    )
      cachedWrite = false;
    else throw error;
  } finally {
    heldOwner.close();
  }
  try {
    await assertLocalRecoveryNotMoved(context);
  } catch (error) {
    if (error instanceof RecoverySetupIncomplete) localFallback = false;
    else throw error;
  }
  return { reopened, cachedWrite, localFallback };
}
