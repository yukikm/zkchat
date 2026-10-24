import { useCallback, useEffect, useRef, useState } from "react";
import type { ClientStatus } from "@zkapi/solana-sdk";

export interface WalletObservationHandle {
  client: {
    status(): Promise<ClientStatus>;
    observeWallet?: (expectedSignature: string) => Promise<{ state: string }>;
  };
  readonly selectedDepositId: string;
  readonly invalidated?: boolean;
}

export interface WalletObservationState {
  state: "idle" | "checking" | "waiting" | "retry";
  lastResult: string | null;
  retryOnly: boolean;
}

interface Source {
  handle: WalletObservationHandle | null;
  status: ClientStatus | null;
}

interface ObservationOptions {
  getCurrent(): Source;
  onStatus(status: ClientStatus): void;
  onChange(state: WalletObservationState): void;
  canObserve?: () => boolean;
  maxDurationMs?: number;
}

interface Target {
  handle: WalletObservationHandle;
  client: WalletObservationHandle["client"];
  noteId: string;
  kind: string;
  signature: string;
}

const delays = [1_000, 2_000, 4_000, 8_000, 15_000];
const terminalResults = new Set([
  "ready",
  "complete",
  "changed",
  "proof_required",
  "rejected",
  "expired_reconcile_required",
]);
const initialState: WalletObservationState = {
  state: "idle",
  lastResult: null,
  retryOnly: false,
};

function targetFor({ handle, status }: Source): Target | null {
  if (
    !handle ||
    handle.invalidated ||
    typeof handle.client.observeWallet !== "function" ||
    !status?.walletOperation?.signature ||
    status.noteId !== handle.selectedDepositId ||
    status.wallet === "closed" ||
    ["failed", "proving"].includes(status.walletOperation.phase)
  )
    return null;
  return {
    handle,
    client: handle.client,
    noteId: status.noteId,
    kind: status.walletOperation.kind,
    signature: status.walletOperation.signature,
  };
}

function sameTarget(a: Target | null, b: Target | null): boolean {
  return (
    a === b ||
    (!!a &&
      !!b &&
      a.handle === b.handle &&
      a.client === b.client &&
      a.noteId === b.noteId &&
      a.kind === b.kind &&
      a.signature === b.signature)
  );
}

/** Observes only an already signed transaction. It never advances, signs or sends.
 * Keep one controller for the mounted app so even a handle change cannot overlap
 * an old observation. SDK expectedSignature fencing also protects the journal. */
