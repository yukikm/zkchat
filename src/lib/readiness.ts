import { parseStrictJson } from "@zkapi/solana-sdk/trust";

export interface ServiceReadiness {
  admission: "enabled" | "suspended";
  invitationRequired: boolean;
  recovery: "enabled" | "suspended";
  servicesAvailable: boolean;
  expiresAt: number;
  checkedAt: number;
}

class RetryableReadinessError extends Error {}

// Control probes may take 45s and the public relay allows 48s. Leave room
// for transport without changing the observation's five-second validity.
const READINESS_TIMEOUT_MS = 60_000;

/** HTTPS observations, not a proof of provider credit or successful AUTH. */
export async function checkServiceReadiness(
  deployment: { origin: string; id: string; manifestHash: string },
  fetcher: typeof fetch = globalThis.fetch,
  signal?: AbortSignal,
): Promise<ServiceReadiness> {
  const origin = new URL(deployment.origin);
  if (origin.protocol !== "https:" || origin.origin !== deployment.origin)
    throw new Error("Invalid control origin.");
  async function read(
    path: string,
    timeoutMs: number,
  ): Promise<Record<string, unknown>> {
    signal?.throwIfAborted();
    let response: Response;
    try {
      response = await fetcher(origin.origin + path, {
        credentials: "omit",
        redirect: "error",
        cache: "no-store",
        signal: signal
          ? AbortSignal.any([signal, AbortSignal.timeout(timeoutMs)])
          : AbortSignal.timeout(timeoutMs),
      });
    } catch {
      signal?.throwIfAborted();
      throw new RetryableReadinessError("Service readiness is unavailable.");
    }
    if (!response.ok) {
      await response.body?.cancel().catch(() => {});
      if ([429, 502, 503, 504].includes(response.status))
        throw new RetryableReadinessError("Service readiness is unavailable.");
      throw new Error("Service readiness is unavailable.");
    }
    if (!response.body) throw new Error("Invalid readiness response.");
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read().catch(() => {
          throw new RetryableReadinessError(
            "Service readiness is unavailable.",
          );
        });
        if (done) break;
        size += value.length;
        if (size > 64 * 1024)
          throw new Error("Readiness response is too large.");
        chunks.push(value);
      }
    } finally {
      await reader.cancel().catch(() => {});
      reader.releaseLock();
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.length;
    }
    let json: unknown;
    try {
      json = parseStrictJson(bytes, 64 * 1024);
    } catch {
      throw new Error("Invalid readiness response.");
    }
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw new Error("Invalid readiness response.");
    return json as Record<string, unknown>;
  }
  async function readVerified<T>(
    path: string,
    verify: (value: Record<string, unknown>) => T,
    mayRetry = true,
    timeoutMs = 15_000,
  ): Promise<T> {
    for (let attempt = 0; ; attempt++) {
      try {
        return verify(await read(path, timeoutMs));
      } catch (error) {
        signal?.throwIfAborted();
        if (
          attempt !== 0 ||
          !mayRetry ||
          !(error instanceof RetryableReadinessError)
        )
          throw error;
      }
    }
  }
  // Fetch configuration first so its latency cannot consume the five-second
  // lifetime of the readiness observation. Retries remain read-only and bounded.
  const relay = await readVerified("/relay-status", (value) => {
    if (
      value.schema !== 1 ||
      value.scope !== "relay_configuration_only" ||
      !["enabled", "suspended"].includes(String(value.admission)) ||
      !["enabled", "suspended"].includes(String(value.recovery)) ||
      typeof value.invitation_required !== "boolean"
    )
      throw new Error("Unverified service readiness.");
    return {
      admission: value.admission as ServiceReadiness["admission"],
      recovery: value.recovery as ServiceReadiness["recovery"],
      invitationRequired: value.invitation_required,
    };
  });
  return readVerified(
    "/zkapi/v1/readiness",
    (readiness) => {
      const now = Date.now() / 1000;
      const completed = readiness.completed_at;
      const expires = readiness.expires_at;
      if (
        readiness.schema !== 1 ||
        readiness.scope !== "read_only_capabilities" ||
        readiness.deployment_id !== deployment.id ||
        readiness.manifest_hash !== deployment.manifestHash ||
        !Number.isSafeInteger(completed) ||
        !Number.isSafeInteger(expires) ||
        (completed as number) > now + 5 ||
        (expires as number) <= (completed as number) ||
        (expires as number) > (completed as number) + 5
      )
        throw new Error("Unverified service readiness.");
      const servicesAvailable = [
        readiness.control,
        readiness.indexer,
        readiness.signer,
      ].every((value) => value === "available");
      if ((expires as number) <= now) {
        // Never use a retry to replace an observation that already denies work.
        if (servicesAvailable && relay.admission === "enabled")
          throw new RetryableReadinessError("Expired service readiness.");
        throw new Error("Expired service readiness.");
      }
      return {
        admission: relay.admission,
        invitationRequired: relay.invitationRequired,
        recovery: relay.recovery,
        servicesAvailable,
        expiresAt: (expires as number) * 1000,
        checkedAt: Date.now(),
      };
    },
    relay.admission === "enabled",
    READINESS_TIMEOUT_MS,
  );
}
