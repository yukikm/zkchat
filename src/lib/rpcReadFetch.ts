import { parseStrictJson } from "@zkapi/solana-sdk/trust";

const readMethods = new Set([
  "getGenesisHash",
  "getAccountInfo",
  "getMultipleAccounts",
  "getBlock",
]);
const minimumDelayMs = 10_000;
const maximumDelayMs = 15_000;

function isRpcRead(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  authenticatedUrl: string | undefined,
) {
  const request = input instanceof Request ? input : undefined;
  if (
    !authenticatedUrl ||
    (request?.url ?? String(input)) !== authenticatedUrl ||
    (init?.method ?? request?.method ?? "GET").toUpperCase() !== "POST" ||
    typeof init?.body !== "string"
  )
    return false;
  try {
    // Reject duplicate keys and batches instead of guessing which operation a
    // server would execute. A Request body stream is never read or replayed.
    const value = parseStrictJson(
      new TextEncoder().encode(init.body),
      1024 * 1024,
    );
    if (!value || typeof value !== "object" || Array.isArray(value))
      return false;
    const rpc = value as Record<string, unknown>;
    return (
      rpc.jsonrpc === "2.0" &&
      typeof rpc.method === "string" &&
      readMethods.has(rpc.method) &&
      (rpc.params === undefined ||
        (rpc.params !== null && typeof rpc.params === "object")) &&
      (rpc.id === undefined ||
        rpc.id === null ||
        typeof rpc.id === "string" ||
        (typeof rpc.id === "number" && Number.isFinite(rpc.id)))
    );
  } catch {
    return false;
  }
}

function retryDelay(response: Response) {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return minimumDelayMs;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1000
    : Date.parse(value) - Date.now();
  return Number.isNaN(delay) ? minimumDelayMs : Math.max(minimumDelayMs, delay);
}

function waitForRetry(delay: number, signal?: AbortSignal) {
  signal?.throwIfAborted();
  return new Promise<void>((resolve, reject) => {
    const abort = () => {
      clearTimeout(timer);
      reject(signal!.reason);
    };
    const timer = setTimeout(() => {
      signal?.removeEventListener("abort", abort);
      resolve();
    }, delay);
    signal?.addEventListener("abort", abort, { once: true });
  });
}

/** Retry one rate-limited RPC read within the SDK's existing deadline.
 * The authenticated RPC URL and method allowlist exclude transactions, quotes,
 * authorization and inference. Never retry an entire client operation. */
export function createRpcReadFetch(
  rpcUrl: () => string | undefined,
  fetcher: typeof fetch,
): typeof fetch {
  return async (input, init) => {
    if (!isRpcRead(input, init, rpcUrl())) return fetcher(input, init);
    const signal =
      init?.signal ?? (input instanceof Request ? input.signal : undefined);
    signal?.throwIfAborted();
    const response = await fetcher(input, init);
    if (response.status !== 429) return response;
    const delay = retryDelay(response);
    // A longer server backoff cannot fit this bounded retry. Return its original
    // response intact; do not shorten Retry-After or replace the SDK's signal.
    if (delay > maximumDelayMs) return response;
    void response.body?.cancel().catch(() => {});
    await waitForRetry(delay, signal);
    signal?.throwIfAborted();
    return fetcher(input, init);
  };
}
