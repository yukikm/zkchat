import { describe, expect, it, vi } from "vitest";
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
  return { fetcher, readiness };
}
describe("live readiness contract", () => {
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
});
