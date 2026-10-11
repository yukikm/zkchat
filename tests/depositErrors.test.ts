import { describe, expect, it } from "vitest";
import { PublicProfileError } from "@zkapi/solana-sdk/public-profile";
import { AmountInputError } from "../src/lib/chat";
import { DepositError } from "../src/lib/deposits";
import {
  depositPreparationError,
  walletStepError,
} from "../src/lib/depositErrors";
import { PublicOnboardingError } from "../src/lib/publicDeployment";
import { WalletConnectionError } from "../src/lib/walletErrors";

describe("deposit preparation failures", () => {
  it("explains an unavailable indexer before wallet approval", () => {
    const error = depositPreparationError(
      new Error("finalized indexer unavailable"),
    );
    expect(error).toBeInstanceOf(DepositError);
    expect(error.message).toContain("chain indexer is unavailable");
    expect(error.message).toContain("No wallet signature was requested");
    expect(error.message).toContain("Try Review deposit again later");
  });

  it.each([
    "RPC/indexer finalized cut changed; retry snapshot",
    "RPC finalized account cut block missing or invalid",
    "untrusted indexer root",
  ])("explains an unverifiable chain snapshot: %s", (message) => {
    expect(depositPreparationError(new Error(message)).message).toContain(
      "Could not verify current chain data for the deposit",
    );
  });

  it("uses allowlisted preflight components without exposing SDK details", () => {
    const error = new PublicProfileError("snapshot");
    error.message = "private response https://private.invalid/?key=secret";
    const normalized = depositPreparationError(error);
    expect(normalized).toBeInstanceOf(PublicOnboardingError);
    expect(normalized.message).toContain("finalized chain snapshot");
    expect(normalized.message).not.toMatch(/private|secret|https:/);
  });

  it.each([
    new Error("private provider response"),
    new Error("finalized indexer unavailable: secret response"),
    { message: "finalized indexer unavailable", component: "snapshot" },
    "private response",
    null,
  ])(
    "keeps unknown failures private and limits guidance to preparation",
    (error) => {
      expect(depositPreparationError(error).message).toBe(
        "Could not prepare the deposit. No wallet signature was requested. Refresh status, then follow the next step.",
      );
    },
  );

  it.each([
    new AmountInputError("Deposit at least 1.00 USDC."),
    new DepositError("Reconnect to load your saved deposits."),
    new PublicOnboardingError("New work is unavailable."),
    new WalletConnectionError("Reconnect the selected wallet first."),
  ])("preserves existing app guidance", (error) => {
    expect(depositPreparationError(error)).toBe(error);
  });
});

describe("wallet signature and confirmation failures", () => {
  it.each([
    "finalized indexer unavailable",
    "RPC/indexer finalized cut changed; retry snapshot",
    "RPC finalized account cut block missing or invalid",
    "untrusted indexer root",
  ])(
    "retains recovery guidance without asserting whether funds moved: %s",
    (message) => {
      const error = walletStepError(new Error(message));
      expect(error).toBeInstanceOf(DepositError);
      expect(error.message).toContain("transaction on Solana");
      expect(error.message).toContain("Keep this browser’s data");
      expect(error.message).toContain("saved next step");
      expect(error.message).not.toMatch(
        /No wallet|No transaction|not sent|Review deposit/,
      );
    },
  );

  it("never reuses no-send preflight wording after a wallet step", () => {
    const error = new PublicProfileError("snapshot");
    error.message = "private response";
    expect(walletStepError(error).message).toBe(
      "Could not complete this step. Refresh status, then follow the next action below.",
    );
  });

  it("does not expose arbitrary wallet or RPC failures", () => {
    expect(walletStepError(new Error("private wallet payload")).message).toBe(
      "Could not complete this step. Refresh status, then follow the next action below.",
    );
  });

  it("preserves a selected-deposit guard failure", () => {
    const error = new DepositError("Reconnect to load your saved deposits.");
    expect(walletStepError(error)).toBe(error);
  });
});
