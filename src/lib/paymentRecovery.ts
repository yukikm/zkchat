import type { ClientStatus, RecoveryResult } from "@zkapi/solana-sdk";
import { reusableSession } from "./sdkStatus";

const recoveryReasons: Readonly<Record<string, string>> = {
  issuance_unknown: "The provider key issuance could not be confirmed.",
  provider_key_absent:
    "No provider key was found. This does not confirm that no key was issued or that no charge occurred.",
  provider_lookup_failed:
    "The provider key lookup failed. Whether a key exists is still unknown.",
  authorization_pending: "Authorization is still awaiting confirmation.",
  settlement_pending: "Settlement has not been confirmed.",
  gateway_delivery_pending: "The saved request still needs recovery.",
  control_unavailable: "The payment service could not be reached reliably.",
  control_request_rejected: "The payment service rejected the recovery check.",
  recovery_failed: "The saved payment could not be verified.",
};
const diagnosticReasons: Readonly<Record<string, string>> = {
  transport_error: "The provider connection failed.",
  timeout: "The provider request timed out.",
  http_rejected: "The provider rejected the request.",
  response_body_unavailable: "The provider response could not be read.",
  response_too_large: "The provider response exceeded the supported size.",
  response_invalid: "The provider response could not be validated.",
  recovery_ambiguous: "The provider lookup was ambiguous.",
  recovery_limit: "The provider lookup reached its limit.",
  dispatcher_unavailable: "The key issuance service was unavailable.",
  claim_storage_unavailable:
    "The key issuance service could not save its record.",
  internal_error: "The key issuance service encountered an internal error.",
};
function knownReason(code: string | null | undefined) {
  return code && Object.hasOwn(recoveryReasons, code)
    ? recoveryReasons[code]
    : undefined;
}
function httpStatusText(status: number | undefined) {
  return typeof status === "number" &&
    Number.isInteger(status) &&
    status >= 100 &&
    status <= 599
    ? `HTTP ${status}.`
    : undefined;
}
function operatorGuidance(result: RecoveryResult | undefined) {
  return result?.recovery?.requires_operator_action === true
    ? "The service operator needs to investigate this session. Keep this browser's saved deposit data."
    : undefined;
}

/** Only bounded SDK codes and validated HTTP numbers reach the UI. */
export function paymentRecoveryDetails(status: ClientStatus): string[] {
  // The SDK also projects an ordinary reusable lease as settlement_pending.
  // That is expected while chatting, not a recovery problem to display.
  if (reusableSession(status)) return [];
  const result = status.recovery;
  const recovery = result?.recovery ?? status.session?.recovery;
  const details: string[] = [];
  const serverState = result?.serverState ?? status.session?.serverState;
  if (serverState === "ISSUANCE_UNKNOWN")
    details.push(
      "Server state: ISSUANCE_UNKNOWN — provider key issuance is unconfirmed.",
    );
  if (result && ["completed", "pending", "failed"].includes(result.outcome))
    details.push(`Recovery: ${result.outcome}.`);
  const reason = knownReason(result?.reasonCode ?? recovery?.reason_code);
  if (reason) details.push(reason);
  const sessionReason = knownReason(recovery?.reason_code);
  if (sessionReason && sessionReason !== reason) details.push(sessionReason);
  const controlHttp = httpStatusText(result?.httpStatus);
  if (result?.outcome === "failed" && controlHttp)
    details.push(`Payment service: ${controlHttp}`);
  const operator =
    operatorGuidance(result) ??
    (recovery?.requires_operator_action === true
      ? "The service operator needs to investigate this session. Keep this browser's saved deposit data."
      : undefined);
  if (operator) details.push(operator);
  for (const [label, diagnostic] of [
    ["Original issuance", recovery?.issuance],
    ["Latest lookup", recovery?.lookup],
  ] as const) {
    if (
      !diagnostic ||
      !Object.hasOwn(diagnosticReasons, diagnostic.reason_code)
    )
      continue;
    const http = httpStatusText(diagnostic.http_status);
    details.push(
      `${label}: ${diagnosticReasons[diagnostic.reason_code]}${http ? ` ${http}` : ""}`,
    );
  }
  if (recovery || serverState === "ISSUANCE_UNKNOWN")
    details.push(
      "These diagnostics do not confirm settlement or the final charge.",
    );
  return details;
}

/** Older recovery runtimes return void; retain their local-status check. */
export function paymentRecoveryFeedback(
  status: ClientStatus,
  result?: RecoveryResult | void,
): { error: boolean; message: string } {
  const recovery =
    result ?? (reusableSession(status) ? undefined : status.recovery);
  if (
    recovery?.outcome === "failed" ||
    recovery?.outcome === "pending" ||
    (status.session && !reusableSession(status))
  ) {
    const summary =
      recovery?.outcome === "failed"
        ? "Payment check failed."
        : status.session?.phase === "closing" &&
            (!recovery?.reasonCode ||
              recovery.reasonCode === "settlement_pending")
          ? "Settlement is still pending."
          : "Payment is still unresolved.";
    return {
      error: true,
      message: [
        summary,
        knownReason(recovery?.reasonCode),
        operatorGuidance(recovery),
        "Sending remains paused. This check did not resend your message or start a withdrawal.",
      ]
        .filter(Boolean)
        .join(" "),
    };
  }
  return {
    error: false,
    message: status.session
      ? "Payment status checked. This session is still active."
      : "This payment is no longer pending. No message was resent.",
  };
}
