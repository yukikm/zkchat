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
    "No provider endpoint currently satisfies the required zero data retention policy.",
  model_endpoint_unavailable: "The selected model has no available endpoint.",
  provider_access_denied: "The provider denied access to this model.",
  provider_budget_unavailable:
    "The provider budget is unavailable. Adding a deposit will not resolve this provider error.",
  provider_rate_limited: "The provider is rate limiting requests.",
  provider_unavailable: "The provider is temporarily unavailable.",
  provider_request_rejected: "The provider rejected this request.",
};

/** Display only known SDK codes; never echo provider messages, headers or bodies. */
export function providerResponseError(response?: Response): string | undefined {
  if (!response || response.ok) return undefined;
  const code = response.headers.get("X-Zkapi-Error-Code") ?? "";
  if (!Object.hasOwn(providerErrors, code)) return undefined;
  return `${providerErrors[code]} Check settlement before a deliberate new request. No automatic retry or privacy-policy change was made.`;
}
