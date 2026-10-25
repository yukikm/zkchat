import { describe, expect, it } from "vitest";
import { withdrawalPresentation } from "../src/lib/withdrawalPresentation";

describe("withdrawal progress presentation", () => {
  const operation = {
    kind: "mutual_close",
    phase: "ready",
    progress: {
      stage: "uploading_proof",
      nextAction: "approve_transaction",
      proofUpload: { confirmedChunks: 2, totalChunks: 7 },
    },
  };
  it("shows confirmed proof parts without claiming funds have returned", () => {
    expect(withdrawalPresentation(operation)).toEqual({
      stageLabel: "Uploading your withdrawal proof",
      detail: "2 of 7 proof parts confirmed.",
      actionLabel: "Approve in wallet",
    });
  });
  it("prioritizes confirmation over another approval for a signed transaction", () => {
    expect(
      withdrawalPresentation({ ...operation, signature: "saved" }).actionLabel,
    ).toBe("Check confirmation");
  });
  it("does not invent progress for legacy operations or invalid counts", () => {
    expect(
      withdrawalPresentation({ kind: "mutual_close", phase: "proving" }),
    ).toEqual({
      stageLabel: "Withdrawal in progress",
      detail: null,
      actionLabel: "Prepare withdrawal proof",
    });
    expect(
      withdrawalPresentation({
        ...operation,
        progress: {
          ...operation.progress,
          proofUpload: { confirmedChunks: 10, totalChunks: 7 },
        },
      }).detail,
    ).toBeNull();
  });
});
