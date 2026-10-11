import { ClientActionError, type ClientStatus } from "@zkapi/solana-sdk";
import { ControlHttpError } from "@zkapi/solana-sdk/control";

export function reusableSession(status: ClientStatus | null): boolean {
  return (
    !!status?.session &&
    status.mode !== "proxy" &&
    status.canRequest &&
    !status.busy
  );
}

const providerErrors: Readonly<Record<string, string>> = {
  zdr_endpoint_unavailable:
    "This model has no provider with the required zero data retention policy.",
  model_endpoint_unavailable: "This model is currently unavailable.",
  provider_access_denied: "The provider denied access to this model.",
  provider_budget_unavailable:
    "The provider has no available credit. Adding a deposit will not resolve this.",
  provider_rate_limited: "The provider is busy. Wait before trying again.",
  provider_unavailable: "The provider is temporarily unavailable.",
  provider_request_rejected: "The provider rejected this request.",
};

/** Display only known SDK codes; never echo provider messages, headers or bodies. */
export function providerResponseError(response?: Response): string | undefined {
  if (!response || response.ok) return undefined;
  const code = response.headers.get("X-Zkapi-Error-Code") ?? "";
  if (!Object.hasOwn(providerErrors, code)) return undefined;
  return `${providerErrors[code]} Choose Check status before sending again. No automatic retry.`;
}

const chatFailures: Readonly<Record<string, string>> = {
  "finalized indexer unavailable":
    "Could not verify chain data because the indexer is unavailable.",
  "RPC/indexer finalized cut changed; retry snapshot":
    "Could not verify current chain data for this deposit.",
  "RPC finalized account cut block missing or invalid":
    "Could not verify current chain data for this deposit.",
  "untrusted indexer root":
    "Could not verify current chain data for this deposit.",
  "active snapshot membership":
    "The verified chain snapshot does not include this deposit.",
  "local snapshot path identity":
    "Could not verify the local proof path for this deposit.",
};

/** Keep diagnostics useful without exposing provider bodies or custody data.
 * A missing response/session does not prove that no request or charge occurred. */
export function chatFailureMessage(
  error: unknown,
  response?: Response,
  directOpenRouter = false,
): string {
  const provider = directOpenRouter
    ? providerResponseError(response)
    : undefined;
  if (provider) return provider;
  let reason = "Reply interrupted.";
  if (error instanceof Error && Object.hasOwn(chatFailures, error.message)) {
    reason = chatFailures[error.message];
  } else if (
    error instanceof ControlHttpError &&
    Number.isInteger(error.status) &&
    error.status >= 400 &&
    error.status <= 599
  ) {
    reason = `The payment service returned HTTP ${error.status}.`;
  } else if (error instanceof ClientActionError) {
    switch (error.code) {
      case "busy":
        reason = "Another operation is still in progress.";
        break;
      case "not_ready":
        reason = "The deposit or session is not ready to send.";
        break;
      case "invalid_request":
        reason = "The selected model or message settings could not be used.";
        break;
      case "closed":
        reason = "The wallet connection needs to be reopened.";
        break;
    }
  }
  return `${reason} Choose Check status before sending again. Nothing is resent automatically.`;
}
