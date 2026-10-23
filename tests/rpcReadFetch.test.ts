import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createRpcReadFetch } from "../src/lib/rpcReadFetch";

const rpcUrl = "https://rpc.example/rpc";
const read = (method = "getBlock"): RequestInit => ({
  method: "POST",
  body: JSON.stringify({ jsonrpc: "2.0", id: "read-1", method, params: [] }),
  headers: { "Content-Type": "application/json" },
  credentials: "omit",
  redirect: "error",
});

describe("bounded RPC read rate-limit recovery", () => {
  beforeEach(() => {
    vi.useFakeTimers();
    vi.setSystemTime(new Date("2026-10-23T00:00:00Z"));
  });
  afterEach(() => {
    vi.useRealTimers();
    vi.restoreAllMocks();
  });

  it.each([
    "getGenesisHash",
    "getAccountInfo",
    "getMultipleAccounts",
    "getBlock",
  ])(
    "retries %s once after ten seconds, preserving the SDK request and deadline",
    async (method) => {
      const controller = new AbortController();
      const init = { ...read(method), signal: controller.signal };
      const limited = new Response("rate limited", { status: 429 });
      const cancel = vi.spyOn(limited.body!, "cancel");
      const ready = Response.json({ jsonrpc: "2.0", id: "read-1", result: {} });
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(limited)
        .mockResolvedValueOnce(ready);
      const result = createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, init);
      await vi.advanceTimersByTimeAsync(9999);
      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(cancel).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(ready);
      expect(ready.bodyUsed).toBe(false);
      expect(fetcher.mock.calls).toHaveLength(2);
      for (const [input, options] of fetcher.mock.calls) {
        expect(input).toBe(rpcUrl);
        expect(options).toBe(init);
        expect(options?.signal).toBe(controller.signal);
      }
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it.each([
    ["0", 10_000],
    ["5", 10_000],
    ["12", 12_000],
    ["15", 15_000],
    ["Fri, 23 Oct 2026 00:00:14 GMT", 14_000],
    ["Thu, 22 Oct 2026 23:59:59 GMT", 10_000],
    ["invalid", 10_000],
  ])(
    "honors Retry-After %s without retrying before %s ms",
    async (retryAfter, delay) => {
      const ready = new Response("ready");
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValueOnce(
          new Response(null, {
            status: 429,
            headers: { "Retry-After": retryAfter },
          }),
        )
        .mockResolvedValueOnce(ready);
      const result = createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, read());
      await vi.advanceTimersByTimeAsync(delay - 1);
      expect(fetcher).toHaveBeenCalledOnce();
      await vi.advanceTimersByTimeAsync(1);
      expect(await result).toBe(ready);
      expect(fetcher).toHaveBeenCalledTimes(2);
    },
  );

  it.each(["16", "Fri, 23 Oct 2026 00:00:16 GMT", "99999999999999999999"])(
    "returns a longer Retry-After %s intact instead of retrying early",
    async (retryAfter) => {
      const limited = new Response("try later", {
        status: 429,
        headers: { "Retry-After": retryAfter },
      });
      const cancel = vi.spyOn(limited.body!, "cancel");
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(limited);
      expect(
        await createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, read()),
      ).toBe(limited);
      await vi.runAllTimersAsync();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(cancel).not.toHaveBeenCalled();
      expect(limited.bodyUsed).toBe(false);
    },
  );

  it("does not retry or consume a second rate-limit response", async () => {
    const second = new Response("still rate limited", { status: 429 });
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(second);
    const result = createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, read());
    await vi.runAllTimersAsync();
    expect(await result).toBe(second);
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(second.bodyUsed).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it.each(["init", "Request"])(
    "stops the delay when the %s signal aborts",
    async (source) => {
      const controller = new AbortController();
      const input =
        source === "Request"
          ? new Request(rpcUrl, { method: "POST", signal: controller.signal })
          : rpcUrl;
      const init =
        source === "init" ? { ...read(), signal: controller.signal } : read();
      const fetcher = vi
        .fn<typeof fetch>()
        .mockResolvedValue(new Response(null, { status: 429 }));
      const result = createRpcReadFetch(() => rpcUrl, fetcher)(input, init);
      const reason = new DOMException("SDK deadline", "AbortError");
      const rejected = expect(result).rejects.toBe(reason);
      await vi.advanceTimersByTimeAsync(1000);
      controller.abort(reason);
      await vi.runAllTimersAsync();
      await rejected;
      expect(fetcher).toHaveBeenCalledOnce();
      expect(vi.getTimerCount()).toBe(0);
    },
  );

  it("supports a Request URL/method and replayable init.body without reading its body", async () => {
    const request = new Request(rpcUrl, {
      method: "POST",
      body: "original stream",
      headers: { Accept: "application/json" },
    });
    const init = { body: read().body };
    const ready = new Response("ready");
    const fetcher = vi
      .fn<typeof fetch>()
      .mockResolvedValueOnce(new Response(null, { status: 429 }))
      .mockResolvedValueOnce(ready);
    const result = createRpcReadFetch(() => rpcUrl, fetcher)(request, init);
    await vi.runAllTimersAsync();
    expect(await result).toBe(ready);
    expect(fetcher.mock.calls).toEqual([
      [request, init],
      [request, init],
    ]);
    expect(request.bodyUsed).toBe(false);
  });

  it.each([
    ["off URL", `${rpcUrl}?other=1`, read(), rpcUrl],
    ["other origin", "https://other.example/rpc", read(), rpcUrl],
    ["no authenticated URL", rpcUrl, read(), undefined],
    ["GET", rpcUrl, { ...read(), method: "GET" }, rpcUrl],
    ["mutation", rpcUrl, read("sendTransaction"), rpcUrl],
    ["another read", rpcUrl, read("getBalance"), rpcUrl],
    ["no body", rpcUrl, { method: "POST" }, rpcUrl],
    [
      "non-string body",
      rpcUrl,
      { ...read(), body: new TextEncoder().encode(String(read().body)) },
      rpcUrl,
    ],
    ["batch", rpcUrl, { ...read(), body: `[${read().body}]` }, rpcUrl],
    ["invalid JSON", rpcUrl, { ...read(), body: "not JSON" }, rpcUrl],
    [
      "wrong version",
      rpcUrl,
      { ...read(), body: '{"jsonrpc":"1.0","method":"getBlock"}' },
      rpcUrl,
    ],
    [
      "duplicate method",
      rpcUrl,
      {
        ...read(),
        body: '{"jsonrpc":"2.0","method":"sendTransaction","method":"getBlock"}',
      },
      rpcUrl,
    ],
    [
      "invalid params",
      rpcUrl,
      {
        ...read(),
        body: '{"jsonrpc":"2.0","method":"getBlock","params":"invalid"}',
      },
      rpcUrl,
    ],
    ["Request body only", new Request(rpcUrl, read()), undefined, rpcUrl],
  ] as const)(
    "passes through %s without retry or body consumption",
    async (_label, input, init, authenticatedUrl) => {
      const limited = new Response("limited", { status: 429 });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(limited);
      expect(
        await createRpcReadFetch(() => authenticatedUrl, fetcher)(input, init),
      ).toBe(limited);
      await vi.runAllTimersAsync();
      expect(fetcher).toHaveBeenCalledExactlyOnceWith(input, init);
      expect(limited.bodyUsed).toBe(false);
    },
  );

  it.each([200, 400, 401, 403, 500, 502, 503, 504])(
    "never retries HTTP %s",
    async (status) => {
      const response = new Response("unchanged", { status });
      const fetcher = vi.fn<typeof fetch>().mockResolvedValue(response);
      expect(
        await createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, read()),
      ).toBe(response);
      await vi.runAllTimersAsync();
      expect(fetcher).toHaveBeenCalledOnce();
      expect(response.bodyUsed).toBe(false);
    },
  );

  it("propagates a network TypeError without retry", async () => {
    const failure = new TypeError("network unavailable");
    const fetcher = vi.fn<typeof fetch>().mockRejectedValue(failure);
    await expect(
      createRpcReadFetch(() => rpcUrl, fetcher)(rpcUrl, read()),
    ).rejects.toBe(failure);
    await vi.runAllTimersAsync();
    expect(fetcher).toHaveBeenCalledOnce();
  });
});
