import { afterEach, describe, expect, it, vi } from "vitest";
import { checkServiceReadiness } from "../src/lib/readiness";
const deployment = {
  origin: "https://control.example",
  id: "deployment",
  manifestHash: "a".repeat(64),
};
function fixtures(relayPatch = {}, readinessPatch = {}) {
  const now = Math.floor(Date.now() / 1000);
  const relay = {
    schema: 1,
    scope: "relay_configuration_only",
    admission: "enabled",
    recovery: "enabled",
    invitation_required: false,
    ...relayPatch,
  };
  const readiness = {
    schema: 1,
    scope: "read_only_capabilities",
    deployment_id: deployment.id,
    manifest_hash: deployment.manifestHash,
    completed_at: now,
    expires_at: now + 5,
    control: "available",
    indexer: "available",
    signer: "available",
    ...readinessPatch,
  };
  const fetcher = vi.fn(async (url: RequestInfo | URL) =>
    Response.json(String(url).endsWith("/relay-status") ? relay : readiness),
  );
  return { fetcher, relay, readiness };
}
describe("live readiness contract", () => {
  afterEach(() => {
    vi.restoreAllMocks();
    vi.useRealTimers();
  });
  it("accepts public no-invitation admission using credential-free, bounded read-only routes", async () => {
    const { fetcher } = fixtures();
    expect(await checkServiceReadiness(deployment, fetcher)).toMatchObject({
      admission: "enabled",
      invitationRequired: false,
      servicesAvailable: true,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      deployment.origin + "/relay-status",
      deployment.origin + "/zkapi/v1/readiness",
    ]);
    for (const call of fetcher.mock.calls)
      expect(call[1]).toMatchObject({
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
      });
  });
  it.each([
    { manifest_hash: "b".repeat(64) },
    { deployment_id: "another-deployment" },
    { expires_at: Math.floor(Date.now() / 1000) - 1 },
    { expires_at: Math.floor(Date.now() / 1000) + 60 },
    { scope: "not_a_readiness_check" },
  ])(
    "rejects wrong identity, stale or invalid observations: %j",
    async (patch) => {
      await expect(
        checkServiceReadiness(deployment, fixtures({}, patch).fetcher),
      ).rejects.toThrow();
    },
  );
  it("distinguishes invitation gating, suspended admission, and unavailable signer", async () => {
    expect(
      await checkServiceReadiness(
        deployment,
        fixtures(
          { invitation_required: true, admission: "suspended" },
          { signer: "unavailable" },
        ).fetcher,
      ),
    ).toMatchObject({
      invitationRequired: true,
      admission: "suspended",
      servicesAvailable: false,
    });
  });
  it("refuses malformed, duplicate-field, oversized and HTTP error responses", async () => {
    for (const body of ['{"schema":1,"schema":1}', " ".repeat(65537), null]) {
      await expect(
        checkServiceReadiness(
          deployment,
          async () => new Response(body, { status: body === null ? 503 : 200 }),
        ),
      ).rejects.toThrow();
    }
  });

  it("fetches readiness after a slow relay response without aging its five-second window", async () => {
    let now = 1_800_000_000_000;
    vi.spyOn(Date, "now").mockImplementation(() => now);
    const { relay } = fixtures();
    const requestedAt: number[] = [];
    const fetcher = vi.fn(async (url: RequestInfo | URL) => {
      requestedAt.push(now);
      if (String(url).endsWith("/relay-status")) {
        await Promise.resolve();
        now += 10_000;
        return Response.json(relay);
      }
      return Response.json(fixtures().readiness);
    });
    expect(await checkServiceReadiness(deployment, fetcher)).toMatchObject({
      servicesAvailable: true,
      checkedAt: now,
      expiresAt: now + 5000,
    });
    expect(requestedAt).toEqual([1_800_000_000_000, 1_800_000_010_000]);
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rechecks a valid but expired readiness response once", async () => {
    const { relay, readiness } = fixtures();
    const stale = {
      ...readiness,
      completed_at: readiness.completed_at - 10,
      expires_at: readiness.expires_at - 10,
    };
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(relay))
      .mockResolvedValueOnce(Response.json(stale))
      .mockResolvedValueOnce(Response.json(readiness));
    expect(await checkServiceReadiness(deployment, fetcher)).toMatchObject({
      servicesAvailable: true,
    });
    expect(fetcher.mock.calls.map(([url]) => url)).toEqual([
      deployment.origin + "/relay-status",
      deployment.origin + "/zkapi/v1/readiness",
      deployment.origin + "/zkapi/v1/readiness",
    ]);
  });

  it("waits for a slow upstream probe while requiring a fresh observation", async () => {
    vi.useFakeTimers();
    // Native AbortSignal.timeout does not use Vitest's fake clock.
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/relay-status"))
          return Response.json(fixtures().relay);
        return new Promise<Response>((resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "TimeoutError")),
            { once: true },
          );
          // A 45s probe plus relay/transport time exceeds the old app bounds.
          setTimeout(
            () => resolve(Response.json(fixtures().readiness)),
            49_000,
          );
        });
      },
    );
    const result = checkServiceReadiness(deployment, fetcher);
    const assertion = expect(result).resolves.toMatchObject({
      servicesAvailable: true,
    });
    await vi.advanceTimersByTimeAsync(49_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("cancels an in-flight check without retrying", async () => {
    const controller = new AbortController();
    let started!: () => void;
    const ready = new Promise<void>((resolve) => {
      started = resolve;
    });
    const fetcher = vi.fn(
      async (_url: RequestInfo | URL, init?: RequestInit) =>
        new Promise<Response>((_resolve, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(init!.signal!.reason),
            { once: true },
          );
          started();
        }),
    );
    const result = checkServiceReadiness(
      deployment,
      fetcher,
      controller.signal,
    );
    const assertion = expect(result).rejects.toThrow("User stopped");
    await ready;
    controller.abort(new Error("User stopped"));
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("bounds a stalled readiness check and its single retry", async () => {
    vi.useFakeTimers();
    vi.spyOn(AbortSignal, "timeout").mockImplementation((ms) => {
      const controller = new AbortController();
      setTimeout(() => controller.abort(), ms);
      return controller.signal;
    });
    const fetcher = vi.fn(
      async (url: RequestInfo | URL, init?: RequestInit) => {
        if (String(url).endsWith("/relay-status"))
          return Response.json(fixtures().relay);
        return new Promise<Response>((_, reject) => {
          init!.signal!.addEventListener(
            "abort",
            () => reject(new DOMException("Timed out", "TimeoutError")),
            { once: true },
          );
        });
      },
    );
    const result = checkServiceReadiness(deployment, fetcher);
    const assertion = expect(result).rejects.toThrow(
      "Service readiness is unavailable.",
    );
    await vi.advanceTimersByTimeAsync(120_000);
    await assertion;
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(["relay", "readiness"] as const)(
    "retries one transient %s GET without repeating the other route",
    async (route) => {
      const { relay, readiness } = fixtures();
      const fetcher = vi.fn();
      if (route === "relay") {
        fetcher.mockRejectedValueOnce(new TypeError("private network detail"));
        fetcher.mockResolvedValueOnce(Response.json(relay));
      } else {
        fetcher.mockResolvedValueOnce(Response.json(relay));
        fetcher.mockRejectedValueOnce(new TypeError("private network detail"));
      }
      fetcher.mockResolvedValueOnce(Response.json(readiness));
      expect(await checkServiceReadiness(deployment, fetcher)).toMatchObject({
        servicesAvailable: true,
      });
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it.each([429, 502, 503, 504])("retries HTTP %i once", async (status) => {
    const { relay, readiness } = fixtures();
    const fetcher = vi
      .fn()
      .mockResolvedValueOnce(Response.json(relay))
      .mockResolvedValueOnce(new Response("private response", { status }))
      .mockResolvedValueOnce(Response.json(readiness));
    expect(await checkServiceReadiness(deployment, fetcher)).toMatchObject({
      servicesAvailable: true,
    });
    expect(fetcher).toHaveBeenCalledTimes(3);
  });

  it.each(["stale", "network", "http"] as const)(
    "fails closed after exhausting the %s retry",
    async (failure) => {
      const { relay, readiness } = fixtures();
      const fetcher = vi.fn().mockResolvedValueOnce(Response.json(relay));
      if (failure === "stale") {
        const stale = {
          ...readiness,
          completed_at: readiness.completed_at - 10,
          expires_at: readiness.expires_at - 10,
        };
        fetcher.mockImplementation(async () => Response.json(stale));
      } else if (failure === "network") {
        fetcher.mockRejectedValue(new TypeError("private network detail"));
      } else {
        fetcher.mockImplementation(
          async () => new Response("private body", { status: 503 }),
        );
      }
      await expect(checkServiceReadiness(deployment, fetcher)).rejects.toThrow(
        /^(Expired service readiness\.|Service readiness is unavailable\.)$/,
      );
      expect(fetcher).toHaveBeenCalledTimes(3);
    },
  );

  it.each([
    { schema: 2 },
    { deployment_id: "other" },
    { manifest_hash: "b".repeat(64) },
    { expires_at: Math.floor(Date.now() / 1000) + 60 },
  ])("does not retry an invalid readiness observation: %j", async (patch) => {
    const { fetcher } = fixtures({}, patch);
    await expect(checkServiceReadiness(deployment, fetcher)).rejects.toThrow(
      "Unverified service readiness.",
    );
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("rejects invalid relay configuration before fetching readiness", async () => {
    const { fetcher } = fixtures({ admission: "unknown" });
    await expect(checkServiceReadiness(deployment, fetcher)).rejects.toThrow();
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it.each([400, 401, 403, 404, 500])(
    "does not retry HTTP %i",
    async (status) => {
      const fetcher = vi.fn(
        async () => new Response("private body", { status }),
      );
      await expect(checkServiceReadiness(deployment, fetcher)).rejects.toThrow(
        "Service readiness is unavailable.",
      );
      expect(fetcher).toHaveBeenCalledTimes(1);
    },
  );

  it.each(["suspended", "unavailable"] as const)(
    "does not replace a %s observation with a retry, even when stale",
    async (denial) => {
      const { relay, readiness } = fixtures(
        denial === "suspended" ? { admission: "suspended" } : {},
        denial === "unavailable" ? { signer: "unavailable" } : {},
      );
      for (const stale of [false, true]) {
        const observation = stale
          ? {
              ...readiness,
              completed_at: readiness.completed_at - 10,
              expires_at: readiness.expires_at - 10,
            }
          : readiness;
        const fetcher = vi
          .fn()
          .mockResolvedValueOnce(Response.json(relay))
          .mockResolvedValueOnce(Response.json(observation));
        if (stale) {
          await expect(
            checkServiceReadiness(deployment, fetcher),
          ).rejects.toThrow("Expired service readiness.");
        } else {
          expect(
            await checkServiceReadiness(deployment, fetcher),
          ).toMatchObject(
            denial === "suspended"
              ? { admission: "suspended" }
              : { servicesAvailable: false },
          );
        }
        expect(fetcher).toHaveBeenCalledTimes(2);
      }
    },
  );
});
