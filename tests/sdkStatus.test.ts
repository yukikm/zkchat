import { describe, expect, it } from "vitest";
import { ClientActionError, type ClientStatus } from "@zkapi/solana-sdk";
import { ChatResponseError } from "@zkapi/solana-sdk/chat";
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
    expect(message).toContain("Open Wallet & balance");
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
    expect(message).toContain("Open Wallet & balance");
    expect(message).not.toMatch(/private|unsent|not charged|Review payment/);
    expect(
      chatFailureMessage(new ClientActionError("not_ready", "private state")),
    ).toContain("deposit or session is not ready");
  });

  it.each([
    ["incomplete_stream", 200, "Response completion could not be confirmed."],
    ["invalid_response", 200, "The response could not be validated."],
    ["http_error", 400, "The provider returned HTTP 400."],
    ["http_error", 599, "The provider returned HTTP 599."],
  ] as const)(
    "explains SDK %s without exposing response data or claiming no charge",
    (code, status, reason) => {
      const error = new ChatResponseError(code, "private-operation-id", status);
      error.message = "private response or credential";
      const response = new Response("private provider body", { status });
      const message = chatFailureMessage(error, response, true);
      expect(message).toBe(
        `${reason} Open Wallet & balance before sending again. Nothing is resent automatically.`,
      );
      expect(message).not.toMatch(
        /private|not charged|no charge|no funds|not sent/i,
      );
      expect(response.bodyUsed).toBe(false);
    },
  );

  it.each([Number.NaN, Number.POSITIVE_INFINITY, 399, 600, 401.5])(
    "does not display an invalid provider HTTP status: %s",
    (status) => {
      expect(
        chatFailureMessage(new ChatResponseError("http_error", null, status)),
      ).toBe(
        "The provider request failed. Open Wallet & balance before sending again. Nothing is resent automatically.",
      );
    },
  );

  it("prioritizes known provider guidance over an SDK HTTP error", () => {
    const response = new Response("private provider body", {
      status: 402,
      headers: { "X-Zkapi-Error-Code": "provider_budget_unavailable" },
    });
    const error = new ChatResponseError(
      "http_error",
      "private-operation-id",
      402,
    );
    expect(chatFailureMessage(error, response, true)).toBe(
      "The provider has no available credit. Adding a deposit will not resolve this. Open Wallet & balance before sending again. No automatic retry.",
    );
    expect(response.bodyUsed).toBe(false);
  });

  it.each([
    new Error("private witness or provider payload"),
    new Error("__proto__"),
    new Error("toString"),
    { status: 400, message: "private response" },
    "private rejection",
    new ControlHttpError(Number.NaN),
    new ChatResponseError(
      "private-unknown-code" as ChatResponseError["code"],
      "private-operation-id",
      503,
    ),
    {
      name: "ChatResponseError",
      code: "http_error",
      status: 503,
      operationId: "private-operation-id",
      message: "private response",
    },
    Object.assign(new Error("private response"), {
      name: "ChatResponseError",
      code: "incomplete_stream",
      status: 200,
      operationId: "private-operation-id",
    }),
  ])("keeps unknown exceptions private", (error) => {
    expect(chatFailureMessage(error)).toBe(
      "Reply interrupted. Open Wallet & balance before sending again. Nothing is resent automatically.",
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
