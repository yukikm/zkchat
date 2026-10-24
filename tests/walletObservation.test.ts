import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ClientStatus } from "@zkapi/solana-sdk";
import {
  createWalletObservation,
  type WalletObservationHandle,
  type WalletObservationState,
} from "../src/lib/walletObservation";

const controllers: ReturnType<typeof createWalletObservation>[] = [];
const signedStatus = (noteId = "deposit-1", signature = "signed-1") =>
  ({
    noteId,
    wallet: "active",
    busy: false,
    settledBalanceMicroUsdc: "2000000",
    walletOperation: { kind: "mutual_close", phase: "ready", signature },
  }) as ClientStatus;

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((done) => {
    resolve = done;
  });
  return { promise, resolve };
}

function fixture(maxDurationMs?: number) {
  const advanceWallet = vi.fn();
  const observeWallet = vi.fn(async () => ({ state: "pending" }));
  const source: {
    handle: WalletObservationHandle | null;
    status: ClientStatus | null;
  } = {
    handle: null,
    status: signedStatus(),
  };
  const client = {
    advanceWallet,
    observeWallet,
    status: vi.fn(async () => structuredClone(source.status!)),
  };
  source.handle = { client, selectedDepositId: "deposit-1" };
  const changes: WalletObservationState[] = [];
  const onStatus = vi.fn((status: ClientStatus) => {
    source.status = status;
  });
  let enabled = true;
  const controller = createWalletObservation({
    getCurrent: () => source,
    onStatus,
    onChange: (change) => changes.push(change),
    canObserve: () => enabled,
    maxDurationMs,
  });
  controllers.push(controller);
  return {
    source,
    client,
    controller,
    changes,
    onStatus,
    setEnabled: (value: boolean) => {
      enabled = value;
    },
    get state() {
      return changes.at(-1);
    },
  };
}

beforeEach(() => vi.useFakeTimers());
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.dispose());
  vi.useRealTimers();
});

