import { describe, expect, it, vi } from "vitest";
import type { ClientStatus } from "@zkapi/solana-sdk";
import type { V0Wallet } from "@zkapi/solana-sdk/transport";
import { recoveryWallet } from "../src/lib/recoveryWallet";

describe("retired Pool wallet signing", () => {
  const transaction = {} as Parameters<V0Wallet["signTransaction"]>[0];
  const wallet = () => ({
    publicKey: "fixture" as V0Wallet["publicKey"],
    supportedTransactionVersions: new Set([0]),
    signTransaction: vi.fn(async () => transaction),
  });
  const status = (kind: string, signature: string | null = null) =>
    ({ walletOperation: { kind, signature } }) as ClientStatus;

  it.each([null, "already-signed-transaction"])(
    "blocks deposit signing even after a saved transaction (%s) needs replacement",
    async (signature) => {
      const original = wallet();
      const guarded = recoveryWallet(original, async () =>
        status("deposit", signature),
      );
      await expect(guarded.signTransaction(transaction)).rejects.toThrow(
        "New deposit signatures are disabled",
      );
      expect(original.signTransaction).not.toHaveBeenCalled();
    },
  );
  it.each(["mutual_close", "initiate_escape", "finalize_escape"])(
    "preserves explicit %s withdrawal signing",
    async (kind) => {
      const original = wallet();
      const guarded = recoveryWallet(original, async () => status(kind));
      expect(await guarded.signTransaction(transaction)).toBe(transaction);
      expect(original.signTransaction).toHaveBeenCalledExactlyOnceWith(
        transaction,
      );
    },
  );
  it("fails closed without its own client and reads the latest saved operation before signing", async () => {
    const original = wallet();
    let latest: ClientStatus | undefined;
    const guarded = recoveryWallet(original, async () => latest);
    await expect(guarded.signTransaction(transaction)).rejects.toThrow(
      "Pool is retired",
    );
    latest = status("mutual_close");
    await guarded.signTransaction(transaction);
    latest = status("deposit", "expired-transaction");
    await expect(guarded.signTransaction(transaction)).rejects.toThrow(
      "Pool is retired",
    );
    expect(original.signTransaction).toHaveBeenCalledTimes(1);
  });
});
