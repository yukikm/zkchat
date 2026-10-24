import type { ClientStorage } from "@zkapi/solana-sdk";
import {
  validateNoteJournal,
  type NoteJournal,
  type PreparedSession,
} from "@zkapi/solana-sdk/control";
import { EncryptedJournal } from "@zkapi/solana-sdk/journal";
import { createDepositCatalog, ORIGINAL_NOTE_ID } from "../../src/lib/deposits";

export const recoveryContext = {
  storageName: "zkchat-recovery-test",
  deploymentId: "synthetic-recovery-deployment",
  pool: "synthetic-recovery-pool",
  wallet: "synthetic-recovery-wallet",
  profileSha256: "ab".repeat(32),
};
export const secondNoteId =
  "zkchat-deposit-12345678-1234-4123-8123-123456789012";
export const thirdNoteId =
  "zkchat-deposit-12345678-1234-4123-8123-123456789013";
const field = (n: number) => "0x" + n.toString(16).padStart(64, "0");
export function fundedNote(id = 1): NoteJournal {
  return {
    schema: 2,
    state: {
      balance_micro_usdc: "2000000",
      balance_blinding: field(3),
      note_leaf: field(4),
      commitment: { x: field(5), y: field(6) },
      anchor: field(7),
      state_signature: { r_x: field(9), r_y: field(10), s: field(11) },
    },
    witness: {
      secret: field(id + 1),
      note_id: id,
      deposit_micro_usdc: "2000000",
      expiry: "9999999999",
    },
    wallet: { status: "active", history: [] },
    pending: null,
    history: [],
  };
}
export function pendingNote(): NoteJournal {
  const note = fundedNote(2);
  const prepared: PreparedSession = {
    request: {
      authorization: {
        version: "1",
        deployment_id: recoveryContext.deploymentId,
        pool: recoveryContext.pool,
        request_id: "12345678-1234-4123-8123-123456789014",
        quote_hash: "00".repeat(32),
        mode: "direct_openrouter",
        control_secret_hash: "11".repeat(32),
        proxy_secret_hash: null,
      },
      quote: {
        body: {
          quote_id: "synthetic-quote",
          deployment_id: recoveryContext.deploymentId,
          pool: recoveryContext.pool,
          mode: "direct_openrouter",
          provider: "openrouter",
          models: ["*"],
          tariff_hash: "33".repeat(32),
          cap_micro_usdc: "100",
          issued_at: "100",
          expires_at: "200",
          session_ttl_seconds: "60",
          max_concurrency: "4",
          control_api_origin: "https://control.invalid",
          inference_api_origin: "https://provider.invalid",
        },
        quote_hash: "00".repeat(32),
        signature: "synthetic-signature",
      },
      public_inputs: Array(12).fill(field(1)),
      proof: {
        backend: "groth16_bn254",
        proof: "synthetic-proof-no-financial-operation",
      },
    },
    control_token: "zkc1.synthetic-exact-recovery-credential",
    proxy_token: null,
    tariff: {
      tariff_hash: "33".repeat(32),
      version: "1",
      provider: "openrouter",
      model: "*",
      pricing_basis: "provider_reported_usd",
      valid_from: "0",
      valid_until: "9999999999",
      rates: [],
      operator_fee_micro_usdc: "0",
    },
    rerandomization: field(13),
  };
  note.pending = {
    prepared,
    exactRequest: JSON.stringify(prepared.request),
    phase: "send_unknown",
    operations: [
      {
        id: "12345678-1234-4123-8123-123456789015",
        path: "/v1/chat/completions",
        anthropicVersion: "",
        bodyBase64: "",
        bodyRedacted: true,
        bodySha256: "af".repeat(32),
        phase: "send_unknown",
      },
    ],
  };
  return note;
}
export function noteJournal(storage: ClientStorage) {
  return new EncryptedJournal<NoteJournal>(
    storage.store,
    storage.key,
    recoveryContext,
    validateNoteJournal,
  );
}
export async function seedDeposits(storage: ClientStorage) {
  const notes = noteJournal(storage),
    catalog = createDepositCatalog(storage, recoveryContext);
  await notes.create(ORIGINAL_NOTE_ID, fundedNote());
  await notes.create(secondNoteId, pendingNote());
  await catalog.save({
    schema: 1,
    selectedId: secondNoteId,
    deposits: [
      { id: ORIGINAL_NOTE_ID, createdAt: null },
      { id: secondNoteId, createdAt: 1792857600000 },
    ],
  });
  return snapshotDeposits(storage);
}
export async function snapshotDeposits(storage: ClientStorage) {
  const catalog = await createDepositCatalog(storage, recoveryContext).read();
  const notes = await Promise.all(
    catalog.deposits.map(async ({ id }) => {
      const record = await noteJournal(storage).read(id);
      // The ciphertext digest changes during intentional key migration; every
      // plaintext field and its financial revision must remain identical.
      return {
        id,
        record: record
          ? { revision: record.revision, value: record.value }
          : null,
      };
    }),
  );
  return { catalog, notes };
}
export async function addLaterDeposit(storage: ClientStorage) {
  const catalog = createDepositCatalog(storage, recoveryContext),
    saved = await catalog.read();
  await noteJournal(storage).create(thirdNoteId, fundedNote(3));
  saved.deposits.push({ id: thirdNoteId, createdAt: 1792857601000 });
  saved.selectedId = thirdNoteId;
  await catalog.save(saved);
  const first = (await noteJournal(storage).read(ORIGINAL_NOTE_ID))!;
  first.value.state.balance_micro_usdc = "1994736";
  await noteJournal(storage).compareAndSwap(
    ORIGINAL_NOTE_ID,
    first.revision,
    first.value,
  );
  return snapshotDeposits(storage);
}
