interface WithdrawalOperation {
  kind: string;
  phase: string;
  signature?: string | null;
  progress?: {
    stage: string;
    nextAction: string;
    proofUpload: { confirmedChunks: number; totalChunks: number } | null;
  };
}

/** SDK-owned progress, presented without estimating a transaction count. */
export function withdrawalPresentation(operation: WithdrawalOperation) {
  const progress = operation.progress;
  const stages: Record<string, string> = {
    preparing_proof: "Preparing your withdrawal proof",
    creating_proof_account: "Preparing the proof upload",
    uploading_proof: "Uploading your withdrawal proof",
    sealing_proof: "Completing the proof upload",
    submitting_withdrawal: "Returning your USDC",
    starting_waiting_period: "Starting the withdrawal waiting period",
    finalizing_withdrawal: "Returning your USDC",
    cleaning_up_proof: "Closing the temporary proof account",
  };
  const stageLabel = stages[progress?.stage ?? ""] ?? "Withdrawal in progress";
  const upload = progress?.proofUpload;
  const detail =
    progress?.stage === "uploading_proof" &&
    upload &&
    Number.isSafeInteger(upload.confirmedChunks) &&
    Number.isSafeInteger(upload.totalChunks) &&
    upload.totalChunks > 0 &&
    upload.confirmedChunks >= 0 &&
    upload.confirmedChunks <= upload.totalChunks
      ? `${upload.confirmedChunks} of ${upload.totalChunks} proof parts confirmed.`
      : null;
  const actionLabel = operation.signature
    ? "Check confirmation"
    : progress?.nextAction === "prepare_proof" || operation.phase === "proving"
      ? "Prepare withdrawal proof"
      : progress?.nextAction === "review_failure" ||
          operation.phase === "rejected"
        ? "Retry this withdrawal step"
        : progress?.nextAction === "refresh_proof"
          ? "Refresh withdrawal proof"
          : "Approve in wallet";
  return { stageLabel, detail, actionLabel };
}
