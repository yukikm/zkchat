import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Unplug,
} from "lucide-react";
import type { ClientStatus } from "@zkapi/solana-sdk";
import {
  SDK_VERSION,
  RETIRED_RUNTIME,
  LOCAL_RECOVERY_PREVIEW,
} from "../lib/sdkVersion";
import { reusableSession } from "../lib/sdkStatus";
import {
  paymentRecoveryDetails,
  paymentRecoveryFeedback,
} from "../lib/paymentRecovery";
import {
  BrowserStorageMissing,
  RecoveryError,
  RecoverySetupIncomplete,
  restoreZkchatDeposits,
  finishZkchatRecoverySetup,
  connectWalletAccount,
  connectZkapi,
  configuredMode,
  configuredModels,
  listWallets,
  watchWallets,
  type AppConfig,
  type AppWallet,
  type BrowserClientHandle,
  type StandardAccount,
} from "../lib/zkapi";
import {
  inspectPublicDeployment,
  PublicOnboardingError,
  servicePauseReason,
} from "../lib/publicDeployment";
import {
  AmountInputError,
  formatUsdc,
  fundedNoteBalance,
  microUsdc,
} from "../lib/chat";
import { WalletConnectionError } from "../lib/walletErrors";
import { depositPreparationError, walletStepError } from "../lib/depositErrors";
import {
  canAddDeposit,
  canChangeDeposit,
  DepositError,
  hasLowBalance,
} from "../lib/deposits";
import { WalletIcon, WalletPicker } from "./WalletPicker";
import { Modal } from "./Modal";
import { RecoveryPanel } from "./RecoveryPanel";
import { depositExpiryNotice } from "../lib/depositExpiry";
import type { useWalletObservation } from "../lib/walletObservation";

export interface WalletConnection {
  wallet: AppWallet;
  account: StandardAccount;
  needsSetup?: boolean;
}
export interface ConnectionRequest {
  id: number;
  intent: "manage" | "add" | "payment";
}

