import { execFile } from "node:child_process";
import { createHash } from "node:crypto";
import { mkdtemp, readFile, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import { EncryptedJournal } from "@zkapi/solana-sdk-previous/journal";
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

let original: typeof import("@zkapi/solana-sdk/journal");
let extracted: string | undefined;

beforeAll(async () => {
  const archive = fileURLToPath(
    new URL("../vendor/zkapi-solana-sdk-0.2.0-devnet.8.tgz", import.meta.url),
  );
  expect(
    createHash("sha256")
      .update(await readFile(archive))
      .digest("hex"),
  ).toBe("cd9226f4526c0b3561a557e4c7beb4f495dcbad6c995c624f4c442b6621414da");
  extracted = await mkdtemp(join(tmpdir(), "zkchat-sdk8-compatibility-"));
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
  expect(manifest.version).toBe("0.2.0-devnet.8");
  original = await import(
    /* @vite-ignore */ pathToFileURL(join(extracted, "package/dist/journal.js"))
      .href
  );
});

afterAll(async () => {
  if (extracted) await rm(extracted, { recursive: true, force: true });
});

describe("new Pool isolation and retained SDK .12 custody", () => {
  it("separates the new Pool while preserving both recovery namespace identities", () => {
    expect(PUBLIC_PROFILE_SDK_VERSION).toBe("0.2.0-devnet.13");
    expect(PREVIOUS_VERSION).toBe("0.2.0-devnet.12");
    expect(SDK_VERSION).toBe("0.2.0-devnet.13");
    expect(SDK_STORAGE_VERSION).toBe("public-devnet-20261021-state-v1");
    expect(SDK_STORAGE_NAME).toBe("zkchat-sdk-public-devnet-20261021-state-v1");
    expect(ORIGINAL_NOTE_ID).toBe(
      "zkchat-note-sdk-public-devnet-20261021-state-v1",
    );
    expect(storageVersionFor("0.2.0-devnet.12")).toBe("0.2.0-devnet.8");
    expect(storageVersionFor("0.2.0-devnet.3")).toBe("0.2.0-devnet.3");
    expect(() => storageVersionFor("unknown")).toThrow("Unsupported SDK");
  });

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