describe("safe wallet transaction observation", () => {
  it("observes the saved signature with backoff and never advances or sends", async () => {
    const f = fixture();
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.client.observeWallet).toHaveBeenCalledExactlyOnceWith("signed-1");
    await vi.advanceTimersByTimeAsync(999);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1_999);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(3);
    expect(f.client.advanceWallet).not.toHaveBeenCalled();
    expect(f.state).toEqual({
      state: "waiting",
      lastResult: "pending",
      retryOnly: false,
    });
  });

  it("stops at the next unsigned approval instead of auto-advancing", async () => {
    const f = fixture();
    f.client.observeWallet.mockResolvedValue({ state: "ready" });
    f.client.status.mockResolvedValue({
      ...signedStatus(),
      walletOperation: { ...signedStatus().walletOperation!, signature: null },
    });
    f.controller.update();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    expect(f.client.advanceWallet).not.toHaveBeenCalled();
    expect(f.onStatus.mock.calls[0][0].wallet).toBe("active");
    expect(f.state?.state).toBe("idle");
  });

  it("publishes verified completion and stops even when the SDK retains historical balance", async () => {
    const f = fixture();
    f.client.observeWallet.mockResolvedValue({ state: "complete" });
    f.client.status.mockResolvedValue({
      ...signedStatus(),
      wallet: "closed",
      walletOperation: null,
    });
    f.controller.update();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    expect(f.source.status?.wallet).toBe("closed");
    expect(f.source.status?.settledBalanceMicroUsdc).toBe("2000000");
  });

  it("stops automatic reads after 90 seconds and permits a safe manual check", async () => {
    const f = fixture();
    f.controller.update();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.state).toEqual({
      state: "retry",
      lastResult: "pending",
      retryOnly: true,
    });
    const calls = f.client.observeWallet.mock.calls.length;
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls);
    await f.controller.checkNow();
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls + 1);
    expect(f.state?.retryOnly).toBe(true);
    expect(f.client.advanceWallet).not.toHaveBeenCalled();
  });

  it("retains an expiry result for explicit recovery and does not retry it automatically", async () => {
    const f = fixture();
    f.client.observeWallet.mockResolvedValue({
      state: "expired_reconcile_required",
    });
    f.controller.update();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    expect(f.state).toEqual({
      state: "retry",
      lastResult: "expired_reconcile_required",
      retryOnly: true,
    });
  });

  it("retries errors with backoff without exposing arbitrary errors or overlapping", async () => {
    const f = fixture();
    f.client.observeWallet.mockRejectedValueOnce(
      new Error("private transport response"),
    );
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.state).toEqual({
      state: "retry",
      lastResult: "error",
      retryOnly: false,
    });
    await vi.advanceTimersByTimeAsync(1_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
    expect(JSON.stringify(f.changes)).not.toContain("private");
  });

  it("serializes automatic and repeated manual checks", async () => {
    const f = fixture();
    const pending = deferred<{ state: string }>();
    f.client.observeWallet.mockReturnValue(pending.promise);
    f.controller.update();
    const manual1 = f.controller.checkNow();
    const manual2 = f.controller.checkNow();
    f.controller.update();
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    pending.resolve({ state: "pending" });
    await Promise.all([manual1, manual2]);
    expect(f.onStatus).toHaveBeenCalledTimes(1);
  });

  it.each(["handle", "note", "signature"] as const)(
    "discards old results after a %s change and waits before observing the new target",
    async (change) => {
      const f = fixture();
      const pending = deferred<{ state: string }>();
      f.client.observeWallet.mockReturnValueOnce(pending.promise);
      f.controller.update();
      await vi.advanceTimersByTimeAsync(0);
      if (change === "handle") f.source.handle = { ...f.source.handle! };
      if (change === "note") {
        f.source.handle = {
          ...f.source.handle!,
          selectedDepositId: "deposit-2",
        };
        f.source.status = signedStatus("deposit-2");
      }
      if (change === "signature")
        f.source.status = signedStatus("deposit-1", "signed-2");
      f.controller.update();
      expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
      pending.resolve({ state: "complete" });
      await vi.advanceTimersByTimeAsync(0);
      expect(f.onStatus).not.toHaveBeenCalled();
      await vi.advanceTimersByTimeAsync(1_000);
      expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
      expect(f.onStatus).toHaveBeenCalledTimes(1);
    },
  );

  it("discards a late local-status read after disconnect", async () => {
    const f = fixture();
    const read = deferred<ClientStatus>();
    f.client.status.mockReturnValue(read.promise);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    f.source.handle = null;
    f.source.status = null;
    f.controller.update();
    read.resolve({
      ...signedStatus(),
      wallet: "closed",
      walletOperation: null,
    });
    await vi.advanceTimersByTimeAsync(30_000);
    expect(f.onStatus).not.toHaveBeenCalled();
    expect(f.state?.state).toBe("idle");
  });

  it("pauses hidden or offline reads, preserves the budget, and resumes", async () => {
    const f = fixture(5_000);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    f.setEnabled(false);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    f.setEnabled(true);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
    expect(f.state?.retryOnly).toBe(false);
  });

  it("does not reset backoff or the retry budget on SDK busy publications", async () => {
    const f = fixture(5_000);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(3_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(3);
    f.source.status = { ...f.source.status!, busy: true };
    f.controller.update();
    await vi.advanceTimersByTimeAsync(1_000);
    f.source.status = { ...f.source.status!, busy: false };
    f.controller.update();
    await vi.advanceTimersByTimeAsync(2_000);
    expect(f.state?.retryOnly).toBe(true);
  });

  it("counts the observer's own busy RPC time toward the 90-second bound", async () => {
    const f = fixture();
    f.client.observeWallet.mockImplementation(async () => {
      f.source.status = { ...f.source.status!, busy: true };
      f.controller.update();
      await new Promise((resolve) => setTimeout(resolve, 60_000));
      f.source.status = { ...f.source.status!, busy: false };
      f.controller.update();
      return { state: "pending" };
    });
    f.controller.update();
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(61_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
    expect(f.state).toEqual({
      state: "retry",
      lastResult: "pending",
      retryOnly: true,
    });
    await vi.advanceTimersByTimeAsync(180_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(2);
  });

  it("keeps automatic retries stopped after external busy and a manual check", async () => {
    const f = fixture(5_000);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(5_000);
    expect(f.state?.retryOnly).toBe(true);
    const calls = f.client.observeWallet.mock.calls.length;
    f.source.status = { ...f.source.status!, busy: true };
    f.controller.update();
    await f.controller.checkNow();
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls);
    await vi.advanceTimersByTimeAsync(10_000);
    f.source.status = { ...f.source.status!, busy: false };
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls);
    await f.controller.checkNow();
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls + 1);
    await vi.advanceTimersByTimeAsync(60_000);
    expect(f.client.observeWallet).toHaveBeenCalledTimes(calls + 1);
    expect(f.state?.retryOnly).toBe(true);
  });

  it("disables observation for unsigned transactions and legacy SDKs", async () => {
    const f = fixture();
    f.source.status = {
      ...signedStatus(),
      walletOperation: { ...signedStatus().walletOperation!, signature: null },
    };
    f.controller.update();
    await f.controller.checkNow();
    expect(f.client.observeWallet).not.toHaveBeenCalled();
    f.source.status = signedStatus();
    f.source.handle = {
      client: { status: f.client.status },
      selectedDepositId: "deposit-1",
    };
    f.controller.update();
    await f.controller.checkNow();
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.client.status).not.toHaveBeenCalled();
    expect(f.client.advanceWallet).not.toHaveBeenCalled();
  });

  it("does not publish or schedule after disposal", async () => {
    const f = fixture();
    const pending = deferred<{ state: string }>();
    f.client.observeWallet.mockReturnValue(pending.promise);
    f.controller.update();
    await vi.advanceTimersByTimeAsync(0);
    f.controller.dispose();
    pending.resolve({ state: "complete" });
    await vi.advanceTimersByTimeAsync(90_000);
    expect(f.onStatus).not.toHaveBeenCalled();
    expect(f.client.observeWallet).toHaveBeenCalledTimes(1);
  });
});
