import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Copy,
  CircleHelp,
  ExternalLink,
  LoaderCircle,
  RefreshCw,
  ShieldCheck,
  Wallet,
  Unplug,
} from "lucide-react";
import type { ClientStatus } from "@zkapi/solana-sdk";
import { SDK_VERSION, RECOVERY_RUNTIME } from "../lib/sdkVersion";
import { reusableSession } from "../lib/sdkStatus";
import {
  BrowserStorageMissing,
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

export interface WalletConnection {
  wallet: AppWallet;
  account: StandardAccount;
  needsSetup?: boolean;
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
}) {
  const [invitation, setInvitation] = useState("");
  const [wallets, setWallets] = useState<AppWallet[]>(listWallets);
  const [selectedWallet, setSelectedWallet] = useState<AppWallet | null>(null);
  const wallet =
    selectedWallet && wallets.includes(selectedWallet)
      ? selectedWallet
      : wallets[0];
  const connection = walletConnection;
  const storageMissing = connection?.needsSetup ?? false;
  const [busy, setBusy] = useState(false);
  const [progressMessage, setProgressMessage] = useState("");
  const [error, setError] = useState("");
  const [info, setInfo] = useState("");
  const [amount, setAmount] = useState("2");
  const [retentionAccepted, setRetentionAccepted] = useState(false);
  const [withdraw, setWithdraw] = useState(false);
  const [progressState, setProgressState] = useState("");
  const amountInput = useRef<HTMLInputElement>(null);
  const focusNewDeposit = useRef(false);
  const [publicCheck, setPublicCheck] = useState<Awaited<
    ReturnType<typeof inspectPublicDeployment>
  > | null>(null);
  useEffect(() => watchWallets(() => setWallets(listWallets())), []);
  useEffect(() => {
    if (!connection) {
      setError("");
      setInfo("");
    }
  }, [connection?.wallet, connection?.account.address]);
  useEffect(() => {
    setWithdraw(false);
    setProgressState("");
  }, [status?.noteId]);
  useEffect(() => {
    if (!busy && focusNewDeposit.current && status?.wallet === "empty") {
      focusNewDeposit.current = false;
      amountInput.current?.focus();
    }
  }, [status?.noteId, status?.wallet, busy]);
  async function action(
    fn: () => Promise<void>,
    fallback = "Could not complete this step. Refresh status, then follow the next action below.",
    progress = "Checking your saved progress…",
  ) {
    if (busy || locked) return;
    setBusy(true);
    setProgressMessage(progress);
    onBusy(true);
    setError("");
    setInfo("");
    try {
      await fn();
    } catch (e) {
      setError(
        e instanceof PublicOnboardingError ||
          e instanceof DepositError ||
          e instanceof WalletConnectionError ||
          e instanceof AmountInputError
          ? e.message
          : fallback,
      );
    } finally {
      await refresh().catch(() =>
        setError("Could not check progress. Reconnect with the same wallet."),
      );
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
        invitation || undefined,
      );
      setInvitation("");
      onWalletConnect({
        wallet: connectedWallet.wallet,
        account: connectedWallet.account,
      });
      onConnect(connected, connectedWallet.account.address);
      setInfo("Wallet connected.");
    } catch (e) {
      if (e instanceof BrowserStorageMissing) {
        onWalletConnect({ ...connectedWallet, needsSetup: true });
      } else {
        throw e;
      }
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
        "Could not copy the address. Select it below and copy it manually.",
      );
    }
  }
  const disabled = busy || locked || configLoading || !!status?.busy;
  return (
    <div className="connection-panel" aria-busy={busy || configLoading}>
      <div className="connection-intro">
        <div className="section-icon">
          <Wallet size={22} />
        </div>
        <div>
          <h3>
            {handle?.invalidated
              ? "Reconnect your wallet"
              : connection
                ? "Your wallet"
                : "Connect your wallet"}
          </h3>
          <p>Pay for AI with USDC. Keep SOL for network fees.</p>
        </div>
      </div>
      <div className="connection-facts">
        <span>
          <span className="status-dot" />
          Solana Devnet
        </span>
        <span>Test tokens only</span>
      </div>
      {connection && (
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
            onClick={() => {
              setInvitation("");
              onDisconnect();
            }}
          >
            <Unplug size={17} />
          </button>
        </div>
      )}
      {!config ? (
        <div className="setup-needed">
          <CircleHelp size={22} />
          <div>
            <h4>
              {configLoading
                ? "Loading service…"
                : configError
                  ? "Service unavailable"
                  : "Live chat is not set up"}
            </h4>
            <p>
              {configLoading
                ? "The first visit may take a moment."
                : configError ||
                  "Ask the app owner to configure the service. You can try the demo now."}
            </p>
            <a
              href="https://github.com/yukikm/solana-zkapi/blob/main/docs/getting-started/sdk.md"
              target="_blank"
              rel="noreferrer"
            >
              Setup guide <ExternalLink size={13} />
            </a>
            {!configLoading && (
              <button className="secondary" onClick={onRetryConfig}>
                Reload settings
              </button>
            )}
          </div>
        </div>
      ) : (
        <>
          {!handle ? (
            <>
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
                    {busy && <LoaderCircle className="spin" size={16} />}
                    {busy ? "Connecting…" : "Connect wallet"}
                  </button>
                  <p className="small muted wallet-connect-hint">
                    Choose your wallet, then approve the connection in the
                    extension.
                  </p>
                </div>
              )}
              {!connection && !wallet && (
                <p className="notice">
                  No Solana wallet detected. Install or enable{" "}
                  <a
                    href="https://phantom.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Phantom
                  </a>{" "}
                  or{" "}
                  <a
                    href="https://solflare.com/"
                    target="_blank"
                    rel="noreferrer"
                  >
                    Solflare
                  </a>
                  , then reload this page.
                </p>
              )}
              {connection && !storageMissing && (
                <button
                  className="primary full"
                  disabled={disabled}
                  onClick={() => void connect()}
                >
                  {busy && <LoaderCircle className="spin" size={16} />}
                  {busy ? "Opening your deposits…" : "Continue to deposits"}
                </button>
              )}
              {config.schema === 2 && (
                <details className="notice">
                  <summary>Have an invitation?</summary>
                  <div className="field">
                    <label htmlFor="admission-invitation">
                      Invitation code
                    </label>
                    <input
                      id="admission-invitation"
                      type="password"
                      autoComplete="off"
                      spellCheck={false}
                      value={invitation}
                      onChange={(e) => setInvitation(e.target.value)}
                      disabled={disabled}
                    />
                    <small>
                      Leave empty unless the service owner gave you a code. It
                      is not saved.
                    </small>
                  </div>
                </details>
              )}
              {storageMissing && (
                <div className="notice">
                  <p>
                    This browser saves your payment recovery data. Deleting it
                    can lock you out of your funds.
                  </p>
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void connect(true)}
                  >
                    Set up this wallet
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {handle.invalidated && (
                <p className="error-message" role="alert">
                  Wallet changed. Disconnect, then reconnect with the original
                  account.
                </p>
              )}
              <div className="balance-panel">
                <div>
                  <span className="eyebrow">Deposit balance</span>
                  <p>
                    <strong>{formatUsdc(fundedNoteBalance(status))}</strong>{" "}
                    USDC
                  </p>
                  <small>
                    Minimum to chat:{" "}
                    {formatUsdc(status?.authorizationCapMicroUsdc)} USDC
                  </small>
                </div>
                <ShieldCheck size={28} />
              </div>
              <p className="small muted">
                {status?.wallet === "closed"
                  ? "Withdrawal complete. Your funds are back in your wallet."
                  : status?.wallet === "unfunded" || status?.wallet === "empty"
                    ? "Enter an amount below, then approve the deposit in your wallet."
                    : reusableSession(status)
                      ? "Ready to chat. Settle charges before withdrawing."
                      : status?.session
                        ? "Check payment below before sending again. Charges are not yet deducted."
                        : status?.canRequest
                          ? "Ready to chat."
                          : "Complete the next step below to start chatting."}
              </p>
              <section
                className="deposit-management"
                aria-label="Manage deposits"
              >
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
                        {deposit.id === status?.noteId
                          ? ` · ${formatUsdc(fundedNoteBalance(status))} USDC${status.wallet === "closed" ? " · Withdrawn" : ""}`
                          : ""}
                      </option>
                    ))}
                  </select>
                </div>
                <p className="small muted">
                  Choose a deposit to spend or withdraw. Balances stay separate.
                </p>
                {hasLowBalance(status) && (
                  <p className="notice" role="status">
                    At least {formatUsdc(status?.authorizationCapMicroUsdc)}{" "}
                    USDC is needed to chat. Add or select another deposit. You
                    can still withdraw this balance.
                  </p>
                )}
                <button
                  className="primary"
                  disabled={
                    disabled ||
                    !canAddDeposit(status) ||
                    !handle.publicAdmissionReady
                  }
                  onClick={() =>
                    void action(
                      async () => {
                        await handle.addDeposit();
                        focusNewDeposit.current = true;
                        setInfo(
                          "Enter an amount below. No funds have moved yet.",
                        );
                      },
                      "Could not add a deposit. Reconnect to check your saved deposits.",
                      "Opening a new deposit…",
                    )
                  }
                >
                  <ArrowDownLeft size={16} />
                  Add deposit
                </button>
                {!canChangeDeposit(status) && (
                  <p className="small muted">
                    Finish the step below before adding or switching deposits.
                  </p>
                )}
                {(status?.wallet === "empty" ||
                  status?.wallet === "unfunded") &&
                  canChangeDeposit(status) && (
                    <p className="small muted">
                      Enter an amount below to fund this deposit.
                    </p>
                  )}
              </section>
              {status?.expiry && (
                <p className="notice" role="status">
                  {status.expiry.message}
                </p>
              )}
              {config.schema === 2 && !handle.publicAdmissionReady && (
                <div className="notice" role="status">
                  <strong>Service unavailable</strong>
                  <p>
                    {handle.diagnostic?.preflight?.paused
                      ? "The service is paused. Check again later."
                      : handle.diagnostic?.unavailableComponent
                        ? "Could not check the service. You can still check existing payments."
                        : handle.diagnostic?.readiness?.admission ===
                            "suspended"
                          ? "New requests are paused. Existing payments and withdrawals can still be checked."
                          : handle.diagnostic?.readiness?.invitationRequired
                            ? "Reconnect with an invitation code. Keep this browser’s data."
                            : "Choose Refresh status to check again. Existing payments stay saved."}
                  </p>
                </div>
              )}
              <div className="notice">
                <strong>Keep your recovery data</strong>
                <p>
                  {handle.persistence !== "persistent" &&
                    "Your browser may delete saved data automatically. "}
                  Keep this browser’s data while funds remain. Return to this
                  URL with the same wallet.
                </p>
              </div>
              {!status?.walletOperation &&
                !status?.session &&
                (status?.wallet === "empty" ||
                  status?.wallet === "unfunded") && (
                  <form
                    className="fund-form"
                    onSubmit={(e) => {
                      e.preventDefault();
                      void action(async () => {
                        const value = microUsdc(amount);
                        if (
                          status &&
                          BigInt(value) <
                            BigInt(status.authorizationCapMicroUsdc)
                        )
                          throw new AmountInputError(
                            `Deposit at least ${formatUsdc(status.authorizationCapMicroUsdc)} USDC to authorize a request.`,
                          );
                        await handle.client.prepareDeposit(value).catch((e) => {
                          throw depositPreparationError(e);
                        });
                        setProgressState("");
                        setInfo(
                          "Deposit ready. Choose Approve in wallet to continue.",
                        );
                      });
                    }}
                  >
                    <div className="field">
                      <label htmlFor="fund-amount">USDC to deposit</label>
                      <input
                        ref={amountInput}
                        id="fund-amount"
                        inputMode="decimal"
                        autoComplete="off"
                        value={amount}
                        onChange={(e) => setAmount(e.target.value)}
                      />
                      <small>Keep some SOL in your wallet for fees.</small>
                    </div>
                    <label className="check-label deposit-retention">
                      <input
                        type="checkbox"
                        checked={retentionAccepted}
                        onChange={(e) => setRetentionAccepted(e.target.checked)}
                      />
                      I will keep this browser’s data
                    </label>
                    <button
                      className="primary"
                      disabled={
                        disabled ||
                        !retentionAccepted ||
                        !handle.publicAdmissionReady
                      }
                    >
                      <ArrowDownLeft size={16} />
                      Review deposit
                    </button>
                  </form>
                )}
              {status?.walletOperation && (
                <div className="pending-card">
                  <h4>Next step</h4>
                  <details className="connection-details">
                    <summary>Transaction details</summary>
                    <code>
                      {status.walletOperation.kind} /{" "}
                      {status.walletOperation.phase}
                    </code>
                  </details>
                  <p className="small">
                    {status.walletOperation.signature
                      ? "Check whether the transaction completed. If an upload expired, your wallet may ask you to approve again."
                      : "Approve the next step in your wallet. Each transaction costs a SOL fee."}
                  </p>
                  {["mutual_close", "initiate_escape"].includes(
                    status.walletOperation.kind,
                  ) && (
                    <p className="small">
                      Withdrawal needs several wallet approvals. Continue until
                      “Withdrawal complete” appears. Funds return only after the
                      final step.
                    </p>
                  )}
                  {status.walletOperation.signature && (
                    <a
                      href={`https://explorer.solana.com/tx/${encodeURIComponent(status.walletOperation.signature)}?cluster=devnet`}
                      target="_blank"
                      rel="noreferrer"
                    >
                      View transaction <ExternalLink size={13} />
                    </a>
                  )}
                  <div className="button-row">
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          const p = await handle.client
                            .advanceWallet()
                            .catch((e) => {
                              throw walletStepError(e);
                            });
                          setProgressState(p.state);
                          setInfo(
                            p.state === "complete"
                              ? "Step complete."
                              : "Progress checked. Follow the next step below.",
                          );
                        })
                      }
                    >
                      {status.walletOperation.signature
                        ? "Check transaction"
                        : "Approve in wallet"}
                    </button>
                    {(progressState === "proof_required" ||
                      status.walletOperation.phase === "proving") && (
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() =>
                          void action(async () => {
                            await handle.client.resumeWalletProof();
                            setInfo(
                              "Preparation resumed. Follow the next step below.",
                            );
                          })
                        }
                      >
                        Resume preparation
                      </button>
                    )}
                    {(progressState === "rejected" ||
                      ["failed", "stale"].includes(
                        status.walletOperation.phase,
                      )) && (
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() =>
                          void action(() =>
                            handle.client.retryRejectedWalletOperation(),
                          )
                        }
                      >
                        Try this step again
                      </button>
                    )}
                  </div>
                  {progressState === "expired_reconcile_required" &&
                    status.walletOperation.phase === "ready" &&
                    status.walletOperation.signature && (
                      <details className="notice">
                        <summary>Expired setup recovery</summary>
                        <p>
                          Check an expired setup step. Pending transfers will
                          stay saved.
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
                          Use a delayed withdrawal if normal withdrawal is
                          blocked. A waiting period applies. This option is
                          unavailable after signing the original withdrawal.
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
              {status?.session && (
                <div className="pending-card">
                  <h4>
                    {reusableSession(status)
                      ? "Active session"
                      : "Payment pending"}
                  </h4>
                  <p className="small">
                    {reusableSession(status)
                      ? "You can keep chatting in the same conversation. Settle charges before sending in another chat, switching deposits, or withdrawing."
                      : "Check the payment before sending again. This does not resend your message."}
                  </p>
                  <details className="connection-details">
                    <summary>Payment details</summary>
                    <code>{status.session.phase}</code>
                  </details>
                  <div className="button-row">
                    {reusableSession(status) && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          void action(async () => {
                            await handle.client.settle();
                            setInfo(
                              "Settlement requested. Follow the status below.",
                            );
                          })
                        }
                      >
                        Settle charges
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
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          await handle.client.recover();
                          setInfo("Payment checked. Follow the status below.");
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Check payment
                    </button>
                    {status.mode === "proxy" &&
                      status.session.operations.some(
                        (operation) => operation.phase === "send_unknown",
                      ) && (
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() =>
                            void action(async () => {
                              await handle.client.reconcileAbsentOperations();
                              setInfo(
                                "Request checked. No message was resent.",
                              );
                            })
                          }
                        >
                          Check unsent request
                        </button>
                      )}
                    {status.canReconcileUnacceptedAuthorization && (
                      <button
                        className="secondary"
                        disabled={disabled}
                        onClick={() =>
                          void action(() =>
                            handle.client.reconcileUnacceptedAuthorization(),
                          )
                        }
                      >
                        Check authorization
                      </button>
                    )}
                  </div>
                </div>
              )}
              {status?.wallet === "pending_escape" && (
                <div className="pending-card">
                  <h4>Withdrawal waiting period</h4>
                  <p>
                    Wait for the withdrawal deadline, then choose Finish
                    withdrawal.
                  </p>
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void action(() => handle.client.prepareFinalizeEscape())
                    }
                  >
                    Finish withdrawal
                  </button>
                </div>
              )}
              {(status?.canPrepareEmergencyEscape ||
                status?.canReconcileChallengedEscape) && (
                <details className="notice">
                  <summary>Delayed withdrawal options</summary>
                  <p>
                    Withdraw to this wallet after a waiting period. The payment
                    stays pending. Follow each wallet step, then return after
                    the deadline.
                  </p>
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
                        void action(() =>
                          handle.client.reconcileChallengedEscape(),
                        )
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
              {status?.wallet === "active" &&
                !status.session &&
                !status.walletOperation && (
                  <div className="withdraw-section">
                    {withdraw ? (
                      <div className="notice">
                        <p>Withdraw this deposit to your connected wallet.</p>
                        <p>
                          You will approve several transactions, each with a SOL
                          fee. Your USDC returns after the final step.
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
                                setInfo(
                                  "Withdrawal ready. Approve each step in your wallet.",
                                );
                              })
                            }
                          >
                            Review withdrawal
                          </button>
                          <button
                            className="secondary"
                            onClick={() => setWithdraw(false)}
                          >
                            Back
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
              <div className="button-row connection-bottom">
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() =>
                    void action(async () => {
                      await handle.refreshPreflight();
                      await refresh();
                    })
                  }
                >
                  <RefreshCw size={14} />
                  Refresh status
                </button>
              </div>
            </>
          )}
        </>
      )}
      {busy && (
        <p className="inline-status" role="status">
          <LoaderCircle className="spin" size={16} />
          {progressMessage}
        </p>
      )}
      {info && (
        <p className="success-message" role="status">
          {info}
        </p>
      )}
      {error && (
        <p className="error-message" role="alert">
          {error}
        </p>
      )}
      <section className="notice faucet-notice" aria-label="Get test tokens">
        <strong>Need USDC or SOL?</strong>
        <p>
          You need USDC for your deposit and SOL for gas fees. If your wallet
          does not have enough of either token, get it from a faucet before
          depositing.
        </p>
        <div className="faucet-links">
          <a
            href="https://faucet.circle.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            USDC faucet <ExternalLink size={13} aria-hidden="true" />
          </a>
          <a
            href="https://faucet.solana.com/"
            target="_blank"
            rel="noopener noreferrer"
          >
            SOL faucet <ExternalLink size={13} aria-hidden="true" />
          </a>
        </div>
        <p className="small">
          Select USDC on Circle and Solana Devnet on both faucets.
          {handle ? (
            <>
              {" "}
              Send the tokens to <code>{handle.account.address}</code>.
            </>
          ) : (
            " Send the tokens to the wallet you use here."
          )}
        </p>
      </section>
      {RECOVERY_RUNTIME ? (
        <p className="small muted">
          Recover your older deposits here. Keep this browser’s data until all
          withdrawals are complete.
        </p>
      ) : (
        !handle && (
          <details
            className="connection-details"
            open={error.includes("SDK .3")}
          >
            <summary>Have an older deposit?</summary>
            {import.meta.env.DEV ? (
              <p className="small muted">
                Stop this server, run <code>npm run dev:recovery</code>, and
                reopen the same URL with your original wallet.
              </p>
            ) : (
              <p>
                <a href={`${import.meta.env.BASE_URL}recovery-v3/`}>
                  Recover an older deposit
                </a>
              </p>
            )}
          </details>
        )
      )}
      <details className="connection-details">
        <summary>Connection details</summary>
        <p className="small muted">SDK {SDK_VERSION} · Solana Devnet</p>
        {config && (
          <>
            <div className="config-summary">
              <span>Deployment</span>
              <strong>{config.label}</strong>
              <span>Route</span>
              <strong>
                {configuredMode(config) === "proxy" ? "Proxy" : "Direct"}
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
                publicCheck.readiness.servicesAvailable &&
                publicCheck.preflight.chainAllowsNewOperations
                  ? "Service ready. Select a wallet to connect."
                  : "Service unavailable. Check again later."}
                {publicCheck.readiness.invitationRequired &&
                  " An invitation code is required."}
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
      <div className="privacy-note">
        <ShieldCheck size={17} />
        <p>
          Your messages go to the AI provider. A proxy operator can also read
          them.
        </p>
      </div>
    </div>
  );
}
