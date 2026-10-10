import { useEffect, useRef, useState } from "react";
import {
  ArrowDownLeft,
  ArrowUpRight,
  Check,
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
  connectWallet,
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
import {
  canAddDeposit,
  canChangeDeposit,
  DepositError,
  hasLowBalance,
} from "../lib/deposits";
export function ConnectionPanel({
  config,
  configError,
  configLoading,
  onRetryConfig,
  handle,
  status,
  onConnect,
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
  onDisconnect: () => void;
  refresh: () => Promise<void>;
  locked: boolean;
  onBusy: (busy: boolean) => void;
}) {
  const [invitation, setInvitation] = useState("");
  const [wallets, setWallets] = useState<AppWallet[]>(listWallets);
  const [wallet, setWallet] = useState<AppWallet | null>(null);
  const [accounts, setAccounts] = useState<StandardAccount[]>([]);
  const [account, setAccount] = useState("");
  const [storageMissing, setStorageMissing] = useState(false);
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
    fallback = "The operation could not be completed. Check your balance and pending operations. Requests are not retried automatically.",
    progress = "Checking the saved operation and public service. Proof assets may take a moment to load.",
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
        setError(
          "Status is unavailable. Reconnect with the same settings before sending anything new.",
        ),
      );
      setBusy(false);
      onBusy(false);
    }
  }
  async function pickWallet(w: AppWallet) {
    await action(
      async () => {
        setWallet(w);
        setAccounts([]);
        setAccount("");
        setStorageMissing(false);
        const available = await connectWallet(w);
        setAccounts(available);
        if (!available.length)
          setError(
            "No account supports Devnet and v0 transactions. Check your wallet settings.",
          );
      },
      "Wallet connection failed or was declined. Unlock the selected wallet and choose a Devnet-compatible account, then try again. No transaction was requested.",
      "Waiting for your wallet. Unlock it and review the connection request in its window.",
    );
  }
  async function connect(initialize = false) {
    if (!config || !wallet || !account) return;
    await action(async () => {
      const selected = accounts.find((a) => a.address === account);
      if (!selected) return;
      try {
        const connected = await connectZkapi(
          config,
          wallet,
          selected,
          initialize,
          invitation || undefined,
        );
        setInvitation("");
        onConnect(connected, selected.address);
        setStorageMissing(false);
        setInfo("Deployment and wallet connection verified.");
      } catch (e) {
        if (e instanceof BrowserStorageMissing) {
          setStorageMissing(true);
          setInfo(
            "No storage exists for this account yet. Create it explicitly to continue.",
          );
        } else {
          throw e;
        }
      }
    });
  }
  const disabled = busy || locked || configLoading || !!status?.busy;
  return (
    <div className="connection-panel" aria-busy={busy || configLoading}>
      <div className="connection-intro">
        <div className="section-icon">
          <Wallet size={22} />
        </div>
        <div>
          <h3>Chat with AI using your wallet.</h3>
          <p>
            Pay usage charges with USDC on Solana. Network fees require SOL.
          </p>
        </div>
      </div>
      <div className="connection-facts">
        <span>
          <span className="status-dot" />
          Solana Devnet
        </span>
        <span>
          SDK {SDK_VERSION} ·{" "}
          {RECOVERY_RUNTIME ? "original wallet recovery" : "preview artifact"}
        </span>
      </div>
      {RECOVERY_RUNTIME ? (
        <p className="small muted">
          Original wallet recovery keeps SDK .3, its profile and saved deposits.
          Keep this browser's data until all recovery and withdrawals are
          complete.
        </p>
      ) : (
        !handle && (
          <p className="small muted">
            Existing deposits from SDK .3 use the original recovery app.{" "}
            {import.meta.env.DEV ? (
              <>
                For local recovery, stop this server and run{" "}
                <code>npm run dev:recovery</code>, then reopen the same URL.
              </>
            ) : (
              <a href={`${import.meta.env.BASE_URL}recovery-v3/`}>
                Open original wallet recovery
              </a>
            )}
          </p>
        )
      )}
      {!config ? (
        <div className="setup-needed">
          <CircleHelp size={22} />
          <div>
            <h4>
              {configLoading
                ? "Verifying public deployment assets…"
                : configError
                  ? "Connection settings are unavailable"
                  : "An operator configuration is required"}
            </h4>
            <p>
              {configLoading
                ? "Downloading and checking the published proof bundle. This can take a moment on the first visit."
                : configError ||
                  "The SDK alone does not select an operator or include its proof assets. The app administrator must install a reviewed deployment configuration before you can connect a wallet."}
            </p>
            <a
              href="https://github.com/yukikm/solana-zkapi/blob/main/docs/sdk/public-devnet-preview.md"
              target="_blank"
              rel="noreferrer"
            >
              Read the public documentation <ExternalLink size={13} />
            </a>
            {!configLoading && (
              <button className="secondary" onClick={onRetryConfig}>
                Retry configuration
              </button>
            )}
          </div>
        </div>
      ) : (
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
              This ZKAPI deployment enables{" "}
              {configuredModels(config)
                .map((model) => model.label || model.id)
                .join(", ")}
              . Model availability is set by the deployment operator.
            </p>
            {configuredMode(config) === "direct_openrouter" && (
              <p className="small muted">
                OpenRouter supports models from multiple providers. Additional
                models must be enabled in the ZKAPI public profile before they
                can be selected here.
              </p>
            )}
          </details>
          {config.schema === 2 && !handle && (
            <div className="notice">
              <strong>Public Devnet connection</strong>
              <p>
                Check the live service before connecting your wallet. This check
                needs no funds or signatures.
              </p>
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
                Check public connection
              </button>
              {publicCheck && (
                <p role="status">
                  {publicCheck.preflight.checks.length} SDK checks passed.{" "}
                  {publicCheck.readiness.admission === "enabled" &&
                  publicCheck.readiness.servicesAvailable &&
                  publicCheck.preflight.chainAllowsNewOperations
                    ? "New requests enabled."
                    : "New requests unavailable."}{" "}
                  {publicCheck.readiness.invitationRequired
                    ? "Invitation required."
                    : "No invitation required."}{" "}
                  Provider credit is checked when you send. Checks run again
                  before new work. Last checked:{" "}
                  {new Date(
                    publicCheck.readiness.checkedAt,
                  ).toLocaleTimeString()}
                  .
                </p>
              )}
            </div>
          )}
          {!handle ? (
            <>
              {config.schema === 2 && (
                <details className="notice">
                  <summary>Invitation for restricted deployments</summary>
                  <div className="field">
                    <label htmlFor="admission-invitation">
                      Invitation (only if required)
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
                      Leave empty for the current public Devnet. Used only if
                      the operator requires it; kept in memory for this
                      connection.
                    </small>
                  </div>
                </details>
              )}
              <h4 className="field-heading">1. Select a wallet</h4>
              {wallets.length ? (
                <div className="wallet-list">
                  {wallets.map((w, i) => (
                    <button
                      key={`${w.name}-${i}`}
                      className={`wallet-choice ${wallet === w ? "selected" : ""}`}
                      disabled={disabled}
                      onClick={() => void pickWallet(w)}
                    >
                      <Wallet size={18} />
                      <span>{w.name}</span>
                      {wallet === w && <Check size={16} />}
                    </button>
                  ))}
                </div>
              ) : (
                <p className="notice">
                  No supported wallet was found. Enable a Wallet Standard wallet
                  such as{" "}
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
                  . Newly available wallets appear here automatically.
                </p>
              )}
              {accounts.length > 0 && (
                <div className="field">
                  <label htmlFor="wallet-account">2. Select an account</label>
                  <select
                    id="wallet-account"
                    value={account}
                    onChange={(e) => {
                      setAccount(e.target.value);
                      setStorageMissing(false);
                    }}
                    disabled={disabled}
                  >
                    <option value="">Select account</option>
                    {accounts.map((a) => (
                      <option key={a.address} value={a.address}>
                        {a.address}
                      </option>
                    ))}
                  </select>
                </div>
              )}
              {!storageMissing && (
                <button
                  className="primary full"
                  disabled={disabled || !account}
                  onClick={() => void connect()}
                >
                  {busy && <LoaderCircle className="spin" size={16} />}
                  Verify connection
                </button>
              )}
              {storageMissing && (
                <div className="notice">
                  <p>
                    Private credits are managed in encrypted storage in this
                    browser. Deleting browser data may make them unrecoverable.
                  </p>
                  <button
                    className="primary"
                    disabled={disabled}
                    onClick={() => void connect(true)}
                  >
                    Create storage for this wallet
                  </button>
                </div>
              )}
            </>
          ) : (
            <>
              {handle.invalidated && (
                <p className="error-message" role="alert">
                  The wallet account changed or disconnected. Disconnect here
                  and reconnect with the same account. Saved operations are
                  retained.
                </p>
              )}
              <div className="balance-panel">
                <div>
                  <span className="eyebrow">Funded note balance</span>
                  <p>
                    <strong>{formatUsdc(fundedNoteBalance(status))}</strong>{" "}
                    USDC
                  </p>
                  <small>
                    Authorization cap{" "}
                    {formatUsdc(status?.authorizationCapMicroUsdc)} USDC /
                    request
                  </small>
                </div>
                <ShieldCheck size={28} />
              </div>
              <p className="small muted">
                {status?.wallet === "closed"
                  ? "Withdrawal complete. This note no longer holds funds."
                  : status?.wallet === "unfunded" || status?.wallet === "empty"
                    ? "No confirmed deposit yet. Preparing a deposit does not fund the note."
                    : reusableSession(status)
                      ? "Ready to send using this session. Charges are deducted after it closes and settlement is verified."
                      : status?.session
                        ? "A session is pending settlement. The displayed balance may not be available to spend."
                        : status?.canRequest
                          ? "Ready to send. Each request charge is confirmed after settlement."
                          : "Not ready to send. Check funding, pending operations, and expiry."}
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
                          setInfo(
                            "Deposit selected. Balance and saved operations have been refreshed.",
                          );
                        },
                        "The deposit could not be opened. Your current deposit and all saved records are retained.",
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
                  Each deposit has its own balance. Select one to use or
                  withdraw it; balances are not combined. Previous funds and
                  history stay saved.
                </p>
                {hasLowBalance(status) && (
                  <p className="notice" role="status">
                    This deposit is below the{" "}
                    {formatUsdc(status?.authorizationCapMicroUsdc)} USDC needed
                    to authorize a request. Add a new deposit or select another
                    funded deposit to continue. You can still withdraw this
                    balance.
                  </p>
                )}
                {status?.wallet === "closed" && (
                  <p className="small muted">
                    Withdrawal complete. Add a new deposit to chat again with
                    this wallet.
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
                          "New deposit selected. Enter an amount below, then prepare the deposit. No funds have moved.",
                        );
                      },
                      "A new deposit could not be opened. Your previous deposits are retained; reconnect to check the saved selection.",
                      "Opening a new deposit and retaining your previous balances…",
                    )
                  }
                >
                  <ArrowDownLeft size={16} />
                  Add deposit
                </button>
                {!canChangeDeposit(status) && (
                  <p className="small muted">
                    Complete the pending operation or settlement below before
                    adding or switching deposits.
                  </p>
                )}
                {(status?.wallet === "empty" ||
                  status?.wallet === "unfunded") &&
                  canChangeDeposit(status) && (
                    <p className="small muted">
                      Use the deposit form below to fund this deposit first.
                    </p>
                  )}
              </section>
              {status?.expiry && (
                <p className="notice" role="status">
                  {status.expiry.message}
                </p>
              )}
              {config.schema === 2 && (
                <div className="notice" role="status">
                  <strong>
                    {handle.publicAdmissionReady
                      ? "Last connection checks passed"
                      : "New funding and requests are blocked"}
                  </strong>
                  <p>
                    {handle.diagnostic?.preflight?.paused
                      ? "The authenticated deployment is paused."
                      : handle.diagnostic?.unavailableComponent
                        ? "A public readiness check is unavailable. Original-profile recovery remains available."
                        : handle.diagnostic?.readiness?.admission ===
                            "suspended"
                          ? "The operator has suspended new requests. Recovery and withdrawal keep their original state."
                          : handle.diagnostic?.readiness?.invitationRequired
                            ? "This operator requires an invitation for new work. Reconnect with the invitation; keep your existing browser data."
                            : "No invitation is required. Checks refresh before each deposit or send. Provider credit and successful AUTH are not established by these checks."}
                  </p>
                  <p>
                    Public profile binding is retained for recovery. Changing
                    profiles never migrates existing custody.
                  </p>
                </div>
              )}
              <div className="notice">
                <strong>
                  Browser storage:
                  {handle.persistence === "persistent"
                    ? "Persistence granted"
                    : "May be automatically deleted"}
                </strong>
                <p>
                  This storage is not a backup. While funds remain, keep browser
                  data and use the same URL and account.
                </p>
              </div>
              {(status?.wallet === "empty" ||
                status?.wallet === "unfunded") && (
                <div className="notice">
                  <strong>Fund your Devnet wallet</strong>
                  <p>
                    Get test USDC from{" "}
                    <a
                      href="https://faucet.circle.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Circle’s faucet
                    </a>{" "}
                    (USDC → Solana Devnet) and SOL for fees from the{" "}
                    <a
                      href="https://faucet.solana.com/"
                      target="_blank"
                      rel="noreferrer"
                    >
                      Solana faucet
                    </a>
                    .
                  </p>
                  <p className="small">
                    Send the faucet tokens to{" "}
                    <code>{handle.account.address}</code>. The verified USDC
                    mint is <code>{handle.deployment.mint}</code>.
                  </p>
                </div>
              )}
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
                        await handle.client.prepareDeposit(value);
                        setProgressState("");
                        setInfo(
                          "Deposit prepared. Request the wallet signature when ready.",
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
                      <small>
                        Deposit at least the authorization cap to chat. Keep SOL
                        available for fees.
                      </small>
                    </div>
                    <label className="check-label deposit-retention">
                      <input
                        type="checkbox"
                        checked={retentionAccepted}
                        onChange={(e) => setRetentionAccepted(e.target.checked)}
                      />
                      I understand the storage limitations
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
                      Prepare deposit
                    </button>
                  </form>
                )}
              {status?.walletOperation && (
                <div className="pending-card">
                  <h4>Continue wallet operation</h4>
                  <p>
                    <code>
                      {status.walletOperation.kind} /{" "}
                      {status.walletOperation.phase}
                    </code>
                  </p>
                  <p className="small">
                    {status.walletOperation.signature
                      ? "A signed transaction is saved. Check its confirmation before continuing. This normally needs no signature; an expired proof upload can require a renewed signature."
                      : "The next step can open your wallet for a signature. Each transaction has its own network fee."}
                  </p>
                  {["mutual_close", "initiate_escape"].includes(
                    status.walletOperation.kind,
                  ) && (
                    <p className="small">
                      Withdrawal uses multiple approvals: create a proof buffer
                      → upload proof chunks → seal → execute withdrawal. The SDK
                      does not expose the current step or remaining approval
                      count. An upload confirmation does not mean withdrawal is
                      complete.
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
                          const p = await handle.client.advanceWallet();
                          setProgressState(p.state);
                          setInfo(`Operation status: ${p.state}`);
                        })
                      }
                    >
                      {status.walletOperation.signature
                        ? "Check submitted transaction"
                        : "Continue to wallet signature"}
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
                              "Proof resumed. Continue to the next step.",
                            );
                          })
                        }
                      >
                        Resume proof
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
                        Prepare rejected operation again
                      </button>
                    )}
                  </div>
                  {progressState === "expired_reconcile_required" &&
                    status.walletOperation.phase === "ready" &&
                    status.walletOperation.signature && (
                      <details className="notice">
                        <summary>Expired setup recovery</summary>
                        <p>
                          Only an expired buffer-creation transaction can use
                          this check. The SDK verifies finalized history and
                          buffer absence. An unknown financial transaction stays
                          pending.
                        </p>
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() =>
                            void action(
                              () => handle.client.recoverExpiredWalletSetup(),
                              "Setup recovery is not available for this operation or its history is still unresolved. Keep the saved transaction and use Check status.",
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
                          If mutual close is unavailable, prepare a
                          challengeable exit to the saved destination. It
                          requires an on-chain waiting period. The SDK refuses
                          this switch if a withdrawal was already signed.
                        </p>
                        <button
                          className="secondary"
                          disabled={disabled}
                          onClick={() =>
                            void action(
                              () => handle.client.fallbackToEscape(),
                              "This withdrawal cannot switch to an escape. Continue checking the original saved operation.",
                            )
                          }
                        >
                          Switch unsigned withdrawal to escape
                        </button>
                      </details>
                    )}
                </div>
              )}
              {status?.session && (
                <div className="pending-card">
                  <h4>
                    {reusableSession(status)
                      ? "Reusable session"
                      : "Pending session"}
                  </h4>
                  <p className="small">
                    {reusableSession(status)
                      ? "This session can serve another request. Close and settle it before switching deposits or withdrawing. Requests within this session may be linked."
                      : "Complete recovery or settlement before the next request. Recovery does not replay AI requests."}
                  </p>
                  <code>{status.session.phase}</code>
                  <div className="button-row">
                    {reusableSession(status) && (
                      <button
                        className="primary"
                        disabled={disabled}
                        onClick={() =>
                          void action(async () => {
                            await handle.client.settle();
                            setInfo(
                              "Session close requested. Check the updated settlement status.",
                            );
                          })
                        }
                      >
                        Close session / Settle
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
                                "Unsent authorization cancelled. No AI request was replayed.",
                              );
                            })
                          }
                        >
                          Cancel unsent authorization
                        </button>
                      )}
                    <button
                      className="primary"
                      disabled={disabled}
                      onClick={() =>
                        void action(async () => {
                          await handle.client.recover();
                          setInfo(
                            "Recovery check completed. Check the updated status.",
                          );
                        })
                      }
                    >
                      <RefreshCw size={15} />
                      Check settlement / Recover
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
                                "Unaccepted send reconciled. No AI request was replayed.",
                              );
                            })
                          }
                        >
                          Reconcile unaccepted send
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
                        Reconcile unaccepted authorization
                      </button>
                    )}
                  </div>
                </div>
              )}
              {status?.wallet === "pending_escape" && (
                <div className="pending-card">
                  <h4>Withdrawal waiting period</h4>
                  <p>
                    After the on-chain deadline, you can prepare withdrawal
                    finalization.
                  </p>
                  <button
                    className="secondary"
                    disabled={disabled}
                    onClick={() =>
                      void action(() => handle.client.prepareFinalizeEscape())
                    }
                  >
                    Prepare withdrawal finalization
                  </button>
                </div>
              )}
              {(status?.canPrepareEmergencyEscape ||
                status?.canReconcileChallengedEscape) && (
                <details className="notice">
                  <summary>Emergency withdrawal and challenge recovery</summary>
                  <p>
                    Preserves the pending session and starts a challengeable
                    exit to the connected wallet. It does not settle the AI
                    request. Continue the saved wallet steps and wait for the
                    on-chain deadline.
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
                      Prepare emergency withdrawal to this wallet
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
                      Check challenged withdrawal
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
                        <p>
                          Prepare withdrawal to the connected wallet. This note
                          will close after withdrawal.
                        </p>
                        <p>
                          Expect multiple wallet approvals and network fees:
                          create a proof buffer, upload proof chunks, seal them,
                          then execute the withdrawal. Only the final
                          transaction returns your USDC. The number of uploads
                          depends on proof size.
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
                                  "Withdrawal prepared. Each step may require a separate wallet signature.",
                                );
                              })
                            }
                          >
                            Prepare withdrawal to this wallet
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
                <button
                  className="text-button"
                  disabled={disabled}
                  onClick={() => {
                    setInvitation("");
                    onDisconnect();
                  }}
                >
                  <Unplug size={14} />
                  Disconnect
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
      {error.includes("chain connection") && (
        <p className="notice">
          App origin: <code>{location.origin}</code>. The public Devnet supports
          localhost and HTTPS apps with credential-free requests. Retry the
          connection check before funding. A chain snapshot error is separate
          from browser access.
        </p>
      )}
      <div className="privacy-note">
        <ShieldCheck size={17} />
        <p>
          Prompts are sent to the AI provider. In proxy mode, the operator can
          also read them. ZK proofs do not guarantee response accuracy or
          network anonymity.
        </p>
      </div>
    </div>
  );
}
