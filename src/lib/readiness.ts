import { parseStrictJson } from "@zkapi/solana-sdk/trust";

export interface ServiceReadiness {
  admission: "enabled" | "suspended";
  invitationRequired: boolean;
  recovery: "enabled" | "suspended";
  servicesAvailable: boolean;
  expiresAt: number;
  checkedAt: number;
}

/** HTTPS observations, not a proof of provider credit or successful AUTH. */
export async function checkServiceReadiness(
  deployment: { origin: string; id: string; manifestHash: string },
  fetcher: typeof fetch = globalThis.fetch,
): Promise<ServiceReadiness> {
  const origin = new URL(deployment.origin);
  if (origin.protocol !== "https:" || origin.origin !== deployment.origin)
    throw new Error("Invalid control origin.");
  async function read(path: string): Promise<Record<string, unknown>> {
    const response = await fetcher(origin.origin + path, {
      credentials: "omit",
      redirect: "error",
      cache: "no-store",
      signal: AbortSignal.timeout(15_000),
    });
    if (!response.ok || !response.body) {
      await response.body?.cancel();
      throw new Error("Service readiness is unavailable.");
    }
    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    try {
      for (;;) {
        const { done, value } = await reader.read();
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
    const json = parseStrictJson(bytes, 64 * 1024);
    if (!json || typeof json !== "object" || Array.isArray(json))
      throw new Error("Invalid readiness response.");
    return json as Record<string, unknown>;
  }
  const [relay, readiness] = await Promise.all([
    read("/relay-status"),
    read("/zkapi/v1/readiness"),
  ]);
  const now = Date.now() / 1000;
  const completed = readiness.completed_at;
  const expires = readiness.expires_at;
  if (
    relay.schema !== 1 ||
    relay.scope !== "relay_configuration_only" ||
    !["enabled", "suspended"].includes(String(relay.admission)) ||
    !["enabled", "suspended"].includes(String(relay.recovery)) ||
    typeof relay.invitation_required !== "boolean" ||
    readiness.schema !== 1 ||
    readiness.scope !== "read_only_capabilities" ||
    readiness.deployment_id !== deployment.id ||
    readiness.manifest_hash !== deployment.manifestHash ||
    !Number.isSafeInteger(completed) ||
    !Number.isSafeInteger(expires) ||
    (completed as number) > now + 5 ||
    (expires as number) <= now ||
    (expires as number) <= (completed as number) ||
    (expires as number) > (completed as number) + 5
  )
    throw new Error("Unverified or expired service readiness.");
  return {
    admission: relay.admission as ServiceReadiness["admission"],
    invitationRequired: relay.invitation_required,
    recovery: relay.recovery as ServiceReadiness["recovery"],
    servicesAvailable: [
      readiness.control,
      readiness.indexer,
      readiness.signer,
    ].every((value) => value === "available"),
    expiresAt: (expires as number) * 1000,
    checkedAt: Date.now(),
  };
}
