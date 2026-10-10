import { describe, expect, it } from "vitest";
import {
  createDepositCatalog,
  ORIGINAL_NOTE_ID,
  canAddDeposit,
  canChangeDeposit,
} from "../src/lib/deposits";
import { memoryCustody } from "./depositStore";
import type { ClientStatus } from "@zkapi/solana-sdk";

describe("encrypted deposit catalog", () => {
  it("adopts the original note without writing; persists selection and all previous IDs across reopen", async () => {
    const storage = await memoryCustody();
    const context = { deploymentId: "deployment", pool: "pool" };
    const catalog = createDepositCatalog(storage, context);
    expect((await catalog.read()).selectedId).toBe(ORIGINAL_NOTE_ID);
    expect(storage.records.size).toBe(0);
    const id = `zkchat-deposit-${crypto.randomUUID()}`;
    await catalog.withLock(async () => {
      const saved = await catalog.read();
      await catalog.save({
        ...saved,
        selectedId: id,
        deposits: [...saved.deposits, { id, createdAt: Date.now() }],
      });
    });
    const reopened = createDepositCatalog(storage, context);
    expect((await reopened.read()).deposits.map((d) => d.id)).toEqual([
      ORIGINAL_NOTE_ID,
      id,
    ]);
    expect((await reopened.read()).selectedId).toBe(id);
    expect(JSON.stringify([...storage.records.values()])).not.toContain(id);
    await expect(
      createDepositCatalog(
        { ...storage, key: (await memoryCustody()).key },
        context,
      ).read(),
    ).rejects.toThrow();
    await reopened.withLock(async () =>
      reopened.save({
        ...(await reopened.read()),
        selectedId: ORIGINAL_NOTE_ID,
      }),
    );
    expect((await catalog.read()).selectedId).toBe(ORIGINAL_NOTE_ID);
  });
  it("fails closed on malformed or corrupt catalog instead of resetting IDs", async () => {
    const storage = await memoryCustody();
    const catalog = createDepositCatalog(storage, {
      deploymentId: "deployment",
      pool: "pool",
    });
    await expect(
      catalog.save({ schema: 1, selectedId: "unknown", deposits: [] }),
    ).rejects.toThrow();
    await catalog.save(await catalog.read());
    const [key, record] = [...storage.records.entries()][0];
    storage.records.set(key, { ...record, ciphertextHex: "00".repeat(32) });
    await expect(catalog.read()).rejects.toThrow();
  });
});
describe("deposit lifecycle eligibility", () => {
  const status = {
    wallet: "active",
    busy: false,
    session: null,
    walletOperation: null,
  } as ClientStatus;
  it("supports low balances and closed notes without requiring spendable funds", () => {
    expect(
      canAddDeposit({
        ...status,
        canRequest: false,
        settledBalanceMicroUsdc: "0",
      }),
    ).toBe(true);
    expect(canAddDeposit({ ...status, wallet: "closed" })).toBe(true);
    expect(canAddDeposit({ ...status, wallet: "empty" })).toBe(false);
    expect(canChangeDeposit({ ...status, wallet: "empty" })).toBe(true);
  });
  it.each([
    { busy: true },
    { session: { phase: "settlement_pending" } },
    { walletOperation: { kind: "deposit", signature: "submitted" } },
    { walletOperation: { kind: "deposit", phase: "failed" } },
    { wallet: "pending_escape" },
    { emergencyEscape: { phase: "challenged" } },
  ])("does not bypass an unresolved state: %o", (patch) => {
    expect(canAddDeposit({ ...status, ...patch } as ClientStatus)).toBe(false);
    expect(canChangeDeposit({ ...status, ...patch } as ClientStatus)).toBe(
      false,
    );
  });
});
