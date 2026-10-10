import { describe, expect, it } from "vitest";
import type { ClientStatus } from "@zkapi/solana-sdk";
import { reusableSession, providerResponseError } from "../src/lib/sdkStatus";

describe("SDK .8 session and error presentation", () => {
  const session = {
    mode: "direct_openrouter",
    session: { phase: "authorized" },
    canRequest: true,
    busy: false,
  } as ClientStatus;
  it("respects SDK admission and never calls uncertain or busy sessions reusable", () => {
    expect(reusableSession(session)).toBe(true);
    for (const change of [
      { canRequest: false },
      { busy: true },
      { session: null },
      { mode: "proxy" },
    ])
      expect(reusableSession({ ...session, ...change } as ClientStatus)).toBe(
        false,
      );
    expect(reusableSession(null)).toBe(false);
  });
  it.each([
    ["zdr_endpoint_unavailable", "zero data retention"],
    ["model_endpoint_unavailable", "no available endpoint"],
    ["provider_access_denied", "denied access"],
    ["provider_budget_unavailable", "Adding a deposit will not resolve"],
    ["provider_rate_limited", "rate limiting"],
    ["provider_unavailable", "temporarily unavailable"],
    ["provider_request_rejected", "rejected this request"],
  ])("maps %s without echoing provider details", (code, expected) => {
    const response = new Response("private provider detail", {
      status: 403,
      headers: { "X-Zkapi-Error-Code": code },
    });
    const message = providerResponseError(response);
    expect(message).toContain(expected);
    expect(message).toContain("No automatic retry");
    expect(message).not.toContain("private provider detail");
    expect(response.bodyUsed).toBe(false);
  });
  it("does not label unknown errors or successful stream failures as ZDR errors", () => {
    for (const code of ["unknown_secret", "__proto__", "toString", ""])
      expect(
        providerResponseError(
          new Response(null, {
            status: 404,
            headers: { "X-Zkapi-Error-Code": code },
          }),
        ),
      ).toBeUndefined();
    expect(
      providerResponseError(
        new Response(null, {
          headers: { "X-Zkapi-Error-Code": "zdr_endpoint_unavailable" },
        }),
      ),
    ).toBeUndefined();
  });
});
