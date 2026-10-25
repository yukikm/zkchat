import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EncryptedJournal } from "@zkapi/solana-sdk-previous/journal";
import { EncryptedJournal as CurrentEncryptedJournal } from "@zkapi/solana-sdk/journal";
import { PUBLIC_PROFILE_SDK_VERSION } from "@zkapi/solana-sdk/public-profile";
import { PUBLIC_PROFILE_SDK_VERSION as PREVIOUS_VERSION } from "@zkapi/solana-sdk-previous/public-profile";
import { createDepositCatalog, ORIGINAL_NOTE_ID } from "../src/lib/deposits";
import {
  SDK_STORAGE_NAME,
  SDK_STORAGE_VERSION,
  SDK_VERSION,
  storageVersionFor,
} from "../src/lib/sdkVersion";
import { memoryCustody } from "./depositStore";
import {
  profileBindingKey,
  retainProfileBinding,
  type PublicAppConfig,
} from "../src/lib/publicDeployment";

let original: typeof import("@zkapi/solana-sdk/journal");
let sdk13: typeof import("@zkapi/solana-sdk/journal");
let sdk16: typeof import("@zkapi/solana-sdk/journal");
let sdk15: typeof import("@zkapi/solana-sdk/journal");
let sdk19: typeof import("@zkapi/solana-sdk/journal");
let october21Catalog: typeof createDepositCatalog;
const october21StorageVersion = "public-devnet-20261021-state-v1";
const october21NoteId = `zkchat-note-sdk-${october21StorageVersion}`;
const extractedDirectories: string[] = [];

async function releasedJournal(version: string, sha256: string) {
  const archive = fileURLToPath(
    new URL(`../vendor/zkapi-solana-sdk-${version}.tgz`, import.meta.url),
  );
  expect(
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
  ).toBe(sha256);
  const extracted = await mkdtemp(join(tmpdir(), "zkchat-sdk-compatibility-"));
  extractedDirectories.push(extracted);
  // Load the original released encryption implementation, not the new SDK
  // under a second import name. The journal module has no external imports.
  await promisify(execFile)("tar", [
    "-xzf",
    archive,
    "-C",
    extracted,
    "package/package.json",
    "package/dist/journal.js",
  ]);
  const manifest = JSON.parse(
    await readFile(join(extracted, "package/package.json"), "utf8"),
  );
  expect(manifest.version).toBe(version);
  return import(
    /* @vite-ignore */ pathToFileURL(join(extracted, "package/dist/journal.js"))
      .href
  );
}

beforeAll(async () => {
  original = await releasedJournal(
    "0.2.0-devnet.8",
    "cd9226f4526c0b3561a557e4c7beb4f495dcbad6c995c624f4c442b6621414da",
  );
  sdk16 = await releasedJournal(
    "0.2.0-devnet.16",
    "29b8f521a95e99d2fd7aae11d6abdb728229a712d5cd4b967e857daaa1449d07",
  );
  sdk15 = await releasedJournal(
    "0.2.0-devnet.15",
    "976fd54b7fdcbafea75870728c018d50d821bdc5e5137e4a8b8e7b3c77f15f98",
  );
  sdk13 = await releasedJournal(
    "0.2.0-devnet.13",
    "e6e7668e1d37938f67f8865673aba1a11f27b975d3715a376ac24a6dcfa8a8a9",
  );
  sdk19 = await releasedJournal(
    "0.2.0-devnet.19",
    "cfdda081148cae2e4ae2d1fe0f821fcbf235f593a55bc50bfc042fb826c09424",
  );
  vi.stubEnv("VITE_ZKCHAT_SDK_VERSION", "0.2.0-devnet.19");
  vi.resetModules();
  try {
    october21Catalog = (await import("../src/lib/deposits"))
      .createDepositCatalog;
  } finally {
    vi.unstubAllEnvs();
    vi.resetModules();
  }
});

afterAll(async () => {
  await Promise.all(
    extractedDirectories.map((directory) =>
      rm(directory, { recursive: true, force: true }),
    ),
  );
});

