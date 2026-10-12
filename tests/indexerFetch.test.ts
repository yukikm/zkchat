import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createIndexerSnapshotFetch } from "../src/lib/indexerFetch";

const origin = "https://indexer.example";
const snapshotUrl = `${origin}/zkapi/v1/tree/snapshot`;
const pinnedUrl = `${origin}/zkapi/v1/tree/snapshots/${"a".repeat(64)}.json`;

describe("indexer snapshot fetch recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-12T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([429, 502, 503, 504])(
    "retries HTTP %s once after the snapshot publication interval",
    async (status) => {
      const unavailable = new Response("temporarily unavailable", { status });
      const cancel = vi.spyOn(unavailable.body!, "cancel");
      const ready = Response.json({ snapshot: "ready" });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(unavailable)
        .mockResolvedValueOnce(ready);
      const fetchSnapshot = createIndexerSnapshotFetch(origin, fetcher);

      const result = fetchSnapshot(snapshotUrl);
      await vi.advanceTimersByTimeAsync(2499);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledTimes(1);
      await vi.advanceTimersByTimeAsync(1);

      expect(await result).toBe(ready);
      expect(fetcher).toHaveBeenCalledTimes(2);
      expect(ready.bodyUsed).toBe(false);
    },
  );

  it("also retries content-addressed snapshot reads", async () => {
    const ready = new Response("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(ready);
    const result = createIndexerSnapshotFetch(origin, fetcher)(pinnedUrl);

    await vi.advanceTimersByTimeAsync(2500);

    expect(await result).toBe(ready);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("retries a network TypeError once", async () => {
    const ready = new Response("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("Failed to fetch"))
      .mockResolvedValueOnce(ready);
    const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);

    await vi.advanceTimersByTimeAsync(2499);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe(ready);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("returns a second transient response without another retry or consuming it", async () => {
    const stillUnavailable = new Response("still unavailable", { status: 503 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(stillUnavailable);
    const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);

    await vi.runAllTimersAsync();

    expect(await result).toBe(stillUnavailable);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(stillUnavailable.bodyUsed).toBe(false);
  });

  it("preserves a second network failure without retrying again", async () => {
    const error = new TypeError("still offline");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockRejectedValueOnce(new TypeError("offline"))
      .mockRejectedValueOnce(error);
    const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);
    const rejected = expect(result).rejects.toBe(error);

    await vi.runAllTimersAsync();

    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each([
    ["5", 5000],
    ["Mon, 12 Oct 2026 00:00:06 GMT", 6000],
    ["10", 10000],
    ["0", 2500],
    ["1", 2500],
    ["Sun, 11 Oct 2026 23:59:59 GMT", 2500],
    ["invalid", 2500],
  ])("honors Retry-After %s with a %s ms wait", async (retryAfter, delay) => {
    const ready = new Response("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(
        new Response(null, {
          status: 503,
          headers: { "Retry-After": retryAfter },
        }),
      )
      .mockResolvedValueOnce(ready);
    const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);

    await vi.advanceTimersByTimeAsync(delay - 1);
    expect(fetcher).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(1);

    expect(await result).toBe(ready);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it.each(["11", "Mon, 12 Oct 2026 00:00:11 GMT"])(
    "does not retry early when Retry-After exceeds the wait budget: %s",
    async (retryAfter) => {
      const unavailable = new Response("try later", {
        status: 503,
        headers: { "Retry-After": retryAfter },
      });
      const cancel = vi.spyOn(unavailable.body!, "cancel");
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(unavailable);
      const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);

      await vi.runAllTimersAsync();

      expect(await result).toBe(unavailable);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cancel).not.toHaveBeenCalled();
      expect(unavailable.bodyUsed).toBe(false);
    },
  );

  it.each([
    "http://indexer.example/zkapi/v1/tree/snapshot",
    "https://other.example/zkapi/v1/tree/snapshot",
    "https://indexer.example.evil.example/zkapi/v1/tree/snapshot",
    "https://indexer.example:444/zkapi/v1/tree/snapshot",
    "https://user:password@indexer.example/zkapi/v1/tree/snapshot",
    `${snapshotUrl}?request=1`,
    `${snapshotUrl}#fragment`,
    `${snapshotUrl}/`,
    `${snapshotUrl}/extra`,
    `${origin}/zkapi/v1/tree/snapshots/${"A".repeat(64)}.json`,
    `${origin}/zkapi/v1/tree/snapshots/${"a".repeat(63)}.json`,
    `${origin}/zkapi/v1/tree/snapshots/${"a".repeat(65)}.json`,
    `${origin}/zkapi/v1/tree/snapshots/${"g".repeat(64)}.json`,
    `${origin}/zkapi/v1/tree/snapshots/${"a".repeat(64)}.json/extra`,
    `${origin}/zkapi/v1/quote`,
    `${origin}/v1/chat/completions`,
  ])(
    "does not retry outside the exact snapshot URL allowlist: %s",
    async (url) => {
      const unavailable = new Response("unavailable", { status: 503 });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(unavailable);
      const result = createIndexerSnapshotFetch(origin, fetcher)(url);

      await vi.runAllTimersAsync();

      expect(await result).toBe(unavailable);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(unavailable.bodyUsed).toBe(false);
    },
  );

  it.each(["POST", "PUT", "PATCH", "DELETE", "HEAD"])(
    "does not retry a %s request even at a snapshot URL",
    async (method) => {
      const unavailable = new Response(null, { status: 503 });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(unavailable);
      const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl, {
        method,
      });

      await vi.runAllTimersAsync();

      expect(await result).toBe(unavailable);
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each([400, 401, 403, 404, 409, 500])(
    "passes HTTP %s through without a retry",
    async (status) => {
      const response = new Response("failure", { status });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);

      await vi.runAllTimersAsync();

      expect(await result).toBe(response);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(response.bodyUsed).toBe(false);
    },
  );

  it("leaves malformed successful payload validation to the SDK", async () => {
    const response = new Response("not valid snapshot JSON", { status: 200 });
    const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
    const result = await createIndexerSnapshotFetch(
      origin,
      fetcher,
    )(snapshotUrl);

    expect(result).toBe(response);
    expect(response.bodyUsed).toBe(false);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([
    new Error("unexpected failure"),
    new DOMException("canceled", "AbortError"),
    new DOMException("deadline exceeded", "TimeoutError"),
    { name: "TypeError", message: "not a network exception" },
  ])("does not retry arbitrary or cancellation failures: %s", async (error) => {
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(error);
    const result = createIndexerSnapshotFetch(origin, fetcher)(snapshotUrl);
    const rejected = expect(result).rejects.toBe(error);

    await vi.runAllTimersAsync();

    await rejected;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("preserves request controls and reuses the SDK timeout signal on retry", async () => {
    const sdkController = new AbortController();
    const init: RequestInit = {
      method: "GET",
      signal: sdkController.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      mode: "cors",
      referrerPolicy: "no-referrer",
    };
    const ready = new Response("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 503 }))
      .mockResolvedValueOnce(ready);
    const result = createIndexerSnapshotFetch(origin, fetcher)(
      snapshotUrl,
      init,
    );

    await vi.runAllTimersAsync();

    expect(await result).toBe(ready);
    expect(fetcher).toHaveBeenCalledTimes(2);
    for (const [input, options] of fetcher.mock.calls) {
      expect(input).toBe(snapshotUrl);
      expect(options).toEqual(init);
      expect(options?.signal).toBe(sdkController.signal);
    }
    expect(init.signal).toBe(sdkController.signal);
  });

  it("preserves Request input controls and its signal across retries", async () => {
    const sdkController = new AbortController();
    const request = new Request(pinnedUrl, {
      signal: sdkController.signal,
      headers: { Accept: "application/json" },
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
    });
    const sent: Request[] = [];
    const fetcher = vi.fn<typeof fetch>(async (input, init) => {
      sent.push(new Request(input, init));
      return new Response(null, { status: sent.length === 1 ? 503 : 200 });
    });
    const result = createIndexerSnapshotFetch(origin, fetcher)(request);

    await vi.runAllTimersAsync();

    expect((await result).status).toBe(200);
    expect(sent).toHaveLength(2);
    for (const sentRequest of sent) {
      expect(sentRequest.url).toBe(pinnedUrl);
      expect(sentRequest.method).toBe("GET");
      expect(sentRequest.headers.get("Accept")).toBe("application/json");
      expect(sentRequest.credentials).toBe("omit");
      expect(sentRequest.redirect).toBe("error");
      expect(sentRequest.cache).toBe("no-store");
      expect(sentRequest.signal.aborted).toBe(false);
    }
    sdkController.abort();
    expect(sent.every((sentRequest) => sentRequest.signal.aborted)).toBe(true);
  });

  it.each(["SDK", "caller"])(
    "stops waiting and never retries when the %s signal aborts",
    async (source) => {
      const sdkController = new AbortController();
      const callerController = new AbortController();
      const unavailable = new Response(null, { status: 503 });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(unavailable);
      const result = createIndexerSnapshotFetch(
        origin,
        fetcher,
        () => callerController.signal,
      )(snapshotUrl, { signal: sdkController.signal });
      const reason = new DOMException("request canceled", "AbortError");
      const rejected = expect(result).rejects.toBe(reason);

      await vi.advanceTimersByTimeAsync(1000);
      const controller = source === "SDK" ? sdkController : callerController;
      controller.abort(reason);
      await vi.runAllTimersAsync();

      await rejected;
      expect(fetcher).toHaveBeenCalledTimes(1);
      const [input, options] = fetcher.mock.calls[0];
      expect(new Request(input, options).signal.aborted).toBe(true);
    },
  );
});
