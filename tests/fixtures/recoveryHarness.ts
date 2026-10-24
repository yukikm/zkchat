import { openBrowserStorage } from "@zkapi/solana-sdk/browser";
import {
  ControlClient,
  type VerificationContext,
} from "@zkapi/solana-sdk/control";
import { loadRecoverySession } from "@zkapi/solana-sdk/recovery-browser";
import {
  createRecoveryFile,
  enrollRecovery,
  getRecoveryStorage,
  restoreDeposits,
  RecoverySetupIncomplete,
} from "../../src/lib/currentRecovery";
import {
  addLaterDeposit,
  noteJournal,
  recoveryContext as context,
  secondNoteId,
  seedDeposits,
  snapshotDeposits,
} from "./recoveryData";

/** Imported through Vite by a blank test page. Uses real Chromium IndexedDB,
 * nonextractable CryptoKeys and the published SDK, with no wallet or paid API. */
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
  const before = await seedDeposits(source),
    file = createRecoveryFile(context);
  const target = await enrollRecovery(context, file, source, {
    previousOwnerStopped: true,
  });
  try {
    const migrated = await snapshotDeposits(target);
    const latest = await addLaterDeposit(target);
    return {
      file,
      before,
      migrated,
      latest,
      sourceExtractable: source.key.extractable,
      binding: await binding(),
    };
  } finally {
    target.close();
    source.close();
  }
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
export async function restore(file: string) {
  const restored = await restoreDeposits(context, file, {
    previousOwnerStopped: true,
  });
  try {
    const restoredState = await snapshotDeposits(restored);
    const note = (await noteJournal(restored).read(secondNoteId))!.value;
    const prepared = note.pending!.prepared,
      q = prepared.request.quote.body;
    const verification: VerificationContext = {
      deployment_id: context.deploymentId,
      pool: context.pool,
      vault_binding: "0x" + "01".padStart(64, "0"),
      state_key: ["0x" + "02".padStart(64, "0"), "0x" + "03".padStart(64, "0")],
      cap_micro_usdc: "100",
      control_api_origin: q.control_api_origin,
      inference_api_origin: q.inference_api_origin,
      quote_public_key: "00".repeat(32),
      receipt_public_key: "00".repeat(32),
      request_vk_sha256: "00".repeat(32),
      tariff_hashes: ["33".repeat(32)],
    };
    let financialCalls = 0;
    const control = new ControlClient({
      context: verification,
      journal: noteJournal(restored),
      verifier: {
        async prepare() {},
        async settle() {
          throw new Error("fixture must never settle");
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
      await control.prepare(
        secondNoteId,
        prepared,
        "0x" + "0e".padStart(64, "0"),
      );
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
      restoredState,
      binding: await binding(),
      prepareError,
      sendError,
      financialCalls,
    };
  } finally {
    restored.close();
  }
}
export async function openState() {
  const storage = await getRecoveryStorage(context);
  try {
    return storage ? await snapshotDeposits(storage) : null;
  } finally {
    storage?.close();
  }
}
export async function bindingLost() {
  await new Promise<void>((resolve, reject) => {
    const request = indexedDB.deleteDatabase("zkapi-recovery-bindings-v1");
    request.onsuccess = () => resolve();
    request.onerror = () => reject(request.error);
    request.onblocked = () =>
      reject(new Error("binding database is still open"));
  });
  try {
    await getRecoveryStorage(context);
    return { blocked: false };
  } catch (error) {
    return { blocked: error instanceof RecoverySetupIncomplete };
  }
}
export async function resume(file: string) {
  const source = await openBrowserStorage(
    JSON.stringify([
      context.storageName,
      context.deploymentId,
      context.pool,
      context.wallet,
    ]),
  );
  try {
    const resumed = await enrollRecovery(context, file, source, {
      previousOwnerStopped: true,
    });
    try {
      return await snapshotDeposits(resumed);
    } finally {
      resumed.close();
    }
  } finally {
    source.close();
  }
}
