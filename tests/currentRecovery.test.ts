import { beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientStorage } from "@zkapi/solana-sdk";
import { importJournalKey } from "@zkapi/solana-sdk/journal";
import {
  createRecoveryStorage,
  parseRecoveryKit,
  type RecoverySession,
} from "@zkapi/solana-sdk/recovery";
import {
  assertLocalRecoveryNotMoved,
  createRecoveryFile,
  enrollRecovery,
  getRecoveryStorage,
  RecoverySetupIncomplete,
  restoreDeposits,
} from "../src/lib/currentRecovery";
import { ORIGINAL_NOTE_ID } from "../src/lib/deposits";
import { memoryCustody } from "./depositStore";
import { recoveryService } from "./fixtures/recoveryService";
import {
  addLaterDeposit,
  fundedNote,
  noteJournal,
  recoveryContext as context,
  seedDeposits,
  snapshotDeposits,
} from "./fixtures/recoveryData";

// IndexedDB-only boundaries are replaced here; the browser suite exercises the
// real adapters. The published SDK performs every encrypted financial write.
const local = vi.hoisted(() => ({
  sources: new Map<string, ClientStorage>(),
  bindings: new Map<string, { session: RecoverySession; key: CryptoKey }>(),
}));
vi.mock("@zkapi/solana-sdk/browser", () => {
  class BrowserStorageMissing extends Error {}
  return {
    BrowserStorageMissing,
    openBrowserStorage: async (name: string) => {
      const storage = local.sources.get(name);
      if (!storage) throw new BrowserStorageMissing();
      return { ...storage, close() {} };
    },
  };
});
vi.mock("@zkapi/solana-sdk/recovery-browser", () => ({
  loadRecoverySession: async (name: string) =>
    structuredClone(local.bindings.get(name) ?? null),
  saveRecoverySession: async (name: string, input: RecoverySession) => {
    const session = structuredClone(input);
    const key = await importJournalKey(
      Uint8Array.from(session.keyHex!.match(/../g)!, (hex) =>
        parseInt(hex, 16),
      ),
    );
    delete session.keyHex;
    local.bindings.set(name, { session, key });
  },
}));
const sourceName = JSON.stringify([
  context.storageName,
  context.deploymentId,
  context.pool,
  context.wallet,
]);
async function original() {
  const storage = await memoryCustody();
  local.sources.set(sourceName, storage);
  return storage;
}
const options = (server: ReturnType<typeof recoveryService>) => ({
  fetch: server.fetch,
  previousOwnerStopped: true as const,
});
beforeEach(() => {
  local.sources.clear();
  local.bindings.clear();
});

