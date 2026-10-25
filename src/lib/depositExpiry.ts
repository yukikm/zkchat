import type { ClientStatus } from "@zkapi/solana-sdk";

export interface DepositExpiryDisplay {
  title: string;
  body: string;
  isoDate?: string;
}

interface ExpiryDisplayOptions {
  locale?: string | string[];
  timeZone?: string;
}

// Older recovery SDKs do not expose a policy. Only the current SDK may report
// `none`, after authenticating both the manifest and the finalized Pool timing.
type ExpiryStatus = Pick<ClientStatus, "wallet" | "expiry"> & {
  depositExpiryPolicy?: "none" | "fixed";
};

export function depositTerms(
  status: ExpiryStatus | null,
): DepositExpiryDisplay | null {
  if (status?.depositExpiryPolicy === "none" && status.expiry === null) {
    return null;
  }
  return {
    title: "This deposit has an expiry",
    body: "This service still uses expiring deposits. After the deadline, the entire deposit, including unused funds, can be claimed. Check the deadline and withdraw before it expires.",
  };
}

// SDK .3, .12, .16 and .17 expose the timestamp only in this exact message.
// Unknown formats must never become a guessed deadline or raw SDK copy.
const expiryMessage =
  /^Note expiry: (0|[1-9]\d{0,19}) \(Unix seconds\)\. After expiry, the entire principal of an Active note can be transferred to the treasury\.$/;
const latestDateSeconds = 8_640_000_000_000n;

function expiryDate(message: string): Date | null {
  const match = expiryMessage.exec(message);
  if (!match || match[0] !== message) return null;
  const seconds = BigInt(match[1]);
  if (seconds > latestDateSeconds) return null;
  const date = new Date(Number(seconds) * 1000);
  return Number.isFinite(date.getTime()) ? date : null;
}

/** Presentation only: the SDK remains authoritative for admission and recovery. */
export function depositExpiryNotice(
  status: ExpiryStatus | null,
  options: ExpiryDisplayOptions = {},
): DepositExpiryDisplay | null {
  if (!status?.expiry || !["active", "pending_escape"].includes(status.wallet))
    return null;

  // A Pending note is excluded from the Active-note expiry claim. Its withdrawal
  // has a separate challenge deadline, which cannot be inferred from note expiry.
  if (status.wallet === "pending_escape") {
    return {
      title: "Withdrawal in progress",
      body: "Follow the withdrawal status below to finish. The deposit expiry is not the deadline for this pending withdrawal.",
    };
  }

  const date = expiryDate(status.expiry.message);
  let formattedDate: string | undefined;
  if (date) {
    try {
      formattedDate = new Intl.DateTimeFormat(options.locale, {
        year: "numeric",
        month: "short",
        day: "numeric",
        hour: "numeric",
        minute: "2-digit",
        timeZoneName: "short",
        ...(options.timeZone ? { timeZone: options.timeZone } : {}),
      }).format(date);
    } catch {
      // Invalid locale or unavailable time-zone data must not hide the risk.
    }
  }

  const expired = status.expiry.severity === "expired";
  const fallbackTitles: Record<
    NonNullable<ClientStatus["expiry"]>["severity"],
    string
  > = {
    normal: "Withdraw before this deposit expires",
    seven_days: "This deposit expires within 7 days",
    one_day: "This deposit expires within 24 hours",
    expired: "This deposit has expired",
  };
  return {
    title: formattedDate
      ? `${expired ? "Deposit expired on" : "Withdraw by"} ${formattedDate}`
      : fallbackTitles[status.expiry.severity],
    body: expired
      ? "You may lose the entire deposit, including unused funds. Withdrawal may still be possible if it has not been claimed."
      : "Withdraw before this deadline or you may lose the entire deposit, including unused funds.",
    ...(formattedDate && date ? { isoDate: date.toISOString() } : {}),
  };
}
