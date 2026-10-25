import { describe, expect, it } from "vitest";
import type { ClientStatus } from "@zkapi/solana-sdk";
import { expiryNotice } from "@zkapi/solana-sdk/control";
import { expiryNotice as previousExpiryNotice } from "@zkapi/solana-sdk-previous/control";
import { expiryNotice as legacyExpiryNotice } from "@zkapi/solana-sdk-legacy/control";
import { depositExpiryNotice, depositTerms } from "../src/lib/depositExpiry";

type ExpiryStatus = Pick<ClientStatus, "wallet" | "expiry">;
const deadline = 1_792_886_400n;
const active: ExpiryStatus = {
  wallet: "active",
  expiry: expiryNotice(deadline, deadline - 90_000n),
};
const tokyo = { locale: "en-US", timeZone: "Asia/Tokyo" };

describe("deposit expiry presentation", () => {
  it("shows no deadline or forfeiture warning for authenticated non-expiring deposits", () => {
    const status = {
      wallet: "active" as const,
      depositExpiryPolicy: "none" as const,
      expiry: null,
    };
    expect(depositExpiryNotice(status, tokyo)).toBeNull();
    expect(depositTerms(status).title).toBe("No deposit expiry");
    expect(depositTerms(status).body).toContain("Unused funds do not expire");
    expect(depositTerms(status).body).toContain("waiting period");
  });

  it("discloses forfeiture before funding legacy and finite-expiry deployments", () => {
    for (const status of [
      null,
      active,
      { ...active, depositExpiryPolicy: "fixed" as const },
    ]) {
      expect(depositTerms(status).title).toBe("This deposit has an expiry");
      expect(depositTerms(status).body).toContain("including unused funds");
    }
  });

  it("does not hide a retained expiry when policy and expiry data conflict", () => {
    const status = { ...active, depositExpiryPolicy: "none" as const };
    expect(depositExpiryNotice(status, tokyo)?.isoDate).toBeDefined();
    expect(depositTerms(status).title).toBe("This deposit has an expiry");
  });

  it.each([
    ["current", expiryNotice],
    ["previous", previousExpiryNotice],
    ["legacy", legacyExpiryNotice],
  ] as const)(
    "formats the exact %s SDK deadline with a local time zone",
    (_, notice) => {
      const display = depositExpiryNotice(
        { ...active, expiry: notice(deadline, deadline - 90_000n) },
        tokyo,
      );
      expect(display?.title).toBe("Withdraw by Oct 25, 2026, 9:00 AM GMT+9");
      expect(display?.isoDate).toBe("2026-10-25T00:00:00.000Z");
      expect(display?.body).toContain("entire deposit, including unused funds");
      expect(JSON.stringify(display)).not.toContain("Unix");
    },
  );

  it("uses the selected time zone instead of assuming the UTC calendar date", () => {
    const display = depositExpiryNotice(active, {
      locale: "en-US",
      timeZone: "America/Los_Angeles",
    });
    expect(display?.title).toBe("Withdraw by Oct 24, 2026, 5:00 PM PDT");
  });

  it.each(["empty", "unfunded", "closed"] as const)(
    "does not warn about forfeiture for a %s deposit with retained expiry data",
    (wallet) => {
      expect(depositExpiryNotice({ ...active, wallet }, tokyo)).toBeNull();
    },
  );

  it("has no expiry notice when no deposit expiry is available", () => {
    expect(depositExpiryNotice(null)).toBeNull();
    expect(depositExpiryNotice({ ...active, expiry: null })).toBeNull();
  });

  it("distinguishes a pending withdrawal from an Active-note expiry claim", () => {
    const display = depositExpiryNotice(
      {
        wallet: "pending_escape",
        expiry: expiryNotice(deadline, deadline),
      },
      tokyo,
    );
    expect(display?.title).toBe("Withdrawal in progress");
    expect(display?.body).toContain(
      "not the deadline for this pending withdrawal",
    );
    expect(display?.body).not.toMatch(/treasury|claim|expired/);
    expect(display?.isoDate).toBeUndefined();
  });

  it("explains expiry risk without asserting that funds already moved", () => {
    const display = depositExpiryNotice(
      {
        ...active,
        expiry: expiryNotice(deadline, deadline),
      },
      tokyo,
    );
    expect(display?.title).toBe(
      "Deposit expired on Oct 25, 2026, 9:00 AM GMT+9",
    );
    expect(display?.body).toContain("may lose the entire deposit");
    expect(display?.body).toContain(
      "Withdrawal may still be possible if it has not been claimed",
    );
    expect(display?.body).not.toMatch(/automatically|has been|already/);
  });

  it.each([
    ["normal", "Withdraw before this deposit expires"],
    ["seven_days", "This deposit expires within 7 days"],
    ["one_day", "This deposit expires within 24 hours"],
    ["expired", "This deposit has expired"],
  ] as const)(
    "uses safe %s guidance for an unrecognized SDK message",
    (severity, title) => {
      const display = depositExpiryNotice(
        {
          ...active,
          expiry: {
            severity,
            message: "Unrecognized internal message 1792886400",
          },
        },
        tokyo,
      );
      expect(display?.title).toBe(title);
      expect(display?.isoDate).toBeUndefined();
      expect(JSON.stringify(display)).not.toMatch(/1792886400|Unrecognized/);
    },
  );

  it.each([
    (message: string) => `Prefix ${message}`,
    (message: string) => `${message} suffix`,
    (message: string) => `${message}\n`,
    (message: string) => message.replace("1792886400", "8640000000001"),
    (message: string) => message.replace("1792886400", "18446744073709551615"),
    (message: string) => message.replace("1792886400", "1792886400.5"),
    (message: string) => message.replace("1792886400", "-1"),
  ])(
    "rejects malformed or out-of-range timestamps without leaking raw text",
    (change) => {
      const display = depositExpiryNotice(
        {
          ...active,
          expiry: {
            ...active.expiry!,
            message: change(active.expiry!.message),
          },
        },
        tokyo,
      );
      expect(display?.title).toBe("This deposit expires within 7 days");
      expect(display?.isoDate).toBeUndefined();
      expect(JSON.stringify(display)).not.toMatch(
        /Unix|Prefix|suffix|18446744073709551615/,
      );
    },
  );

  it("keeps expiry guidance if date formatting is unavailable", () => {
    const display = depositExpiryNotice(active, {
      timeZone: "Invalid/Timezone",
    });
    expect(display?.title).toBe("This deposit expires within 7 days");
    expect(display?.body).toContain("entire deposit");
    expect(display?.isoDate).toBeUndefined();
  });
});