describe("current deployment recovery custody", () => {
  it("migrates every validated note and catalog, keeps later changes, and restores after all original data is deleted", async () => {
    const server = recoveryService(),
      source = await original(),
      before = await seedDeposits(source),
      file = createRecoveryFile(context);
    const target = await enrollRecovery(context, file, source, options(server));
    expect(await snapshotDeposits(target)).toEqual(before);
    expect(await snapshotDeposits(source)).toEqual(before);
    const latest = await addLaterDeposit(target);
    expect(latest.notes[1].record?.value.pending?.phase).toBe("send_unknown");
    expect(
      latest.notes[1].record?.value.pending?.prepared.control_token,
    ).toContain("synthetic-exact-recovery-credential");
    const stale = await getRecoveryStorage(context, options(server));
    expect(stale).not.toBeNull();
    target.close();
    local.sources.clear();
    local.bindings.clear();
    const restored = await restoreDeposits(context, file, options(server));
    expect(await snapshotDeposits(restored)).toEqual(latest);
    expect(restored.key.extractable).toBe(false);
    expect([...local.bindings.values()][0].session.keyHex).toBeUndefined();
    await expect(noteJournal(stale!).read(ORIGINAL_NOTE_ID)).rejects.toThrow();
    stale!.close();
    restored.close();
  });

  it("retains an independent source fence when a partial backup and its device binding are lost", async () => {
    const server = recoveryService(),
      source = await original(),
      before = await seedDeposits(source),
      file = createRecoveryFile(context);
    server.failWriteAt(3); // key authentication, first note, then failed second note
    await expect(
      enrollRecovery(context, file, source, options(server)),
    ).rejects.toThrow();
    expect(local.bindings.size).toBe(1);
    await expect(
      getRecoveryStorage(context, options(server)),
    ).rejects.toBeInstanceOf(RecoverySetupIncomplete);
    local.bindings.clear();
    await expect(
      getRecoveryStorage(context, options(server)),
    ).rejects.toBeInstanceOf(RecoverySetupIncomplete);
    await expect(assertLocalRecoveryNotMoved(context)).rejects.toBeInstanceOf(
      RecoverySetupIncomplete,
    );
    expect(await snapshotDeposits(source)).toEqual(before);
    server.failWriteAt(null);
    const resumed = await enrollRecovery(
      context,
      file,
      source,
      options(server),
    );
    expect(await snapshotDeposits(resumed)).toEqual(before);
    resumed.close();
  });

  it("offers same-file setup when saving the source fence fails after binding persistence", async () => {
    const server = recoveryService(),
      source = await original(),
      before = await seedDeposits(source),
      file = createRecoveryFile(context);
    const compare = source.store.compareAndSwap.bind(source.store);
    source.store.compareAndSwap = async () => {
      throw new Error("synthetic IndexedDB write failure");
    };
    await expect(
      enrollRecovery(context, file, source, options(server)),
    ).rejects.toThrow("IndexedDB write failure");
    expect(local.bindings.size).toBe(1);
    await expect(
      getRecoveryStorage(context, options(server)),
    ).rejects.toBeInstanceOf(RecoverySetupIncomplete);
    source.store.compareAndSwap = compare;
    const resumed = await enrollRecovery(
      context,
      file,
      source,
      options(server),
    );
    expect(await snapshotDeposits(resumed)).toEqual(before);
    resumed.close();
  });

  it("does not hide unmigrated local funds by adopting a different completed backup during setup", async () => {
    const server = recoveryService(),
      previous = await original(),
      file = createRecoveryFile(context);
    await seedDeposits(previous);
    (await enrollRecovery(context, file, previous, options(server))).close();
    local.sources.clear();
    local.bindings.clear();
    const source = await original();
    const newer = fundedNote();
    newer.state.balance_micro_usdc = "1777000";
    await noteJournal(source).create(ORIGINAL_NOTE_ID, newer);
    const before = await snapshotDeposits(source);
    await expect(
      enrollRecovery(context, file, source, options(server)),
    ).rejects.toThrow("already protects other deposits");
    expect(local.bindings.size).toBe(0);
    expect(await getRecoveryStorage(context, options(server))).toBeNull();
    expect(await snapshotDeposits(source)).toEqual(before);
    const requestCount = server.requests;
    await expect(
      restoreDeposits(context, file, options(server)),
    ).rejects.toThrow("not in this recovery setup");
    expect(server.requests).toBe(requestCount);
  });

  it("never accepts an SDK vault before application enrollment is complete", async () => {
    const server = recoveryService(),
      file = createRecoveryFile(context);
    (
      await createRecoveryStorage(parseRecoveryKit(file), {
        fetch: server.fetch,
      })
    ).close();
    await expect(
      restoreDeposits(context, file, options(server)),
    ).rejects.toBeInstanceOf(RecoverySetupIncomplete);
    expect(local.bindings.size).toBe(0);
  });

  it.each(["endpoint", "pool", "wallet", "deploymentId"])(
    "rejects a changed %s before contacting the backup service",
    async (field) => {
      const server = recoveryService(),
        file = JSON.parse(createRecoveryFile(context));
      if (field === "endpoint")
        file.endpoint = "https://untrusted.invalid/recovery/v1";
      else file.context[field] = "different-context";
      await expect(
        restoreDeposits(context, JSON.stringify(file), options(server)),
      ).rejects.toThrow();
      expect(server.requests).toBe(0);
      expect(local.bindings.size).toBe(0);
    },
  );

  it("requires explicit stopped-client confirmation and the same installed profile", async () => {
    const server = recoveryService(),
      source = await original(),
      file = createRecoveryFile(context);
    await seedDeposits(source);
    await expect(
      enrollRecovery(context, file, source, {
        fetch: server.fetch,
        previousOwnerStopped: false,
      } as never),
    ).rejects.toThrow("Close zkChat");
    expect(server.requests).toBe(0);
    (await enrollRecovery(context, file, source, options(server))).close();
    local.bindings.clear();
    local.sources.clear();
    await expect(
      restoreDeposits(
        { ...context, profileSha256: "cd".repeat(32) },
        file,
        options(server),
      ),
    ).rejects.toThrow("different recovery setup");
    expect(local.bindings.size).toBe(0);
  });

  it("rejects a different vault before takeover and never recopies stale local records after completion", async () => {
    const server = recoveryService(),
      source = await original(),
      file = createRecoveryFile(context);
    await seedDeposits(source);
    const target = await enrollRecovery(context, file, source, options(server)),
      latest = await addLaterDeposit(target);
    target.close();
    const requestCount = server.requests;
    await expect(
      enrollRecovery(
        context,
        createRecoveryFile(context),
        source,
        options(server),
      ),
    ).rejects.toThrow("different recovery setup");
    expect(server.requests).toBe(requestCount);
    const resumed = await enrollRecovery(
      context,
      file,
      source,
      options(server),
    );
    expect(await snapshotDeposits(resumed)).toEqual(latest);
    resumed.close();
  });
});