export function createWalletObservation(options: ObservationOptions) {
  let target: Target | null = null;
  let generation = 0;
  let disposed = false;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let inFlight: Promise<void> | null = null;
  let attempts = 0;
  let startedAt: number | null = null;
  let pausedAt: number | null = null;
  let halted = false;
  let state = { ...initialState };
  const maxDuration = options.maxDurationMs ?? 90_000;

  const publish = (change: Partial<WalletObservationState>) => {
    if (disposed) return;
    const next = { ...state, ...change };
    if (
      next.state === state.state &&
      next.lastResult === state.lastResult &&
      next.retryOnly === state.retryOnly
    )
      return;
    state = next;
    options.onChange({ ...state });
  };
  const clearTimer = () => {
    if (timer !== undefined) clearTimeout(timer);
    timer = undefined;
  };
  const currentMatches = (captured: Target, version: number) =>
    !disposed &&
    generation === version &&
    sameTarget(captured, targetFor(options.getCurrent()));
  const available = () =>
    // The observer's own SDK action publishes busy while its RPC reads run.
    // That time counts toward the bound; only unrelated work pauses the budget.
    (!options.getCurrent().status?.busy || !!inFlight) &&
    (options.canObserve?.() ?? true);
  const remaining = () =>
    startedAt === null ? maxDuration : maxDuration - (Date.now() - startedAt);

  const synchronize = () => {
    const next = targetFor(options.getCurrent());
    if (!sameTarget(next, target)) {
      target = next;
      generation++;
      attempts = 0;
      startedAt = null;
      pausedAt = null;
      halted = false;
      clearTimer();
      publish({ ...initialState });
    }
    if (!target) return false;
    if (!available()) {
      clearTimer();
      pausedAt ??= Date.now();
      if (!inFlight) publish({ state: "waiting" });
      return false;
    }
    if (pausedAt !== null) {
      if (startedAt !== null) startedAt += Date.now() - pausedAt;
      pausedAt = null;
    }
    return true;
  };

  const schedule = () => {
    if (disposed || inFlight || !synchronize() || halted || timer !== undefined)
      return;
    if (remaining() <= 0) {
      halted = true;
      publish({ state: "retry", retryOnly: true });
      return;
    }
    const delay = Math.min(
      delays[Math.min(Math.max(attempts - 1, 0), delays.length - 1)],
      remaining(),
    );
    timer = setTimeout(() => {
      timer = undefined;
      void check(false);
    }, delay);
  };

  const check = (manual: boolean): Promise<void> => {
    if (disposed) return Promise.resolve();
    const canStart = synchronize();
    if (inFlight) return inFlight;
    if (!canStart || !target || (!manual && halted)) return Promise.resolve();
    if (!manual && remaining() <= 0) {
      halted = true;
      publish({ state: "retry", retryOnly: true });
      return Promise.resolve();
    }
    clearTimer();
    const captured = target;
    const version = generation;
    startedAt ??= Date.now();
    attempts++;
    publish({ state: "checking" });
    // Defer invocation one microtask so even a synchronous SDK busy publication
    // sees the in-flight guard before it can call update().
    inFlight = Promise.resolve().then(async () => {
      try {
        if (!currentMatches(captured, version) || !available()) return;
        const result = await captured.client.observeWallet!(captured.signature);
        if (!currentMatches(captured, version)) return;
        const latest = await captured.client.status();
        if (
          !currentMatches(captured, version) ||
          latest.noteId !== captured.noteId
        )
          return;
        options.onStatus(latest);
        const terminal = terminalResults.has(result.state);
        halted ||= terminal;
        publish({
          lastResult: result.state,
          state: terminal
            ? ["complete", "ready", "changed"].includes(result.state)
              ? "idle"
              : "retry"
            : result.state === "pending"
              ? "waiting"
              : "retry",
          retryOnly:
            state.retryOnly || (terminal && result.state !== "complete"),
        });
      } catch {
        if (currentMatches(captured, version))
          publish({ state: "retry", lastResult: "error" });
      } finally {
        inFlight = null;
        if (!disposed) {
          // A switched target waits for the old read to finish, then starts its
          // own observation; late results from the old target are discarded.
          const changed = !sameTarget(target, targetFor(options.getCurrent()));
          const canStart = synchronize();
          if (canStart && changed) void check(false);
          else schedule();
        }
      }
    });
    return inFlight;
  };

  return {
    update() {
      if (
        disposed ||
        !synchronize() ||
        inFlight ||
        timer !== undefined ||
        halted
      )
        return;
      void check(false);
    },
    checkNow() {
      return check(true);
    },
    dispose() {
      disposed = true;
      generation++;
      clearTimer();
    },
  };
}

interface HookOptions extends Source {
  onStatus(status: ClientStatus): void;
}

export function useWalletObservation({
  handle,
  status,
  onStatus,
}: HookOptions) {
  const latest = useRef({ handle, status, onStatus });
  latest.current = { handle, status, onStatus };
  const controller = useRef<ReturnType<typeof createWalletObservation> | null>(
    null,
  );
  const [observation, setObservation] =
    useState<WalletObservationState>(initialState);

  useEffect(() => {
    const observer = createWalletObservation({
      getCurrent: () => latest.current,
      onStatus: (next) => latest.current.onStatus(next),
      onChange: setObservation,
      canObserve: () =>
        document.visibilityState !== "hidden" && navigator.onLine !== false,
    });
    controller.current = observer;
    const update = () => observer.update();
    document.addEventListener("visibilitychange", update);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    observer.update();
    return () => {
      observer.dispose();
      controller.current = null;
      document.removeEventListener("visibilitychange", update);
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);

  useEffect(() => controller.current?.update(), [handle, status]);
  const checkNow = useCallback(
    () => controller.current?.checkNow() ?? Promise.resolve(),
    [],
  );

  return {
    ...observation,
    supported: typeof handle?.client.observeWallet === "function",
    checkNow,
  };
}
