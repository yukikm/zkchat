import { describe, expect, it } from "vitest";
import { ClientActionError, type ClientStatus } from "@zkapi/solana-sdk";
import { ControlHttpError } from "@zkapi/solana-sdk/control";
import {
  reusableSession,
  providerResponseError,
  chatFailureMessage,
} from "../src/lib/sdkStatus";

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
    ["model_endpoint_unavailable", "currently unavailable"],
    ["provider_access_denied", "denied access"],
    ["provider_budget_unavailable", "Adding a deposit will not resolve"],
    ["provider_rate_limited", "Wait before trying again"],
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
    expect(message).toContain("Choose Check status");
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

  it("reports known chain and control errors without inferring payment outcome", () => {
    expect(
      chatFailureMessage(new Error("finalized indexer unavailable")),
    ).toContain("indexer is unavailable");
    const http = new ControlHttpError(400);
    http.message = "private quote or credential";
    const message = chatFailureMessage(http);
    expect(message).toContain("payment service returned HTTP 400");
    expect(message).toContain("Choose Check status");
    expect(message).not.toMatch(/private|unsent|not charged|Review payment/);
    expect(
      chatFailureMessage(new ClientActionError("not_ready", "private state")),
    ).toContain("deposit or session is not ready");
  });

  it.each([
    new Error("private witness or provider payload"),
    new Error("__proto__"),
    new Error("toString"),
    { status: 400, message: "private response" },
    "private rejection",
    new ControlHttpError(Number.NaN),
  ])("keeps unknown exceptions private", (error) => {
    expect(chatFailureMessage(error)).toBe(
      "Reply interrupted. Choose Check status before sending again. Nothing is resent automatically.",
    );
  });

  it("uses provider headers only in direct OpenRouter mode", () => {
    const response = new Response("private body", {
      status: 403,
      headers: { "X-Zkapi-Error-Code": "zdr_endpoint_unavailable" },
    });
    expect(chatFailureMessage(new Error("private"), response, true)).toContain(
      "zero data retention",
    );
    expect(chatFailureMessage(new Error("private"), response, false)).toContain(
      "Reply interrupted",
    );
    expect(response.bodyUsed).toBe(false);
  });
});