describe("new Pool isolation and retained SDK .12 custody", () => {
  it("separates the new Pool while preserving both recovery namespace identities", () => {
    expect(PUBLIC_PROFILE_SDK_VERSION).toBe("0.2.0-devnet.20");
    expect(PREVIOUS_VERSION).toBe("0.2.0-devnet.12");
    expect(SDK_VERSION).toBe("0.2.0-devnet.20");
    expect(SDK_STORAGE_VERSION).toBe("public-devnet-20261025-nonexpiry-v1");
    expect(SDK_STORAGE_NAME).toBe(
      "zkchat-sdk-public-devnet-20261025-nonexpiry-v1",
    );
    expect(ORIGINAL_NOTE_ID).toBe(
      "zkchat-note-sdk-public-devnet-20261025-nonexpiry-v1",
    );
    expect(storageVersionFor("0.2.0-devnet.12")).toBe("0.2.0-devnet.8");
    expect(storageVersionFor("0.2.0-devnet.3")).toBe("0.2.0-devnet.3");
    for (const version of [
      "13",
      "15",
      "16",
      "17",
      "18",
      "19",
      "20-noexpiry.1",
    ]) {
      expect(storageVersionFor(`0.2.0-devnet.${version}`)).toBe(
        october21StorageVersion,
      );
      expect(storageVersionFor(`0.2.0-devnet.${version}`)).not.toBe(
        SDK_STORAGE_VERSION,
      );
    }
    expect(storageVersionFor("0.2.0-devnet.20")).toBe(SDK_STORAGE_VERSION);
    expect(() => storageVersionFor("unknown")).toThrow("Unsupported SDK");
  });

  it("retains the .13 public-profile binding when reopening the same account with .19", async () => {
    const config: PublicAppConfig = {
      schema: 2,
      chain: "solana:devnet",
      label: "Retained October 21 Pool",
      profileUrl:
        "https://d366buuvadnp3.cloudfront.net/releases/public-devnet-20261021-state-v1/profile.json",
      profileSha256:
        "5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a",
    };
    const account = "synthetic-original-account";
    const previousStorageName = `zkchat-sdk-${storageVersionFor("0.2.0-devnet.13")}`;
    const binding = profileBindingKey(previousStorageName, account);
    const savedBindings = new Map([[binding, config.profileSha256]]);
    const setItem = vi.fn();
    const hasCustody = vi.fn(async () => true);
    vi.stubGlobal("localStorage", {
      getItem: (key: string) => savedBindings.get(key) ?? null,
      setItem,
    });
    vi.stubGlobal("navigator", {
      locks: {
        request: async (
          _key: string,
          _options: unknown,
          action: () => Promise<unknown>,
        ) => action(),
      },
    });
    try {
      expect(
        await retainProfileBinding(
          config,
          `zkchat-sdk-${storageVersionFor("0.2.0-devnet.19")}`,
          account,
          false,
          hasCustody,
        ),
      ).toBe(true);
      expect(setItem).not.toHaveBeenCalled();
      expect(hasCustody).not.toHaveBeenCalled();
      expect([...savedBindings.entries()]).toEqual([
        [binding, config.profileSha256],
      ]);
    } finally {
      vi.unstubAllGlobals();
    }
  });

  it.each(["13", "15", "16"])(
    "opens .%s ciphertext with .19 without changing its unresolved session or catalog",
    async (version) => {
      const storage = await memoryCustody();
      const context = {
        deploymentId: "public-devnet-20261021-state-v1",
        pool: "synthetic-current-pool",
      };
      const secondId = "zkchat-deposit-33333333-3333-4333-8333-333333333333";
      // These are opaque storage fixtures, not valid proofs or a funded lifecycle.
      // Use the original .13 writer so a format change in .15 cannot hide a
      // regression by creating and reading both sides with the new implementation.
      const unresolvedNote = {
        schema: 2,
        noteId: october21NoteId,
        balanceMicroUsdc: "2000000",
        pending: {
          phase: "closing",
          sessionId: "synthetic-original-session",
          exactRequest: "synthetic-original-authorization",
          controlToken: "synthetic-original-recovery-token",
          operations: [
            { id: "synthetic-original-operation", phase: "send_unknown" },
          ],
        },
        wallet: { status: "active", history: ["synthetic-original-deposit"] },
        history: ["synthetic-original-settlement"],
      };
      const savedCatalog = {
        schema: 1,
        selectedId: october21NoteId,
        deposits: [
          { id: october21NoteId, createdAt: null },
          { id: secondId, createdAt: 1_700_000_000_000 },
        ],
      };
      const originalJournal = new (
        version === "13" ? sdk13 : version === "15" ? sdk15 : sdk16
      ).EncryptedJournal(storage.store, storage.key, context, async () => {});
      const noteRecord = await originalJournal.create(
        october21NoteId,
        unresolvedNote,
      );
      await originalJournal.create("zkchat-deposit-catalog-v1", savedCatalog);
      const originalCiphertext = structuredClone([
        ...storage.records.entries(),
      ]);
      const retainedJournal = new sdk19.EncryptedJournal(
        storage.store,
        storage.key,
        context,
        async () => {},
      );

      expect(
        await retainedJournal.read(october21NoteId, noteRecord.head),
      ).toEqual(noteRecord);
      expect(await october21Catalog(storage, context).read()).toEqual(
        savedCatalog,
      );
      expect([...storage.records.entries()]).toEqual(originalCiphertext);

      // Reopening the retained reader also leaves the original encrypted records and
      // trusted revisions intact, including the unresolved operation and token.
      const reopened = new sdk19.EncryptedJournal(
        storage.store,
        storage.key,
        context,
        async () => {},
      );
      expect(await reopened.read(october21NoteId, noteRecord.head)).toEqual(
        noteRecord,
      );
      expect([...storage.records.entries()]).toEqual(originalCiphertext);

      // The new Pool must neither adopt the old catalog nor rebind its notes.
      await expect(
        createDepositCatalog(storage, context).read(),
      ).rejects.toThrow();
      const newPoolJournal = new CurrentEncryptedJournal(
        storage.store,
        storage.key,
        {
          deploymentId: SDK_STORAGE_VERSION,
          pool: "synthetic-new-nonexpiring-pool",
        },
        async () => {},
      );
      expect(await newPoolJournal.read(october21NoteId)).toBeNull();
      expect([...storage.records.entries()]).toEqual(originalCiphertext);
    },
  );

  it("opens a real .8 encrypted catalog and preserves every financial record while changing selection", async () => {
    const storage = await memoryCustody();
    const context = {
      deploymentId: "compatibility-fixture",
      pool: "fixture-pool",
    };
    const firstId = "zkchat-note-sdk-0.2.0-devnet.8";
    const secondId = "zkchat-deposit-11111111-1111-4111-8111-111111111111";
    const thirdId = "zkchat-deposit-22222222-2222-4222-8222-222222222222";
    const ids = [firstId, secondId, thirdId];

    // Synthetic opaque financial payloads: this checks encryption/storage
    // preservation, not proof validity, accounting or a funded lifecycle.
    const pendingNotes = ids.map((noteId, index) => ({
      schema: 2,
      noteId,
      balanceMicroUsdc: String(2_000_000 + index),
      pending: {
        phase: "send_unknown",
        exactRequest: `synthetic-original-auth-${index}`,
        controlToken: `synthetic-original-token-${index}`,
      },
      wallet: { status: "active", history: [`synthetic-deposit-${index}`] },
      history: [`synthetic-settlement-${index}`],
    }));
    const originalFinancialJournal = new original.EncryptedJournal(
      storage.store,
      storage.key,
      context,
      async () => {},
    );
    for (const note of pendingNotes)
      await originalFinancialJournal.create(note.noteId, note);
    const financialCiphertext = structuredClone([...storage.records.entries()]);

    const savedCatalog = {
      schema: 1,
      selectedId: thirdId,
      deposits: ids.map((id, index) => ({
        id,
        createdAt: index === 0 ? null : 1_700_000_000_000 + index,
      })),
    };
    await new original.EncryptedJournal(
      storage.store,
      storage.key,
      context,
      async () => {},
    ).create("zkchat-deposit-catalog-v1", savedCatalog);
    const beforeOpen = structuredClone([...storage.records.entries()]);

    // The main runtime refuses an old catalog instead of adopting it. The
    // recovery build uses the original note ID and the retained .12 package.
    await expect(
      createDepositCatalog(storage, context).read(),
    ).rejects.toThrow();
    expect([...storage.records.entries()]).toEqual(beforeOpen);
    vi.stubEnv("VITE_ZKCHAT_SDK_VERSION", "0.2.0-devnet.12");
    vi.resetModules();
    let recoveryCatalog: typeof createDepositCatalog;
    try {
      recoveryCatalog = (await import("../src/lib/deposits"))
        .createDepositCatalog;
    } finally {
      vi.unstubAllEnvs();
      vi.resetModules();
    }
    const currentCatalog = recoveryCatalog(storage, context);
    expect(await currentCatalog.read()).toEqual(savedCatalog);
    const currentFinancialJournal = new EncryptedJournal(
      storage.store,
      storage.key,
      context,
      async () => {},
    );
    for (const note of pendingNotes)
      expect((await currentFinancialJournal.read(note.noteId))?.value).toEqual(
        note,
      );
    expect([...storage.records.entries()]).toEqual(beforeOpen);

    await currentCatalog.withLock(async () => {
      await currentCatalog.save({
        ...(await currentCatalog.read()),
        selectedId: secondId,
      });
    });
    expect(await recoveryCatalog(storage, context).read()).toEqual({
      ...savedCatalog,
      selectedId: secondId,
    });
    expect(storage.records.size).toBe(4);
    for (const [key, ciphertext] of financialCiphertext)
      expect(storage.records.get(key)).toEqual(ciphertext);
  });
});
