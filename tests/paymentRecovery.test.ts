import { describe, expect, it } from "vitest";
import type { ClientStatus, RecoveryResult } from "@zkapi/solana-sdk";
import {
  paymentRecoveryDetails,
  paymentRecoveryFeedback,
  recoveryStorageFailure,
} from "../src/lib/paymentRecovery";

const pending = {
  session: { phase: "closing", serverState: "ISSUANCE_UNKNOWN" },
  canRequest: false,
  busy: false,
  mode: "direct_openrouter",
} as ClientStatus;

describe("bounded recovery presentation", () => {
  it.each(["locked", "ownership_changed", "unavailable"] as const)(
    "recognizes the %s backup failure without exposing exception text",
    (code) => {
      const error = Object.assign(new Error("private-vault-token-message"), {
        name: "RecoveryStorageError",
        code,
      });
      const result = recoveryStorageFailure(error);
      expect(result?.kind).toBe(code);
      expect(result?.message).toBeTruthy();
      expect(result?.message).not.toMatch(
        /private-|token|Settlement is still pending|no longer pending/,
      );
      if (code === "locked") {
        expect(result?.message).toContain("still locked");
        expect(result?.message).toContain("other tabs and devices");
        expect(result?.message).toContain("recovery file");
      }
    },
  );

  it("does not infer backup failures from arbitrary exceptions, messages or causes", () => {
    const locked = { name: "RecoveryStorageError", code: "locked" };
    for (const error of [
      null,
      undefined,
      "RecoveryStorageError: locked private-message",
      new Error("locked private-message"),
      { code: "locked", message: "private-message" },
      { ...locked, name: "OtherError" },
      { ...locked, code: "private-code" },
      { ...locked, code: "__proto__" },
      { ...locked, code: null },
      { ...locked, code: ["locked"] },
      { cause: locked },
    ]) {
      expect(recoveryStorageFailure(error)).toBeNull();
    }
  });

  it("does not present a reusable live lease as requiring recovery", () => {
    const status = {
      ...pending,
      canRequest: true,
      session: { phase: "active", serverState: "ACTIVE" },
      recovery: {
        outcome: "pending",
        reasonCode: "settlement_pending",
        serverState: "ACTIVE",
        sessionId: "id",
        recovery: null,
      },
    } as ClientStatus;
    expect(paymentRecoveryDetails(status)).toEqual([]);
    expect(paymentRecoveryFeedback(status)).toEqual({
      error: false,
      message: "Payment status checked. This session is still active.",
    });
  });

  it("preserves the legacy void-return check and does not trust completion over a pending session", () => {
    expect(paymentRecoveryFeedback(pending).message).toContain(
      "Settlement is still pending.",
    );
    expect(
      paymentRecoveryFeedback(pending, {
        outcome: "completed",
      } as RecoveryResult).error,
    ).toBe(true);
    expect(paymentRecoveryFeedback({ ...pending, session: null }).error).toBe(
      false,
    );
  });

  it("honors explicit pending or failed outcomes even without a visible session", () => {
    for (const outcome of ["pending", "failed"] as const)
      expect(
        paymentRecoveryFeedback(
          { ...pending, session: null },
          {
            outcome,
            reasonCode: "gateway_delivery_pending",
            sessionId: null,
            serverState: null,
            recovery: null,
          },
        ).error,
      ).toBe(true);
  });

  it("does not echo arbitrary diagnostics, IDs, exception text or invalid HTTP statuses", () => {
    const status = {
      ...pending,
      recovery: {
        outcome: "failed",
        reasonCode: "private-code",
        serverState: "private-state",
        sessionId: "private-session",
        httpStatus: "private-status",
        message: "private-message",
        recovery: {
          reason_code: "private-code",
          requires_operator_action: false,
          issuance: {
            reason_code: "__proto__",
            stage: "private-stage",
            http_status: 403,
          },
          lookup: {
            reason_code: "timeout",
            http_status: 999,
            issuance_certainty: "private-certainty",
          },
        },
      },
    } as unknown as ClientStatus;
    const displayed = JSON.stringify([
      paymentRecoveryDetails(status),
      paymentRecoveryFeedback(status),
    ]);
    expect(displayed).not.toMatch(/private-|__proto__|999|403/);
    expect(displayed).toContain("The provider request timed out.");
  });

  it("does not treat a not-sent diagnostic as settlement or a final charge", () => {
    const status = {
      ...pending,
      recovery: {
        outcome: "pending",
        reasonCode: "provider_key_absent",
        serverState: "ISSUANCE_UNKNOWN",
        sessionId: "id",
        recovery: {
          reason_code: "provider_key_absent",
          requires_operator_action: true,
          issuance: {
            stage: "dispatcher",
            reason_code: "claim_storage_unavailable",
            issuance_certainty: "not_sent",
          },
        },
      },
    } as ClientStatus;
    expect(paymentRecoveryFeedback(status).error).toBe(true);
    expect(paymentRecoveryDetails(status).join(" ")).toContain(
      "These diagnostics do not confirm settlement or the final charge.",
    );
    expect(paymentRecoveryDetails(status).join(" ")).toContain(
      "This does not confirm that no key was issued or that no charge occurred.",
    );
  });
});
