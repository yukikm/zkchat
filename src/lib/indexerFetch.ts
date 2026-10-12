const transientStatuses = new Set([429, 502, 503, 504]);
const retryDelayMs = 2_500;
const maxRetryDelayMs = 10_000;

function snapshotRead(
  input: RequestInfo | URL,
  init: RequestInit | undefined,
  origin: string,
) {
  const request = input instanceof Request ? input : undefined;
  if ((init?.method ?? request?.method ?? "GET").toUpperCase() !== "GET")
    return false;
  let url: URL;
  try {
    url = new URL(request?.url ?? String(input));
  } catch {
    return false;
  }
  return (
    url.origin === origin &&
    !url.username &&
    !url.password &&
    !url.search &&
    !url.hash &&
    (url.pathname === "/zkapi/v1/tree/snapshot" ||
      /^\/zkapi\/v1\/tree\/snapshots\/[0-9a-f]{64}\.json$/.test(url.pathname))
  );
}

function retryAfter(response: Response): number {
  const value = response.headers.get("Retry-After")?.trim();
  if (!value) return retryDelayMs;
  const delay = /^\d+$/.test(value)
    ? Number(value) * 1_000
    : Date.parse(value) - Date.now();
  return Number.isNaN(delay) ? retryDelayMs : Math.max(retryDelayMs, delay);
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

/** Repeat only failed public snapshot GETs, inside the original SDK deadline.
 * The SDK still validates all bytes and the finalized RPC cut. Never replay a
 * quote, AUTH, inference, transaction, or an entire client operation. */
export function createIndexerSnapshotFetch(
  indexerOrigin: string,
  fetcher: typeof fetch,
  requestSignal?: () => AbortSignal | undefined,
): typeof fetch {
  return async (input, init) => {
    if (!snapshotRead(input, init, indexerOrigin)) return fetcher(input, init);
    const signals = [
      init?.signal ?? (input instanceof Request ? input.signal : undefined),
      requestSignal?.(),
    ].filter((signal): signal is AbortSignal => !!signal);
    const signal = signals.length > 1 ? AbortSignal.any(signals) : signals[0];
    const options = { ...init, ...(signal ? { signal } : {}) };
    signal?.throwIfAborted();
    let delay = retryDelayMs;
    let response: Response;
    try {
      response = await fetcher(input, options);
    } catch (error) {
      signal?.throwIfAborted();
      if (!(error instanceof TypeError)) throw error;
      await waitForRetry(delay, signal);
      signal?.throwIfAborted();
      return fetcher(input, options);
    }
    if (!transientStatuses.has(response.status)) return response;
    delay = retryAfter(response);
    // Do not ignore a server's longer backoff or extend the quote's lifetime.
    if (delay > maxRetryDelayMs) return response;
    void response.body?.cancel().catch(() => {});
    await waitForRetry(delay, signal);
    signal?.throwIfAborted();
    return fetcher(input, options);
  };
}