export function ConnectionPanel({
  config,
  configError,
  configLoading,
  onRetryConfig,
  handle,
  status,
  onConnect,
  walletConnection,
  onWalletConnect,
  onDisconnect,
  refresh,
  locked,
  onBusy,
  presentation = "dialog",
  onClose = () => {},
  onContinueChat = () => {},
  onTryDemo,
  chatReady = false,
  needsConversationSettlement = false,
  request,
  walletObservation,
}: {
  config: AppConfig | null;
  configError: string;
  configLoading: boolean;
  onRetryConfig: () => void;
  handle: BrowserClientHandle | null;
  status: ClientStatus | null;
  onConnect: (handle: BrowserClientHandle, address: string) => void;
  walletConnection: WalletConnection | null;
  onWalletConnect: (connection: WalletConnection) => void;
  onDisconnect: () => void;
  refresh: () => Promise<void>;
  locked: boolean;
  onBusy: (busy: boolean) => void;
  presentation?: "inline" | "dialog" | "hidden";
  onClose?: () => void;
  onContinueChat?: () => void;
  onTryDemo?: () => void;
  chatReady?: boolean;
  needsConversationSettlement?: boolean;
  request?: ConnectionRequest;
  walletObservation: ReturnType<typeof useWalletObservation>;
}) {
  const [wallets, setWallets] = useState<AppWallet[]>(listWallets);
  const [selectedWallet, setSelectedWallet] = useState<AppWallet | null>(null);
  const wallet =
    selectedWallet && wallets.includes(selectedWallet)
      ? selectedWallet
      : wallets[0];
  const connection = walletConnection;
  const storageMissing = connection?.needsSetup ?? false;
  const [busy, setBusy] = useState(false);
  const actionBusy = useRef(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [amount, setAmount] = useState("2");
  const [recoveryView, setRecoveryView] = useState<"setup" | "restore" | null>(
    null,
  );
  const [recoveryIncomplete, setRecoveryIncomplete] = useState(false);
  const custodyKey = handle
    ? JSON.stringify([
        handle.deployment.id,
        handle.deployment.pool,
        handle.account.address,
      ])
    : "";
  const [withdraw, setWithdraw] = useState(false);
  const [progressState, setProgressState] = useState("");
  const [intent, setIntent] = useState<ConnectionRequest["intent"]>("manage");
  const [depositCompleted, setDepositCompleted] = useState(false);
  const pendingDeposit = useRef<string | null>(null);
  const amountInput = useRef<HTMLInputElement>(null);
  const [publicCheck, setPublicCheck] = useState<Awaited<
    ReturnType<typeof inspectPublicDeployment>
  > | null>(null);
  useEffect(() => watchWallets(() => setWallets(listWallets())), []);
  useEffect(() => {
    if (request) {
      setIntent(request.intent);
      setWithdraw(false);
      setInfo("");
    }
  }, [request?.id]);
  useEffect(() => {
    setError("");
    setInfo("");
    setWithdraw(false);
    setProgressState("");
    setDepositCompleted(false);
    setRecoveryView(null);
    setRecoveryIncomplete(false);
    pendingDeposit.current = null;
  }, [connection?.wallet, connection?.account.address]);
  useEffect(() => {
    setWithdraw(false);
    setProgressState("");
  }, [status?.noteId]);
  useEffect(() => {
    if (status?.walletOperation?.kind === "deposit") {
      pendingDeposit.current = status.noteId;
      setDepositCompleted(false);
    } else if (
      pendingDeposit.current === status?.noteId &&
      status?.wallet === "active" &&
      !status.walletOperation
    ) {
      pendingDeposit.current = null;
      setDepositCompleted(true);
      setIntent("manage");
    }
  }, [status?.noteId, status?.wallet, status?.walletOperation]);

  async function action(
    fn: () => Promise<void>,
    fallback = "Could not complete this operation. Your saved progress is kept. Try again.",
    progress = "Checking your saved progress…",
    refreshAfter = true,
  ) {
    if (actionBusy.current || locked || status?.busy) return;
    actionBusy.current = true;
    setBusy(true);
    setProgressMessage(progress);
    onBusy(true);
    setError("");
    setInfo("");
    try {
      await fn();
    } catch (e) {
      if (e instanceof RecoverySetupIncomplete) {
        setRecoveryIncomplete(true);
        setRecoveryView((current) => current ?? "restore");
      }
      setError(
        e instanceof PublicOnboardingError ||
          e instanceof DepositError ||
          e instanceof WalletConnectionError ||
          e instanceof AmountInputError ||
          e instanceof RecoveryError
          ? e.message
          : fallback,
      );
    } finally {
      if (refreshAfter)
        await refresh().catch(() =>
          setError(
            "Could not check saved progress. Reconnect with the same wallet.",
          ),
        );
      actionBusy.current = false;
      setBusy(false);
      onBusy(false);
    }
  }
  async function openChat(
    connectedWallet: WalletConnection,
    initialize = false,
  ) {
    if (!config) return;
    try {
      setProgressMessage("Opening your saved deposits…");
      const connected = await connectZkapi(
        config,
        connectedWallet.wallet,
        connectedWallet.account,
        initialize,
      );
      onWalletConnect({
        wallet: connectedWallet.wallet,
        account: connectedWallet.account,
      });
      onConnect(connected, connectedWallet.account.address);
    } catch (e) {
      if (e instanceof BrowserStorageMissing)
        onWalletConnect({ ...connectedWallet, needsSetup: true });
      else throw e;
    }
  }
  async function connect(initialize = false) {
    if (!config || (!connection && !wallet)) return;
    await action(
      async () => {
        let connectedWallet = connection;
        if (!connectedWallet && wallet) {
          const account = await connectWalletAccount(wallet);
          connectedWallet = { wallet, account };
          onWalletConnect(connectedWallet);
        }
        if (connectedWallet) await openChat(connectedWallet, initialize);
      },
      "Could not open your saved deposits. Try again with the same wallet.",
      connection
        ? "Opening your saved deposits…"
        : `Approve the connection in ${wallet?.name}.`,
    );
  }
  async function copyAddress() {
    if (!connection) return;
    try {
      await navigator.clipboard.writeText(connection.account.address);
      setInfo("Address copied.");
    } catch {
      setError(
        "Could not copy the address. Select it in Wallet & balance and copy it manually.",
      );
    }
  }
  async function enableRecovery(fileText: string) {
    if (!handle || !connection) return;
    // Keep the mounted download form (and its file) if setup is interrupted.
    setRecoveryView("setup");
    await action(
      async () => {
        let connected;
        try {
          connected = await handle.enableRecovery(fileText);
        } catch (error) {
          // A failed transfer may already have stopped the local client. Retry
          // enrollment using the saved file, never that disposed client.
          if (handle.invalidated) setRecoveryIncomplete(true);
          throw error;
        }
        onConnect(connected, connected.account.address);
        setRecoveryView(null);
        setRecoveryIncomplete(false);
        setInfo("Recovery is set up. Keep your recovery file safe.");
      },
      "Could not finish recovery setup. Keep your file and try again.",
      "Saving your encrypted deposit backup…",
      false,
    );
  }
  async function restoreRecovery(fileText: string, finishSetup: boolean) {
    if (!config || !connection) return;
    await action(
      async () => {
        handle?.dispose();
        const connected = await (
          finishSetup ? finishZkchatRecoverySetup : restoreZkchatDeposits
        )(config, connection.wallet, connection.account, fileText);
        onWalletConnect({
          wallet: connection.wallet,
          account: connection.account,
        });
        onConnect(connected, connected.account.address);
        setRecoveryView(null);
        setRecoveryIncomplete(false);
        setIntent("manage");
        setInfo("Your deposits are restored in this browser.");
      },
      "Could not restore deposits. Check your file and connected wallet, then try again.",
      finishSetup
        ? "Finishing your saved recovery setup…"
        : "Restoring your saved deposits…",
      false,
    );
  }
  const disabled = busy || locked || configLoading || !!status?.busy;
  const operation = status?.walletOperation;
  const expiryNotice = depositExpiryNotice(status);
  const retiredDeposit = RETIRED_RUNTIME && operation?.kind === "deposit";
  const retiredUnsignedDeposit = retiredDeposit && !operation?.signature;
  const servicePaused =
    config?.schema === 2 && !!handle && !handle.publicAdmissionReady;
  const withdrawalInProgress =
    !!operation &&
    ["mutual_close", "initiate_escape", "finalize_escape"].includes(
      operation.kind,
    );
  const automaticConfirmation =
    !!operation?.signature && walletObservation.supported && !RETIRED_RUNTIME;
  const withdrawalPending =
    withdrawalInProgress || status?.wallet === "pending_escape";
  const wantsAdd = intent === "add";
  const managing = presentation === "dialog" && intent === "manage";
  const initialDeposit =
    status?.wallet === "empty" || status?.wallet === "unfunded";
  const showFunding =
    !RETIRED_RUNTIME &&
    !!handle &&
    !!status &&
    !operation &&
    !status.session &&
    (initialDeposit || (wantsAdd && canAddDeposit(status))) &&
    !servicePaused &&
    !handle.invalidated;
  const additionalFunding =
    (wantsAdd && !initialDeposit) || (handle?.deposits?.length ?? 0) > 1;
  const needsBackup = showFunding && !handle?.recoveryEnabled;
  const recoveryMode = recoveryView ?? (needsBackup ? "setup" : null);
  const externallyBusy = !busy && (locked || !!status?.busy);
  const showPayment =
    !externallyBusy &&
    !!status?.session &&
    (RETIRED_RUNTIME ||
      !reusableSession(status) ||
      wantsAdd ||
      intent === "payment" ||
      needsConversationSettlement);
  const showBalance =
    !!handle && !!status && !initialDeposit && (managing || RETIRED_RUNTIME);
  const proofRequired =
    !!operation &&
    (operation.phase === "proving" || progressState === "proof_required");
  const rejected =
    !!operation &&
    (["failed", "stale"].includes(operation.phase) ||
      progressState === "rejected");
  let amountError = "";
  try {
    const value = microUsdc(amount);
    if (status && BigInt(value) < BigInt(status.authorizationCapMicroUsdc))
      amountError = `Deposit at least ${formatUsdc(status.authorizationCapMicroUsdc)} USDC.`;
  } catch (e) {
    amountError =
      e instanceof AmountInputError ? e.message : "Enter a valid USDC amount.";
  }
  const retryServiceCheck = () =>
    action(
      async () => {
        if (!handle) return;
        await handle.refreshPreflight();
        if (config?.schema === 2 && !handle.publicAdmissionReady)
          setError(
            "The service is still unavailable. Your deposits are kept. Try again later.",
          );
      },
      "Could not check the service. Try again later.",
      "Checking the service connection…",
    );
  function startAdding() {
    setIntent("add");
    setDepositCompleted(false);
    setWithdraw(false);
    setInfo("");
    setError("");
  }
  async function reviewDeposit() {
    if (!handle || !handle.recoveryEnabled || amountError) return;
    await action(
      async () => {
        const value = microUsdc(amount);
        let latest = await handle.client.status();
        if (BigInt(value) < BigInt(latest.authorizationCapMicroUsdc))
          throw new AmountInputError(
            `Deposit at least ${formatUsdc(latest.authorizationCapMicroUsdc)} USDC.`,
          );
        if (latest.wallet === "active" || latest.wallet === "closed") {
          if (!wantsAdd || !canAddDeposit(latest))
            throw new DepositError(
              "Finish the saved payment or withdrawal before adding funds.",
            );
          await handle.addDeposit();
          latest = await handle.client.status();
        }
        if (
          !canChangeDeposit(latest) ||
          !["empty", "unfunded"].includes(latest.wallet)
        )
          throw new DepositError(
            "Continue the saved deposit below. No new deposit was created.",
          );
        await handle.client.prepareDeposit(value).catch((e) => {
          throw depositPreparationError(e);
        });
        setProgressState("");
        setDepositCompleted(false);
      },
      "Could not prepare this deposit. Your amount and saved progress are kept.",
      "Preparing your deposit…",
    );
  }
  async function settlePayment() {
    if (!handle) return;
    await action(
      async () => {
        await handle.client.settle();
        const latest = await handle.client.status();
        if (latest.session)
          setInfo(
            "Payment is still being confirmed. Your deposit and draft are kept.",
          );
        else {
          if (!wantsAdd) setIntent("manage");
          setInfo(
            wantsAdd
              ? "Payment settled. You can now add funds."
              : "Payment settled.",
          );
        }
      },
      "Could not finish payment. Continue the saved payment below.",
      "Finishing payment…",
    );
  }
  async function resolvePayment() {
    if (!handle) return;
    await action(
      async () => {
        const result = await handle.client.recover();
        const latest = await handle.client.status();
        const feedback = paymentRecoveryFeedback(latest, result);
        if (feedback.error) setError(feedback.message);
        else setInfo(feedback.message);
        if (!latest.session && !wantsAdd) setIntent("manage");
      },
      "Payment is still unresolved. Your saved payment is kept.",
      "Resolving your saved payment…",
    );
  }
  useEffect(() => {
    if (showFunding && !needsBackup && presentation !== "hidden") {
      amountInput.current?.focus({ preventScroll: true });
    }
  }, [showFunding, needsBackup, presentation, request?.id, custodyKey]);
  const title = recoveryIncomplete
    ? "Finish recovery setup"
    : recoveryMode === "restore"
      ? "Restore deposits"
      : recoveryMode === "setup"
        ? "Back up your deposits"
        : !config
          ? configLoading
            ? "Loading service…"
            : "Service unavailable"
          : !handle
            ? storageMissing
              ? "Set up this browser"
              : RETIRED_RUNTIME
                ? "Open saved deposits"
                : "Start chatting"
            : handle.invalidated
              ? "Reconnect your wallet"
              : !status
                ? "Opening your deposits…"
                : operation
                  ? withdrawalInProgress
                    ? "Withdrawal in progress"
                    : retiredUnsignedDeposit
                      ? "Saved deposit"
                      : proofRequired
                        ? "Resume deposit preparation"
                        : rejected
                          ? "Deposit needs attention"
                          : operation.signature
                            ? automaticConfirmation
                              ? "Confirming your deposit"
                              : "Confirm your deposit"
                            : "Review your deposit"
                  : status.wallet === "pending_escape"
                    ? "Withdrawal waiting period"
                    : showPayment
                      ? wantsAdd && reusableSession(status)
                        ? "Finish payment before adding funds"
                        : reusableSession(status)
                          ? needsConversationSettlement
                            ? "Finish payment for your previous chat"
                            : "Review payment"
                          : "Payment needs attention"
                      : servicePaused
                        ? "Chat temporarily unavailable"
                        : showFunding
                          ? initialDeposit &&
                            (handle.deposits?.length ?? 1) <= 1
                            ? "Add funds to chat"
                            : "Add funds"
                          : wantsAdd && disabled
                            ? "Your chat is in progress"
                            : withdraw
                              ? "Review withdrawal"
                              : chatReady && !RETIRED_RUNTIME
                                ? "Ready to chat"
                                : status.wallet === "closed"
                                  ? "Withdrawal complete"
                                  : hasLowBalance(status)
                                    ? "Add funds to continue"
                                    : RETIRED_RUNTIME
                                      ? "Saved deposits"
                                      : "Your deposit";

  if (presentation === "hidden") return <div hidden />;

  const Heading = presentation === "inline" ? "h1" : "h3";
  const PaymentContainer = operation ? "details" : "div";
  const privacyNote = (
    <div className="privacy-note">
      <ShieldCheck size={17} />
      <p>
        Your messages are sent to the AI provider.
        {config && configuredMode(config) === "proxy"
          ? " The proxy operator can also read them."
          : ""}
      </p>
    </div>
  );
  const content = (
    <div
      className="connection-panel connection-flow"
      aria-busy={busy || configLoading}
    >
      <div className="connection-facts">
        <span>
          <span className="status-dot" />
          Solana Devnet
        </span>
        <span>Test tokens only</span>
      </div>
      <div className="connection-step-heading">
        <Heading aria-live="polite">{title}</Heading>
        {!handle && !storageMissing && config && !RETIRED_RUNTIME && (
          <p>
            Pay for AI with test USDC. Zero-knowledge proofs show you have
            enough funds to pay.
          </p>
        )}
      </div>
      {!recoveryMode &&
        !showFunding &&
        !withdrawalPending &&
        !withdraw &&
        privacyNote}
      {RETIRED_RUNTIME && (
        <div className="notice" role="status">
          <strong>Retired Pool · existing deposits only</strong>
          <p>
            Keep this browser’s data and use the original wallet. New deposits
            and messages are disabled. The old service is no longer connected,
            so this page cannot currently complete recovery.
          </p>
        </div>
      )}
      {connection &&
        presentation === "dialog" &&
        (managing ||
          RETIRED_RUNTIME ||
          storageMissing ||
          handle?.invalidated) && (
          <div className="connected-wallet-summary">
            <WalletIcon wallet={connection.wallet} />
            <div className="connected-wallet-details">
              <span className="connected-wallet-name">
                {!handle?.invalidated && <span className="status-dot" />}
                {connection.wallet.name}
              </span>
              <code title={connection.account.address}>
                {connection.account.address}
              </code>
            </div>
            <button
              className="icon-button"
              aria-label="Copy wallet address"
              onClick={() => void copyAddress()}
            >
              <Copy size={17} />
            </button>
            <button
              className="icon-button"
              aria-label="Disconnect"
              title="Disconnect"
              disabled={disabled}
              onClick={onDisconnect}
            >
              <Unplug size={17} />
            </button>
          </div>
        )}
      {busy && (
        <p className="inline-status" role="status">
          <LoaderCircle className="spin" size={16} />
          {progressMessage}
        </p>
      )}
      {!busy && (locked || status?.busy) && !automaticConfirmation && (
        <p className="inline-status" role="status">
          <LoaderCircle className="spin" size={16} />
          You can continue when the current operation finishes.
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      {info && !busy && (
        <p className="success-message" role="status">
          {info}
        </p>
      )}
      {!config ? (
        <div className="connection-step">
          <p>
            {configLoading
              ? "The first visit may take a moment."
              : configError ||
                "Live chat is unavailable. You can try the demo."}
          </p>
          {!configLoading && (
            <button className="primary" onClick={onRetryConfig}>
              Retry connection
            </button>
          )}
        </div>
      ) : recoveryMode && connection ? (
        <RecoveryPanel
          key={`${custodyKey || connection.account.address}:${recoveryMode}`}
          mode={recoveryMode}
          incomplete={recoveryIncomplete}
          disabled={disabled}
          createFile={handle ? () => handle.createRecoveryFile() : undefined}
          onEnable={enableRecovery}
          onRestore={restoreRecovery}
          onCancel={
            !needsBackup && !recoveryIncomplete
              ? () => setRecoveryView(null)
              : undefined
          }
        />
      ) : !handle ? (
        <div className="connection-step">
          {!connection && wallet && (
            <div className="wallet-connect-form">
              <WalletPicker
                wallets={wallets}
                selected={wallet}
                disabled={disabled}
                onSelect={(selected) => {
                  setSelectedWallet(selected);
                  setError("");
                  setInfo("");
                }}
              />
              <button
                className="primary full"
                disabled={disabled}
                onClick={() => void connect()}
              >
                {busy ? "Connecting…" : "Connect wallet"}
              </button>
            </div>
          )}
          {!connection && !wallet && (
            <p className="notice">
              No Solana wallet detected. Install or enable{" "}
              <a href="https://phantom.com/" target="_blank" rel="noreferrer">
                Phantom
              </a>{" "}
              or{" "}
              <a href="https://solflare.com/" target="_blank" rel="noreferrer">
                Solflare
              </a>
              , then reload this page.
            </p>
          )}
          {connection && !storageMissing && !recoveryIncomplete && (
            <button
              className="primary full"
              disabled={disabled}
              onClick={() => void connect()}
            >
              {busy ? "Opening your deposits…" : "Continue to deposits"}
            </button>
          )}
          {storageMissing && (
            <>
              <p>No deposits are saved in this browser for this wallet.</p>
              <p className="small muted">
                Already deposited? Restore from your recovery file, or use the
                original browser and wallet.
              </p>
              {RETIRED_RUNTIME ? (
                <p>
                  No saved deposit was found for this wallet. This retired Pool
                  cannot create new payment storage.
                </p>
              ) : (
                <>
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void connect(true)}
                  >
                    Set up this browser
                  </button>
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => setRecoveryView("restore")}
                  >
                    Restore from recovery file
                  </button>
                </>
              )}
            </>
          )}
        </div>
      ) : (
        <>
          {handle.invalidated && (
            <p className="error-message" role="alert">
              Wallet changed. Disconnect, then reconnect with the original
              account: {handle.account.address}.
            </p>
          )}
          {!status && (
            <div className="connection-step">
              <p>Checking the saved state for this wallet.</p>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() => void action(refresh)}
              >
                Retry opening deposits
              </button>
            </div>
          )}
          {showBalance && (
            <div className="balance-panel">
              <div>
                <span className="eyebrow">
                  {withdrawalPending
                    ? "Withdrawal in progress"
                    : status?.session
                      ? "Last confirmed balance"
                      : "Current deposit"}
                </span>
                <p>
                  <strong>{formatUsdc(fundedNoteBalance(status))}</strong> USDC
                </p>
                {withdrawalPending ? (
                  <small>Last confirmed amount · unavailable for chats</small>
                ) : (
                  status?.session && (
                    <small>Current usage has not been deducted yet.</small>
                  )
                )}
              </div>
              <ShieldCheck size={28} />
            </div>
          )}
          {expiryNotice && (
            <p className="notice" role="status">
              <strong>{expiryNotice.title}</strong>
              <br />
              {expiryNotice.body}
            </p>
          )}
          {status?.walletOperation && (
            <div className="pending-card connection-step">
              {withdrawalInProgress ? (
                <>
                  <p>
                    {operation?.kind === "initiate_escape"
                      ? "Starting a delayed withdrawal sends a proof in several transactions. Approve when your wallet asks. A waiting period follows before you can finish withdrawing."
                      : operation?.kind === "finalize_escape"
                        ? "Confirm the final withdrawal in your wallet to return your USDC."
                        : "Withdrawal sends a proof in several transactions. Approve each one in your wallet. Your USDC returns after the final transaction."}
                  </p>
                  <p className="small">
                    {operation?.kind === "mutual_close"
                      ? "Finish withdrawing, then choose another deposit or add funds to chat again."
                      : "Chat is paused while this withdrawal is unresolved. After a completed withdrawal, choose another deposit or add funds to chat again."}
                  </p>
                  {operation?.signature ? (
                    <p className="inline-status" role="status">
                      {automaticConfirmation
                        ? walletObservation.retryOnly
                          ? "Confirmation is taking longer. Your progress is saved."
                          : "Checking your latest transaction automatically…"
                        : "Transaction submitted. Continue to confirm it; your wallet may ask for another approval."}
                    </p>
                  ) : !proofRequired && !rejected ? (
                    <p className="inline-status" role="status">
                      Your next wallet approval is needed.
                    </p>
                  ) : null}
                  {RETIRED_RUNTIME && (
                    <p className="small">
                      The old service is not connected. This page cannot
                      currently complete recovery.
                    </p>
                  )}
                </>
              ) : (
                <p>
                  {retiredUnsignedDeposit
                    ? "This deposit was not submitted before the Pool retired. No new deposit will be signed. Keep its saved data."
                    : operation?.signature
                      ? automaticConfirmation
                        ? walletObservation.retryOnly
                          ? "Confirmation is taking longer. Your deposit progress is saved."
                          : "Your deposit was sent. We’re checking its confirmation automatically."
                        : "Your deposit was sent. Continue to verify its confirmation. Your wallet may ask for another approval."
                      : proofRequired
                        ? "Your deposit is saved. Resume its preparation before approving it."
                        : rejected
                          ? "This deposit was rejected. Review and retry the saved operation."
                          : "Approve this deposit in your wallet. Network fees are paid in SOL."}
                </p>
              )}
              {!withdrawalInProgress && !retiredUnsignedDeposit && (
                <div className="funding-summary">
                  <span>Deposit amount</span>
                  <strong>
                    {formatUsdc(status.settledBalanceMicroUsdc)} USDC
                  </strong>
                  <small>Network fee in SOL · shown in your wallet</small>
                </div>
              )}
              {status.walletOperation.signature && (
                <a
                  href={`https://explorer.solana.com/tx/${encodeURIComponent(status.walletOperation.signature)}?cluster=devnet`}
                  target="_blank"
                  rel="noreferrer"
                >
                  {withdrawalInProgress
                    ? "View latest transaction"
                    : "View transaction"}{" "}
                  <ExternalLink size={13} />
                </a>
              )}
              {!retiredUnsignedDeposit && (
                <div className="connection-actions">
                  {automaticConfirmation ? (
                    <button
                      className="primary"
                      disabled={
                        disabled ||
                        handle.invalidated ||
                        !walletObservation.retryOnly ||
                        walletObservation.state === "checking"
                      }
                      onClick={() => void walletObservation.checkNow()}
                    >
                      {walletObservation.retryOnly &&
                      walletObservation.state !== "checking" ? (
                        "Check confirmation"
                      ) : (
                        <>
                          <LoaderCircle className="spin" size={16} />
                          Confirming transaction…
                        </>
                      )}
                    </button>
                  ) : proofRequired && !retiredDeposit ? (
                    <button
                      className="primary"
                      disabled={disabled || handle.invalidated}
                      onClick={() =>
                        void action(
                          async () => {
                            await handle.client.resumeWalletProof();
                            setProgressState("");
                          },
                          "Could not resume preparation. Your saved operation is kept.",
                          "Preparing your saved operation…",
                        )
                      }
                    >
                      {withdrawalInProgress
                        ? "Resume withdrawal preparation"
                        : "Resume deposit preparation"}
                    </button>
                  ) : rejected && !retiredDeposit ? (
                    <button
                      className="primary"
                      disabled={disabled || handle.invalidated}
                      onClick={() =>
                        void action(
                          async () => {
                            await handle.client.retryRejectedWalletOperation();
                            setProgressState("");
                          },
                          "Could not retry this operation. Your saved progress is kept.",
                          "Preparing to retry…",
                        )
                      }
                    >
                      Try this step again
                    </button>
                  ) : (
                    <button
                      className="primary"
                      disabled={disabled || handle.invalidated}
                      onClick={() =>
                        void action(
                          async () => {
                            const p = await handle.client
                              .advanceWallet()
                              .catch((e) => {
                                throw walletStepError(e);
                              });
                            setProgressState(p.state);
                          },
                          "Could not continue this operation. Your saved progress is kept.",
                          status.walletOperation?.signature
                            ? "Continuing transaction confirmation…"
                            : `Approve in ${connection?.wallet.name ?? "your wallet"}…`,
                        )
                      }
                    >
                      {withdrawalInProgress
                        ? "Continue withdrawal"
                        : status.walletOperation.signature
                          ? "Continue deposit confirmation"
                          : "Approve deposit in wallet"}
                    </button>
                  )}
                </div>
              )}
              <details className="connection-details">
                <summary>Transaction details</summary>
                <code>
                  {status.walletOperation.kind} / {status.walletOperation.phase}
                </code>
                {automaticConfirmation && walletObservation.retryOnly && (
                  <>
                    <p className="small">
                      If confirmation is still unavailable, retry the saved
                      transaction. Your wallet may ask for approval.
                    </p>
                    <button
                      className="secondary"
                      disabled={
                        disabled ||
                        handle.invalidated ||
                        walletObservation.state === "checking"
                      }
                      onClick={() =>
                        void action(
                          async () => {
                            const result = await handle.client
                              .advanceWallet()
                              .catch((e) => {
                                throw walletStepError(e);
                              });
                            setProgressState(result.state);
                          },
                          "Could not retry this transaction. Your saved progress is kept.",
                          "Retrying your saved transaction…",
                        )
                      }
                    >
                      Retry saved transaction
                    </button>
                  </>
                )}
              </details>
              {(progressState === "expired_reconcile_required" ||
                walletObservation.lastResult ===
                  "expired_reconcile_required") &&
                status.walletOperation.phase === "ready" &&
                status.walletOperation.signature && (
                  <details className="notice">
                    <summary>Expired setup recovery</summary>
                    <p>
                      Check an expired setup step. Pending transfers will stay
                      saved.
                    </p>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void action(
                          () => handle.client.recoverExpiredWalletSetup(),
                          "Setup is still unresolved. Keep this browser’s data and check the transaction later.",
                        )
                      }
                    >
                      Check expired setup
                    </button>
                  </details>
                )}
              {status.walletOperation.kind === "mutual_close" &&
                !status.walletOperation.signature &&
                status.walletOperation.phase === "proving" &&
                error && (
                  <details className="notice">
                    <summary>Blocked withdrawal options</summary>
                    <p>
                      Use a delayed withdrawal if normal withdrawal is blocked.
                      A waiting period applies. This option is unavailable after
                      signing the original withdrawal.
                    </p>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void action(
                          () => handle.client.fallbackToEscape(),
                          "Continue the original withdrawal. This option is unavailable.",
                        )
                      }
                    >
                      Use delayed withdrawal
                    </button>
                  </details>
                )}
            </div>
          )}
          {showPayment && status?.session && (
            <PaymentContainer className="pending-card connection-step">
              {operation && <summary>Payment recovery</summary>}
              <p>
                {RETIRED_RUNTIME
                  ? "This saved payment belongs to the retired Pool. Resolving it does not resend your message."
                  : reusableSession(status)
                    ? wantsAdd
                      ? "Finish the charges for this chat before creating a separate deposit. Your conversation and draft stay here."
                      : needsConversationSettlement
                        ? "Finish the previous payment to use this deposit here. Your draft is kept."
                        : "Settle the charges for this chat before changing deposits or withdrawing."
                    : status.session.phase === "closing"
                      ? "Payment settlement is not confirmed yet. Sending stays paused until it finishes."
                      : "Resolve the saved payment before sending again. Your message will not be resent."}
              </p>
              {reusableSession(status) && !RETIRED_RUNTIME ? (
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={() => void settlePayment()}
                >
                  {wantsAdd ? "Settle and continue" : "Settle charges"}
                </button>
              ) : (
                <button
                  className="primary"
                  disabled={disabled}
                  onClick={() => void resolvePayment()}
                >
                  <RefreshCw size={15} />
                  Resolve payment
                </button>
              )}
              {wantsAdd && !operation && (
                <button
                  className="text-button"
                  onClick={() => setIntent("manage")}
                >
                  Back to balance
                </button>
              )}
              <details className="connection-details">
                <summary>Payment details and recovery</summary>
                <code>{status.session.phase}</code>
                {status.session.id && (
                  <p className="small">
                    Payment reference: <code>{status.session.id}</code>
                  </p>
                )}
                {paymentRecoveryDetails(status).map((detail) => (
                  <p className="small" key={detail}>
                    {detail}
                  </p>
                ))}
                {reusableSession(status) && (
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => void resolvePayment()}
                  >
                    Resolve saved payment
                  </button>
                )}
                {status.session.phase === "prepared" &&
                  status.session.operations.length === 0 &&
                  !status.walletOperation && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          await handle.client.cancelUnsentAuthorization();
                          setInfo(
                            "Authorization cancelled. No message was sent.",
                          );
                        })
                      }
                    >
                      Cancel unused authorization
                    </button>
                  )}
                {status.mode === "proxy" &&
                  status.session.operations.some(
                    (o) => o.phase === "send_unknown",
                  ) && (
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          await handle.client.reconcileAbsentOperations();
                          setInfo("Request checked. No message was resent.");
                        })
                      }
                    >
                      Check unsent request
                    </button>
                  )}
                {status.canReconcileUnacceptedAuthorization && (
                  <div className="notice">
                    <p>
                      Disable the uncertain authorization only if you want to
                      withdraw this deposit. This permanently prevents new
                      messages from using it, including after the service
                      recovers. No message is resent and no funds move here.
                    </p>
                    <button
                      className="secondary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          await handle.client.reconcileUnacceptedAuthorization();
                          setInfo(
                            RETIRED_RUNTIME
                              ? "Authorization disabled. Keep this deposit’s saved data while checking withdrawal availability. Refreshing cannot re-enable it."
                              : "Authorization disabled. Withdraw this deposit’s balance before funding a new deposit. Refreshing cannot re-enable it.",
                          );
                        })
                      }
                    >
                      Disable authorization for withdrawal
                    </button>
                  </div>
                )}
              </details>
            </PaymentContainer>
          )}
          {status?.wallet === "pending_escape" && !operation && (
            <div className="pending-card">
              <p>
                Wait for the withdrawal deadline, then finish the withdrawal.
              </p>
              <button
                className="primary"
                disabled={disabled}
                onClick={() =>
                  void action(() => handle.client.prepareFinalizeEscape())
                }
              >
                Finish withdrawal
              </button>
            </div>
          )}
          {!RETIRED_RUNTIME && servicePaused && (
            <div className="notice" role="status">
              <p>{servicePauseReason(handle.diagnostic ?? null)}</p>
              <p className="small">
                New chats and deposits are paused. Your saved funds and recovery
                options remain available.
              </p>
              <button
                className={operation || showPayment ? "secondary" : "primary"}
                disabled={disabled}
                onClick={() => void retryServiceCheck()}
              >
                <RefreshCw size={15} />
                Retry connection
              </button>
            </div>
          )}
          {showFunding && (
            <form
              className="fund-form connection-step"
              onSubmit={(e) => {
                e.preventDefault();
                void reviewDeposit();
              }}
            >
              {!additionalFunding && (
                <>
                  <p>
                    Deposit USDC to pay for AI. Zero-knowledge proofs show you
                    have enough funds to pay.
                  </p>
                  {privacyNote}
                </>
              )}
              {additionalFunding && (
                <p className="small muted">
                  This creates a separate deposit. Your existing balance is kept
                  separately.
                </p>
              )}
              <div className="field">
                <label htmlFor="fund-amount">USDC to deposit</label>
                <input
                  ref={amountInput}
                  id="fund-amount"
                  inputMode="decimal"
                  autoComplete="off"
                  value={amount}
                  disabled={disabled}
                  aria-invalid={!!amountError}
                  aria-describedby="fund-guidance"
                  onChange={(e) => setAmount(e.target.value)}
                />
                <small id="fund-guidance">
                  {amountError ||
                    `Minimum ${formatUsdc(status?.authorizationCapMicroUsdc)} USDC · Keep SOL for network fees.`}
                </small>
              </div>
              <button
                className="primary"
                disabled={
                  disabled ||
                  !handle.recoveryEnabled ||
                  !!amountError ||
                  !handle.publicAdmissionReady
                }
              >
                <ArrowDownLeft size={16} />
                {busy ? "Preparing deposit…" : "Review deposit"}
              </button>
              {wantsAdd && !initialDeposit && (
                <button
                  type="button"
                  className="text-button"
                  onClick={() => setIntent("manage")}
                >
                  Back to balance
                </button>
              )}
            </form>
          )}
          {!operation &&
            !showPayment &&
            !showFunding &&
            !withdraw &&
            !servicePaused &&
            !handle.invalidated &&
            status &&
            status.wallet !== "pending_escape" &&
            !RETIRED_RUNTIME && (
              <div className="connection-step">
                {chatReady && !wantsAdd ? (
                  <>
                    <p>
                      {depositCompleted
                        ? "Your deposit is ready."
                        : "Your balance is ready to use."}
                    </p>
                    <button className="primary" onClick={onContinueChat}>
                      {presentation === "inline"
                        ? "Start chatting"
                        : "Return to chat"}
                    </button>
                  </>
                ) : wantsAdd && disabled ? (
                  <p>You can add funds when the current operation finishes.</p>
                ) : hasLowBalance(status) ? (
                  <>
                    <p>
                      At least {formatUsdc(status.authorizationCapMicroUsdc)}{" "}
                      USDC is needed to chat.
                    </p>
                    <button className="primary" onClick={startAdding}>
                      Add funds
                    </button>
                  </>
                ) : status.wallet === "closed" ? (
                  <>
                    <p>Your funds are back in your wallet.</p>
                    <button className="primary" onClick={startAdding}>
                      Add funds
                    </button>
                  </>
                ) : !status.canRequest &&
                  canChangeDeposit(status) &&
                  status.expiry?.severity !== "expired" ? (
                  <p className="notice">
                    This deposit cannot authorize new messages. If its
                    authorization was disabled, withdraw its balance before
                    funding a new deposit. Refreshing cannot undo that
                    protection.
                  </p>
                ) : !chatReady && status.canRequest ? (
                  <p>
                    Your deposit is available. Return to chat to check the
                    selected model and connection.
                  </p>
                ) : null}
              </div>
            )}
          {(managing || RETIRED_RUNTIME) && status && (
            <section
              className="deposit-management connection-secondary"
              aria-label="Manage deposits"
            >
              {!RETIRED_RUNTIME && (
                <div className="connection-context">
                  <strong>
                    {handle.recoveryEnabled
                      ? "Recovery is set up"
                      : "Protect your saved deposits"}
                  </strong>
                  <p className="small muted">
                    {handle.recoveryEnabled
                      ? "Your recovery file also covers new deposits. Keep it safe."
                      : "A recovery file lets you get your deposits back if this browser loses its data."}
                  </p>
                  {!handle.recoveryEnabled && (
                    <button
                      className="secondary"
                      disabled={disabled || handle.invalidated}
                      onClick={() => setRecoveryView("setup")}
                    >
                      Set up recovery
                    </button>
                  )}
                  <button
                    className="text-button"
                    disabled={disabled}
                    onClick={() => setRecoveryView("restore")}
                  >
                    Restore from recovery file
                  </button>
                </div>
              )}
              {reusableSession(status) && !showPayment && (
                <div className="connection-context">
                  <p className="small muted">
                    Charges for this chat have not been settled yet.
                  </p>
                  <button
                    className="text-button"
                    onClick={() => setIntent("payment")}
                  >
                    Review payment
                  </button>
                </div>
              )}
              {!RETIRED_RUNTIME &&
                !initialDeposit &&
                !showFunding &&
                !hasLowBalance(status) &&
                status.wallet !== "closed" &&
                !wantsAdd && (
                  <button className="secondary" onClick={startAdding}>
                    <ArrowDownLeft size={16} />
                    Add funds
                  </button>
                )}
              {(handle.deposits?.length ?? 0) > 1 && (
                <div className="field">
                  <label htmlFor="saved-deposit">Saved deposits</label>
                  <select
                    id="saved-deposit"
                    value={handle.selectedDepositId}
                    disabled={disabled || !canChangeDeposit(status)}
                    onChange={(e) => {
                      const id = e.target.value;
                      void action(
                        async () => {
                          await handle.selectDeposit(id);
                          setDepositCompleted(false);
                          setInfo("Deposit selected.");
                        },
                        "Could not open this deposit. Reconnect with the same wallet.",
                        "Opening the selected deposit…",
                      );
                    }}
                  >
                    {handle.deposits?.map((deposit, index) => (
                      <option key={deposit.id} value={deposit.id}>
                        Deposit {index + 1}
                        {deposit.id === status.noteId
                          ? ` · ${formatUsdc(fundedNoteBalance(status))} USDC${status.wallet === "closed" ? " · Withdrawn" : ""}`
                          : ""}
                      </option>
                    ))}
                  </select>
                  <small>
                    Each deposit is saved separately. zkChat creates proofs for
                    the deposit you select. Balances are not combined.
                    {!canChangeDeposit(status)
                      ? " Finish the saved operation before switching deposits."
                      : ""}
                  </small>
                </div>
              )}
            </section>
          )}
          {(status?.canPrepareEmergencyEscape ||
            status?.canReconcileChallengedEscape) && (
            <details className="notice">
              <summary>Delayed withdrawal options</summary>
              <p>
                {status.canPrepareEmergencyEscape
                  ? "Optional withdrawal — not started. Resolving payment does not start this process. Choose it only if you want to withdraw this deposit after a waiting period."
                  : "A delayed withdrawal was already started. Resolving payment does not start a new withdrawal. Follow the saved withdrawal status below."}
              </p>
              <p>Withdrawal requires wallet approvals and a waiting period.</p>
              {status.canPrepareEmergencyEscape && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() =>
                    void action(() =>
                      handle.client.prepareEmergencyEscape(
                        handle.account.address,
                      ),
                    )
                  }
                >
                  Start delayed withdrawal
                </button>
              )}
              {status.canReconcileChallengedEscape && (
                <button
                  className="secondary"
                  disabled={disabled}
                  onClick={() =>
                    void action(() => handle.client.reconcileChallengedEscape())
                  }
                >
                  Check withdrawal dispute
                </button>
              )}
              {status.emergencyEscape && (
                <p>Emergency withdrawal: {status.emergencyEscape.phase}</p>
              )}
            </details>
          )}
          {(managing || RETIRED_RUNTIME || withdraw) &&
            status?.wallet === "active" &&
            !status.session &&
            !status.walletOperation && (
              <div className="withdraw-section">
                {withdraw ? (
                  <div className="notice">
                    <p>Return this deposit to your connected wallet.</p>
                    <p>
                      Starting withdrawal stops this deposit from paying for
                      chats, even before wallet approval. It cannot be canceled
                      here. After withdrawing, choose another deposit or add
                      funds to chat again.
                    </p>
                    <p>
                      {RETIRED_RUNTIME
                        ? "Withdrawal may require several transactions and SOL fees. The old service must still support the remaining steps; completion is not guaranteed."
                        : "You will approve several transactions, each with a SOL fee. Your USDC returns after the final step."}
                    </p>
                    <div className="button-row">
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          void action(async () => {
                            const address = handle.account.address;
                            await handle.client.prepareWithdrawal(
                              address,
                              "mutual_close",
                            );
                            setWithdraw(false);
                            setProgressState("");
                          })
                        }
                      >
                        Start withdrawal
                      </button>
                      <button
                        className="secondary"
                        onClick={() => setWithdraw(false)}
                      >
                        {RETIRED_RUNTIME
                          ? "Back to balance"
                          : "Keep using this deposit"}
                      </button>
                    </div>
                  </div>
                ) : (
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() => setWithdraw(true)}
                  >
                    <ArrowUpRight size={16} />
                    Withdraw balance
                  </button>
                )}
              </div>
            )}
        </>
      )}
      {!handle && onTryDemo && (
        <button
          className="text-button"
          disabled={busy || locked}
          onClick={onTryDemo}
        >
          Try the demo
        </button>
      )}
      {!RETIRED_RUNTIME && (
        <section className="faucet-inline" aria-label="Get test tokens">
          <div>
            <strong>Need test tokens?</strong>
            <p className="small muted">USDC for AI · SOL for network fees</p>
          </div>
          <div className="faucet-links">
            <a
              href="https://faucet.circle.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get test USDC <ExternalLink size={13} aria-hidden="true" />
            </a>
            <a
              href="https://faucet.solana.com/"
              target="_blank"
              rel="noopener noreferrer"
            >
              Get test SOL <ExternalLink size={13} aria-hidden="true" />
            </a>
          </div>
          <p className="small muted">
            Choose USDC and Solana Devnet, then return here to deposit.
          </p>
          {connection ? (
            <div className="faucet-wallet">
              <span>
                {connection.wallet.name} ·{" "}
                {connection.account.address.slice(0, 4)}…
                {connection.account.address.slice(-4)}
              </span>
              <button
                className="text-button"
                onClick={() => void copyAddress()}
              >
                <Copy size={13} />
                Copy address
              </button>
            </div>
          ) : (
            <p className="small muted">
              Connect your wallet to see the receiving address.
            </p>
          )}
        </section>
      )}
      <details className="connection-details">
        <summary>How it works and recovery data</summary>
        {!RETIRED_RUNTIME && (
          <p>
            Your browser creates proofs from the selected deposit when you pay
            or withdraw. Payment proofs show you have enough funds without
            including your deposit ID in the payment request.
          </p>
        )}
        <p>
          {handle?.recoveryEnabled
            ? "Your recovery file unlocks an encrypted backup of your deposits. Keep it outside this browser. Recovery needs the service to be available and does not extend a deposit’s withdrawal deadline."
            : "Without a recovery file, deleting this browser’s data can make your deposits inaccessible. Your wallet alone cannot restore them. Keep the original browser’s data until recovery is set up or you withdraw."}
        </p>
        <p>Chat history is saved in this browser without encryption.</p>
      </details>
      {!RETIRED_RUNTIME && (presentation === "dialog" || storageMissing) && (
        <details
          className="connection-details"
          open={error.includes("SDK .3") || error.includes("October 8")}
        >
          <summary>Older deposit data</summary>
          <p>
            <a href={`${import.meta.env.BASE_URL}recovery-v12/`}>
              Open October 8 deposit data
            </a>
          </p>
          <p>
            <a href={`${import.meta.env.BASE_URL}recovery-v3/`}>
              Open original deposit data
            </a>
          </p>
          <p className="small muted">
            These pages open your saved data for retired deposits. The old
            service is no longer connected, so they cannot currently complete
            recovery. Keep this browser’s data.
          </p>
        </details>
      )}
      {(presentation === "dialog" || !!error) && (
        <details className="connection-details">
          <summary>Connection details</summary>
          {handle && (
            <button
              className="text-button"
              disabled={disabled}
              onClick={() => void retryServiceCheck()}
            >
              <RefreshCw size={14} />
              Recheck connection
            </button>
          )}
          <p className="small muted">
            SDK {SDK_VERSION}
            {LOCAL_RECOVERY_PREVIEW ? " · Local recovery preview" : ""} · Solana
            Devnet
          </p>
          {config && (
            <>
              <div className="config-summary">
                <span>Deployment</span>
                <strong>{config.label}</strong>
                <span>Route</span>
                <strong>
                  {config && configuredMode(config) === "proxy"
                    ? "Proxy"
                    : "Direct"}
                </strong>
              </div>
              <details className="model-availability">
                <summary>
                  Available models ({configuredModels(config).length})
                </summary>
                <p className="small muted">
                  Enabled models:{" "}
                  {configuredModels(config)
                    .map((model) => model.label || model.id)
                    .join(", ")}
                  .
                </p>
                {configuredMode(config) === "direct_openrouter" && (
                  <p className="small muted">
                    The service owner controls this model list.
                  </p>
                )}
              </details>
            </>
          )}
          {config?.schema === 2 && !handle && (
            <div className="notice">
              <strong>Check the service</strong>
              <p>No wallet, funds, or signatures needed.</p>
              <button
                className="secondary"
                disabled={disabled}
                onClick={() =>
                  void action(async () => {
                    setPublicCheck(null);
                    setPublicCheck(await inspectPublicDeployment(config));
                  })
                }
              >
                Check service
              </button>
              {publicCheck && (
                <p role="status">
                  {publicCheck.readiness.admission === "enabled" &&
                  !publicCheck.readiness.invitationRequired &&
                  publicCheck.readiness.servicesAvailable &&
                  publicCheck.preflight.chainAllowsNewOperations
                    ? "Service ready. Select a wallet to connect."
                    : "Service unavailable. Check again later."}
                </p>
              )}
            </div>
          )}
          {handle && (
            <p className="small muted">
              Browser storage:{" "}
              {handle.persistence === "persistent"
                ? "persistence granted"
                : "may be automatically deleted"}
              . This is not a backup.
              <br />
              USDC mint: <code>{handle.deployment.mint}</code>
            </p>
          )}
          {error.includes("chain connection") && (
            <p className="small muted">
              App URL: <code>{location.origin}</code>. HTTPS and localhost are
              supported.
            </p>
          )}
        </details>
      )}
    </div>
  );
  if (presentation === "dialog")
    return (
      <Modal title="Wallet & balance" onClose={onClose} wide>
        {content}
      </Modal>
    );
  return (
    <section className="onboarding-panel" aria-label="Start chatting">
      {content}
    </section>
  );
}
