import type { ClientStatus } from "@zkapi/solana-sdk";

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
  return `${providerErrors[code]} Choose Review payment before sending again. No automatic retry.`;
}
