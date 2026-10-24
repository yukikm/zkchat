import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { version as APP_VERSION } from "../package.json";
import {
  ArrowDown,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Feather,
  Lightbulb,
  Menu,
  MessageCircle,
  MoreHorizontal,
  PanelLeftClose,
  Plus,
  Search,
  Settings2,
  ShieldCheck,
  Square,
  Trash2,
  Wallet,
  Pencil,
  RefreshCw,
  FlaskConical,
  CircleHelp,
} from "lucide-react";
import type { ClientStatus } from "@zkapi/solana-sdk";
import { readChatResponse } from "./lib/chatResponse";
import { useAppUpdate } from "./lib/appUpdate";
import { useWalletObservation } from "./lib/walletObservation";
import {
  SDK_VERSION,
  LOCAL_RECOVERY_PREVIEW,
  SDK_SOURCE_URL,
  RECOVERY_RUNTIME,
  RETIRED_RUNTIME,
} from "./lib/sdkVersion";
import { chatFailureMessage, reusableSession } from "./lib/sdkStatus";
import {
  loadConfig,
  configuredModels,
  configuredStreaming,
  watchWallets,
  type AppConfig,
  type BrowserClientHandle,
} from "./lib/zkapi";
import {
  contextMessages,
  conversationMarkdown,
  demoAnswer,
  formatUsdc,
  fundedNoteBalance,
  HISTORY_KEY,
  MAX_CHATS,
  MAX_INPUT,
  MIN_OUTPUT_TOKENS,
  MAX_OUTPUT_TOKENS,
  newConversation,
  parseHistory,
  parsePreferences,
  SETTINGS_KEY,
  streamDemo,
  titleFrom,
  type ChatMode,
  type Conversation,
  type Message,
  type Preferences,
} from "./lib/chat";
import {
  ConnectionPanel,
  type WalletConnection,
} from "./components/ConnectionPanel";
import { WalletIcon } from "./components/WalletPicker";
import { Markdown } from "./components/Markdown";
import { Modal } from "./components/Modal";
import {
  disconnectSelectedWallet,
  getConnectedWalletAccount,
} from "./lib/walletConnector";
import { PublicOnboardingError } from "./lib/publicDeployment";
import { canChangeDeposit, DepositError, hasLowBalance } from "./lib/deposits";
const suggestions = [
  {
    icon: Feather,
    title: "Polish your writing",
    detail: "Draft or improve a message.",
    prompt: "Help me write a clear and polite email.",
  },
  {
    icon: Code2,
    title: "Write code",
    detail: "Solve a coding problem.",
    prompt: "Write TypeScript code that removes duplicates from an array.",
  },
  {
    icon: Lightbulb,
    title: "Explore ideas",
    detail: "Brainstorm your next project.",
    prompt: "Help me brainstorm ideas for a new project.",
  },
  {
    icon: ShieldCheck,
    title: "Learn about ZKAPI",
    detail: "Understand wallet payments.",
    prompt: "Explain how Solana ZKAPI works for a beginner.",
  },
];
function readLocal(key: string) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}
function Brand({ small = false }: { small?: boolean }) {
  return (
    <span className={`brand-mark ${small ? "small" : ""}`} aria-hidden="true">
      <svg viewBox="0 0 32 32" fill="none">
        <path
          d="M9 10h14L9 22h14"
          stroke="currentColor"
          strokeWidth="2.4"
          strokeLinecap="round"
          strokeLinejoin="round"
        />
      </svg>
    </span>
  );
}
export default function App() {
  const updateAvailable = useAppUpdate();
  const [chats, setChats] = useState<Conversation[]>(() =>
    parseHistory(readLocal(HISTORY_KEY)),
  );
  const [activeId, setActiveId] = useState<string | null>(null);
  const [mode, setMode] = useState<ChatMode>("live");
  const [model, setModel] = useState("");
  const [draft, setDraft] = useState("");
  const [query, setQuery] = useState("");
  const [sidebar, setSidebar] = useState(false);
  const [dialog, setDialog] = useState<
    "connection" | "preferences" | "about" | "delete" | "rename" | null
  >(null);
  const [connectionRequest, setConnectionRequest] = useState<{
    id: number;
    intent: "manage" | "add" | "payment";
  }>({ id: 0, intent: "manage" });
  const [setupDismissed, setSetupDismissed] = useState(false);
  const [focusChatRequest, setFocusChatRequest] = useState(0);
  const [rename, setRename] = useState("");
  const [menu, setMenu] = useState(false);
  const [preferences, setPreferences] = useState<Preferences>(() =>
    parsePreferences(readLocal(SETTINGS_KEY)),
  );
  const [config, setConfig] = useState<AppConfig | null>(null);
  const [configLoading, setConfigLoading] = useState(true);
  const [configError, setConfigError] = useState("");
  const [handle, setHandle] = useState<BrowserClientHandle | null>(null);
  const [status, setStatus] = useState<ClientStatus | null>(null);
  const activeHandle = useRef(handle);
  activeHandle.current = handle;
  const statusRevision = useRef(0);
  // Conversation scope belongs to this live SDK instance, never to persisted
  // history or status.session.id (which identifies the SDK authorization).
  const [sessionOwner, setSessionOwner] = useState<{
    handle: BrowserClientHandle;
    noteId: string;
    conversationId: string;
  } | null>(null);
  const [walletConnection, setWalletConnection] =
    useState<WalletConnection | null>(null);
  const address = walletConnection?.account.address ?? "";
  const [sending, setSending] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [showScroll, setShowScroll] = useState(false);
  const updateOperationPending =
    sending ||
    connectionBusy ||
    configLoading ||
    (!!handle && !canChangeDeposit(status));
  const abortRef = useRef<AbortController | null>(null);
  const busyRef = useRef(false);
  const scrollRef = useRef<HTMLDivElement>(null);
  const textareaRef = useRef<HTMLTextAreaElement>(null);
  const nearBottom = useRef(true);
  const chatsRef = useRef(chats);
  chatsRef.current = chats;
  const current = chats.find((c) => c.id === activeId);
  const selectedMode = current?.mode ?? mode;
  const models = configuredModels(config).filter((m) =>
    m.apis.includes("chat"),
  );
  // Keep the original profile's first model as the default when an additional
  // catalog is installed. Existing conversations retain their selected model.
  const defaultModel = models[0]?.id || "";
  const selectedModel = current?.model || model || defaultModel;
  const selectedModelAvailable = models.some((m) => m.id === selectedModel);
  const unavailableSavedModel =
    selectedMode === "live" &&
    !!current &&
    !!config &&
    !configLoading &&
    !selectedModelAvailable;
  const streamingSupported = configuredStreaming(config, selectedModel);
  const useStreaming = preferences.stream && streamingSupported;
  const outputTokenLimit =
    RECOVERY_RUNTIME && config?.schema === 2 ? 128 : MAX_OUTPUT_TOKENS;
  const maxOutputTokens = Math.min(preferences.maxTokens, outputTokenLimit);
  const needsConversationSettlement =
    selectedMode === "live" &&
    reusableSession(status) &&
    !(
      sessionOwner?.handle === handle &&
      sessionOwner?.noteId === status?.noteId &&
      sessionOwner?.conversationId === current?.id
    );
  const liveChatReady =
    !!handle &&
    !handle.invalidated &&
    !RETIRED_RUNTIME &&
    !!status?.canRequest &&
    !status.busy &&
    !status.walletOperation &&
    (config?.schema !== 2 || handle.publicAdmissionReady) &&
    selectedModelAvailable &&
    !needsConversationSettlement;
  const showOnboarding =
    selectedMode === "live" &&
    !RETIRED_RUNTIME &&
    !current?.messages.length &&
    !setupDismissed;
  const canSend =
    !sending &&
    !connectionBusy &&
    online &&
    !!draft.trim() &&
    draft.length <= MAX_INPUT &&
    (selectedMode === "demo" || liveChatReady);
  const withdrawalPending =
    status?.wallet === "pending_escape" ||
    ["mutual_close", "initiate_escape", "finalize_escape"].includes(
      status?.walletOperation?.kind ?? "",
    );
  const connectionBlocker = handle?.invalidated
    ? {
        message: "Reconnect the wallet used for this deposit.",
        label: "Reconnect wallet",
        intent: "manage" as const,
      }
    : status?.walletOperation || status?.wallet === "pending_escape"
      ? {
          message: withdrawalPending
            ? "This deposit is being withdrawn and cannot pay for chats. Finish withdrawing, then use another saved deposit or add funds."
            : "Finish your saved transaction to continue chatting.",
          label: withdrawalPending
            ? "Continue withdrawal"
            : "Continue transaction",
          intent: "payment" as const,
        }
      : needsConversationSettlement
        ? {
            message:
              "Finish payment for your previous chat to send here. Your draft stays saved.",
            label: "Review payment",
            intent: "payment" as const,
          }
        : status?.session && !reusableSession(status)
          ? {
              message:
                "Resolve the previous payment before sending another message.",
              label: "Resolve payment",
              intent: "payment" as const,
            }
          : handle && config?.schema === 2 && !handle.publicAdmissionReady
            ? {
                message:
                  "Chat is temporarily unavailable. Your deposit stays saved.",
                label: "Retry connection",
                intent: "manage" as const,
              }
            : hasLowBalance(status)
              ? {
                  message: `At least ${formatUsdc(status?.authorizationCapMicroUsdc)} USDC is needed to chat.`,
                  label: "Add funds",
                  intent: "add" as const,
                }
              : !handle
                ? {
                    message:
                      "Connect your wallet and add test USDC to start chatting.",
                    label: "Continue setup",
                    intent: "manage" as const,
                  }
                : {
                    message:
                      "Complete your payment setup to continue chatting.",
                    label: "Continue setup",
                    intent: "manage" as const,
                  };
  const acceptStatus = useCallback(
    (next: ClientStatus) => {
      if (
        !handle ||
        activeHandle.current !== handle ||
        next.noteId !== handle.selectedDepositId
      )
        return;
      statusRevision.current++;
      setStatus(next);
    },
    [handle],
  );
  const refresh = useCallback(async () => {
    if (!handle || activeHandle.current !== handle || handle.invalidated)
      return;
    const revision = ++statusRevision.current;
    let next: ClientStatus;
    try {
      next = await handle.client.status();
    } catch (error) {
      if (activeHandle.current !== handle || handle.invalidated) return;
      throw error;
    }
    // A subscription or a newer read may already have supplied a newer state.
    if (revision === statusRevision.current) acceptStatus(next);
  }, [handle, acceptStatus]);
  const walletObservation = useWalletObservation({
    handle,
    status,
    onStatus: acceptStatus,
  });
  const retryConfig = async () => {
    setConfigLoading(true);
    setConfigError("");
    try {
      setConfig(await loadConfig());
    } catch {
      setConfigError(
        "Could not load the service. Open Wallet & balance and try Retry connection.",
      );
    } finally {
      setConfigLoading(false);
    }
  };
  useEffect(() => {
    let alive = true;
    loadConfig()
      .then((c) => {
        if (alive) setConfig(c);
      })
      .catch(() => {
        if (alive)
          setConfigError(
            "Could not load the service. Try Reload settings or use the demo.",
          );
      })
      .finally(() => {
        if (alive) setConfigLoading(false);
      });
    return () => {
      alive = false;
    };
  }, []);
  useEffect(() => {
    if (!handle) return;
    let alive = true;
    const off = handle.client.subscribe((next) => {
      if (alive) acceptStatus(next);
    });
    void refresh().catch(() => {
      if (alive && activeHandle.current === handle) {
        setToast("Open Wallet & balance to check your saved payment.");
      }
    });
    return () => {
      alive = false;
      off();
    };
  }, [handle, acceptStatus, refresh]);
  useEffect(() => {
    if (!walletConnection || handle) return;
    return watchWallets(() => {
      const active = getConnectedWalletAccount(walletConnection.wallet);
      if (active !== walletConnection.account) {
        setWalletConnection(null);
      }
    });
  }, [walletConnection, handle]);
  useEffect(() => {
    const timer = setTimeout(() => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(chats));
        setStorageError(false);
      } catch {
        setStorageError(true);
      }
    }, 250);
    return () => clearTimeout(timer);
  }, [chats]);
  useEffect(() => {
    try {
      localStorage.setItem(SETTINGS_KEY, JSON.stringify(preferences));
    } catch {
      /* Preference persistence is optional. */
    }
    document.documentElement.dataset.theme = preferences.theme;
  }, [preferences]);
  useEffect(() => {
    const update = () => setOnline(navigator.onLine);
    window.addEventListener("online", update);
    window.addEventListener("offline", update);
    return () => {
      window.removeEventListener("online", update);
      window.removeEventListener("offline", update);
    };
  }, []);
  useEffect(() => {
    if (!toast) return;
    const id = setTimeout(() => setToast(""), 3500);
    return () => clearTimeout(id);
  }, [toast]);
  useEffect(() => {
    const el = textareaRef.current;
    if (el) {
      el.style.height = "auto";
      el.style.height = `${Math.min(el.scrollHeight, 200)}px`;
    }
  }, [draft]);
  useEffect(() => {
    if (!focusChatRequest) return;
    const frame = requestAnimationFrame(() => textareaRef.current?.focus());
    return () => cancelAnimationFrame(frame);
  }, [focusChatRequest]);
  useEffect(() => {
    if (current?.messages.length && nearBottom.current)
      scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight });
  }, [current?.messages]);
  useEffect(() => {
    const save = () => {
      try {
        localStorage.setItem(HISTORY_KEY, JSON.stringify(chatsRef.current));
      } catch {
        /* Already reported by the persistence effect. */
      }
    };
    window.addEventListener("pagehide", save);
    return () => window.removeEventListener("pagehide", save);
  }, []);
  useEffect(() => {
    const warn = (e: BeforeUnloadEvent) => {
      if (busyRef.current) {
        e.preventDefault();
        e.returnValue = "";
      }
    };
    window.addEventListener("beforeunload", warn);
    return () => window.removeEventListener("beforeunload", warn);
  }, []);
  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (
        (e.metaKey || e.ctrlKey) &&
        e.shiftKey &&
        e.key.toLowerCase() === "o"
      ) {
        e.preventDefault();
        if (!busyRef.current && !RETIRED_RUNTIME) {
          setActiveId(null);
          setModel("");
          setDraft("");
          setSidebar(false);
        }
      }
      if (e.key === "Escape") {
        setSidebar(false);
        setMenu(false);
      }
    };
    window.addEventListener("keydown", handler);
    return () => window.removeEventListener("keydown", handler);
  }, []);
  function changeMode(next: ChatMode) {
    if (busyRef.current) return;
    setMode(next);
    setActiveId(null);
    setSidebar(false);
    setMenu(false);
    setDialog(null);
  }
  function openConnection(intent: "manage" | "add" | "payment" = "manage") {
    setConnectionRequest((previous) => ({ id: previous.id + 1, intent }));
    setDialog("connection");
    setSidebar(false);
  }
  function continueToChat() {
    setSetupDismissed(true);
    setDialog(null);
    setFocusChatRequest((previous) => previous + 1);
  }
  function newChat() {
    if (busyRef.current || RETIRED_RUNTIME) return;
    setMode(selectedMode);
    setActiveId(null);
    setModel("");
    setDraft("");
    setSidebar(false);
    setMenu(false);
    textareaRef.current?.focus();
  }
  function openChat(c: Conversation) {
    if (busyRef.current) return;
    setActiveId(c.id);
    setMode(c.mode);
    setModel(c.model);
    setDraft("");
    setSidebar(false);
    setMenu(false);
    nearBottom.current = true;
  }
  function updateChat(id: string, fn: (c: Conversation) => Conversation) {
    setChats((prev) => prev.map((c) => (c.id === id ? fn(c) : c)));
  }
  async function send(override?: string) {
    const input = (override ?? draft).trim();
    if (
      !input ||
      input.length > MAX_INPUT ||
      busyRef.current ||
      connectionBusy ||
      !online
    )
      return;
    if (selectedMode === "live" && RETIRED_RUNTIME) {
      setToast(
        "This Pool is retired. Return to the current app to start a new chat.",
      );
      return;
    }
    if (selectedMode === "live" && !selectedModelAvailable) {
      if (override !== undefined) setDraft(override);
      setToast(
        unavailableSavedModel
          ? "This chat’s model is no longer available. Start a new chat to use an available model. Your saved conversation is kept."
          : "Choose an available model after the service settings finish loading.",
      );
      return;
    }
    if (needsConversationSettlement) {
      if (override !== undefined) setDraft(override);
      openConnection("payment");
      return;
    }
    if (selectedMode === "live" && !liveChatReady) {
      if (override !== undefined) setDraft(override);
      openConnection(connectionBlocker.intent);
      return;
    }
    if ((current?.messages.length ?? 0) >= 998) {
      setToast("This conversation has reached its limit. Start a new chat.");
      return;
    }
    if (!current && chats.length >= MAX_CHATS) {
      setToast(
        "You can save up to 100 conversations. Delete an unused conversation to continue.",
      );
      return;
    }
    const conversation =
      current ??
      newConversation(
        selectedMode,
        selectedMode === "demo" ? "demo" : selectedModel,
      );
    const operationId = crypto.randomUUID();
    const now = Date.now();
    const user: Message = {
      id: crypto.randomUUID(),
      role: "user",
      content: input,
      state: "complete",
      operationId,
      createdAt: now,
    };
    const assistant: Message = {
      id: crypto.randomUUID(),
      role: "assistant",
      content: "",
      state: "streaming",
      operationId,
      createdAt: now,
    };
    const updated: Conversation = {
      ...conversation,
      title: conversation.messages.length
        ? conversation.title
        : titleFrom(input),
      updatedAt: now,
      messages: [...conversation.messages, user, assistant],
    };
    setChats((prev) =>
      current
        ? prev.map((c) => (c.id === conversation.id ? updated : c))
        : [updated, ...prev],
    );
    setActiveId(conversation.id);
    setDraft("");
    setSending(true);
    busyRef.current = true;
    nearBottom.current = true;
    setActivity(
      selectedMode === "demo"
        ? "Showing a sample…"
        : reusableSession(status)
          ? "Sending your message…"
          : "Proving you can pay…",
    );
    const controller = new AbortController();
    abortRef.current = controller;
    const delta = (value: string) =>
      updateChat(conversation.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistant.id ? { ...m, content: m.content + value } : m,
        ),
      }));
    let response: Response | undefined;
    let finishReason: Message["finishReason"];
    try {
      if (selectedMode === "demo") {
        await streamDemo(
          demoAnswer(input, conversation.messages),
          controller.signal,
          delta,
        );
      } else {
        setSessionOwner({
          handle: handle!,
          noteId: status!.noteId,
          conversationId: conversation.id,
        });
        response = await handle!.client.chat({
          operationId,
          sessionId: conversation.id,
          model: selectedModel,
          messages: [
            ...contextMessages(conversation.messages),
            { role: "user", content: input },
          ],
          maxOutputTokens,
          stream: useStreaming,
          signal: controller.signal,
        });
        setActivity("Receiving the response…");
        finishReason = await readChatResponse(response, {
          stream: useStreaming,
          signal: controller.signal,
          onDelta: delta,
        });
      }
      updateChat(conversation.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistant.id ? { ...m, state: "complete", finishReason } : m,
        ),
      }));
    } catch (error) {
      const stopped = controller.signal.aborted;
      updateChat(conversation.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistant.id
            ? {
                ...m,
                state: stopped ? "stopped" : "error",
                error: stopped
                  ? selectedMode === "demo"
                    ? "Display stopped."
                    : "Stopped. Charges may still apply. Review the payment before sending again."
                  : error instanceof PublicOnboardingError ||
                      error instanceof DepositError
                    ? error.message
                    : chatFailureMessage(
                        error,
                        response,
                        !RECOVERY_RUNTIME &&
                          status?.mode === "direct_openrouter",
                      ),
              }
            : m,
        ),
      }));
    } finally {
      if (response?.body && !response.body.locked && !response.bodyUsed)
        await response.body.cancel().catch(() => {});
      if (selectedMode === "live") {
        setActivity("Checking session status…");
        try {
          await refresh();
        } catch {
          setStatus(null);
          setToast(
            "Could not check payment. Open Wallet & balance to resolve it.",
          );
        }
      }
      setSending(false);
      busyRef.current = false;
      abortRef.current = null;
      setActivity("");
    }
  }
  function download() {
    if (!current) return;
    const url = URL.createObjectURL(
      new Blob([conversationMarkdown(current)], {
        type: "text/markdown;charset=utf-8",
      }),
    );
    const link = document.createElement("a");
    link.href = url;
    link.download = `zkchat-${current.id.slice(0, 8)}.md`;
    link.click();
    setTimeout(() => URL.revokeObjectURL(url), 1000);
    setMenu(false);
    setToast("Conversation exported");
  }
  async function copy(text: string) {
    try {
      await navigator.clipboard.writeText(text);
      setToast("Copied");
    } catch {
      setToast("Copy failed. Select the text and copy it manually.");
    }
  }
  async function disconnect() {
    if ((!handle && !walletConnection) || busyRef.current || connectionBusy)
      return;
    try {
      handle?.dispose();
    } catch {
      setToast(
        "An operation is in progress. Wait for it to finish before disconnecting.",
      );
      return;
    }
    setConnectionBusy(true);
    activeHandle.current = null;
    statusRevision.current++;
    setHandle(null);
    setStatus(null);
    setSessionOwner(null);
    setWalletConnection(null);
    setSetupDismissed(false);
    try {
      await disconnectSelectedWallet();
      setToast("Disconnected. Saved data is retained.");
    } catch {
      setToast(
        "App disconnected. Disconnect the extension from its wallet menu if needed.",
      );
    } finally {
      setConnectionBusy(false);
    }
  }
  const visibleChats = useMemo(
    () =>
      chats
        .filter(
          (c) =>
            !query ||
            `${c.title} ${c.messages.map((m) => m.content).join(" ")}`
              .toLowerCase()
              .includes(query.toLowerCase()),
        )
        .sort((a, b) => b.updatedAt - a.updatedAt),
    [chats, query],
  );
  return (
    <div className="app-shell">
      {sidebar && (
        <button
          className="sidebar-backdrop"
          aria-label="Close sidebar"
          onClick={() => setSidebar(false)}
        />
      )}
      <aside
        className={`sidebar ${sidebar ? "is-open" : ""}`}
        aria-label="Conversations"
      >
        <div className="brand-row">
          <button
            className="brand"
            onClick={newChat}
            disabled={sending || RETIRED_RUNTIME}
          >
            <Brand />
            <span>
              zkchat<span className="brand-dot">.</span>
            </span>
          </button>
          <button
            className="icon-button mobile-close"
            aria-label="Close sidebar"
            onClick={() => setSidebar(false)}
          >
            <PanelLeftClose size={18} />
          </button>
          <span className="preview-tag">PREVIEW</span>
        </div>
        <button
          className="new-chat"
          onClick={newChat}
          disabled={sending || RETIRED_RUNTIME}
        >
          <Plus size={18} />
          <span>New chat</span>
          <kbd>⌘ ⇧ O</kbd>
        </button>
        <div className="search-box">
          <Search size={16} />
          <input
            type="search"
            aria-label="Search chats"
            placeholder="Search chats"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </div>
        <div className="history">
          <p className="sidebar-label">Your chats</p>
          {visibleChats.length ? (
            <div className="history-list">
              {visibleChats.map((c) => (
                <button
                  key={c.id}
                  className={`history-item ${c.id === activeId ? "active" : ""}`}
                  disabled={sending}
                  onClick={() => openChat(c)}
                >
                  <MessageCircle size={15} />
                  <span>{c.title}</span>
                  {c.mode === "demo" && (
                    <FlaskConical size={12} aria-label="Demo" />
                  )}
                </button>
              ))}
            </div>
          ) : (
            <div className="history-empty">
              <MessageCircle size={23} strokeWidth={1.4} />
              <p>
                {query
                  ? "No matching conversations"
                  : "Start a conversation here."}
              </p>
              <span>
                {query
                  ? "Try a different search term."
                  : "Chat history is saved in this browser."}
              </span>
            </div>
          )}
        </div>
        <div className="sidebar-footer">
          <div className="wallet-summary">
            <div className="wallet-caption">
              <span>
                <Wallet size={14} />
                {status?.wallet === "pending_escape" ||
                (status?.walletOperation &&
                  status.walletOperation.kind !== "deposit")
                  ? "Withdrawing"
                  : "Deposit balance"}
              </span>
              <span className="network-label">
                <span className="status-dot" />
                DEVNET
              </span>
            </div>
            <div className="credit-line">
              <strong>{formatUsdc(fundedNoteBalance(status))}</strong>
              <span>USDC</span>
              {!RETIRED_RUNTIME &&
                handle &&
                (status?.wallet === "active" ||
                  status?.wallet === "closed") && (
                  <button
                    className="icon-button"
                    aria-label="Add funds"
                    onClick={() => openConnection("add")}
                  >
                    <Plus size={16} />
                  </button>
                )}
            </div>
            {(status?.wallet === "pending_escape" ||
              (status?.walletOperation &&
                status.walletOperation.kind !== "deposit")) && (
              <p>Last confirmed amount · unavailable for chats</p>
            )}
            <p>
              {walletConnection
                ? `${address.slice(0, 4)}…${address.slice(-4)}`
                : "Connect a wallet to get started"}
            </p>
          </div>
          <button
            className="sidebar-settings"
            onClick={() => setDialog("preferences")}
          >
            <Settings2 size={17} />
            Appearance and chat
          </button>
          <div className="sidebar-bottom">
            <span>Built on Solana</span>
            <button
              className="icon-button"
              aria-label="About zkchat"
              onClick={() => setDialog("about")}
            >
              <CircleHelp size={17} />
            </button>
          </div>
        </div>
      </aside>
      <main className="main-panel">
        <header className="topbar">
          <div className="topbar-left">
            <button
              className="icon-button mobile-menu"
              aria-label="Open menu"
              onClick={() => setSidebar(true)}
            >
              <Menu size={21} />
            </button>
            <div className="model-picker">
              <select
                aria-label="Select model"
                title="Models enabled by this ZKAPI deployment"
                value={selectedMode === "demo" ? "demo" : selectedModel}
                disabled={
                  sending ||
                  selectedMode === "demo" ||
                  !models.length ||
                  !!current?.messages.length
                }
                onChange={(e) => setModel(e.target.value)}
              >
                {selectedMode === "demo" ? (
                  <option value="demo">Demo assistant</option>
                ) : models.length ? (
                  <>
                    {unavailableSavedModel && (
                      <option value={selectedModel}>
                        {selectedModel} (unavailable)
                      </option>
                    )}
                    {models.map((m) => (
                      <option key={m.id} value={m.id}>
                        {m.label || m.id}
                      </option>
                    ))}
                  </>
                ) : (
                  <option value="">Select model</option>
                )}
              </select>
              <ChevronDown size={14} />
            </div>
            <span className="topbar-status">
              {selectedMode === "demo"
                ? "Demo"
                : handle
                  ? "ZKAPI"
                  : "Disconnected"}
            </span>
          </div>
          <div className="topbar-right">
            {current && (
              <div className="conversation-menu">
                <button
                  className="icon-button"
                  aria-label="Conversation actions"
                  aria-expanded={menu}
                  disabled={sending}
                  onClick={() => setMenu(!menu)}
                >
                  <MoreHorizontal size={20} />
                </button>
                {menu && (
                  <div className="dropdown">
                    <button
                      onClick={() => {
                        setRename(current.title);
                        setDialog("rename");
                        setMenu(false);
                      }}
                    >
                      <Pencil size={15} />
                      Rename
                    </button>
                    <button onClick={download}>
                      <Download size={15} />
                      Save as Markdown
                    </button>
                    <button
                      className="danger"
                      onClick={() => {
                        setDialog("delete");
                        setMenu(false);
                      }}
                    >
                      <Trash2 size={15} />
                      Delete conversation
                    </button>
                  </div>
                )}
              </div>
            )}
            <button
              className={`connect-button wallet-connect-button wallet-management-button ${walletConnection && !handle?.invalidated ? "connected" : ""}`}
              aria-label="Wallet & balance"
              title={
                walletConnection
                  ? `${handle?.invalidated ? "Wallet changed. Reconnect to continue. " : ""}${walletConnection.wallet.name}: ${address}`
                  : undefined
              }
              onClick={() => openConnection()}
            >
              {walletConnection ? (
                <WalletIcon wallet={walletConnection.wallet} />
              ) : (
                <Wallet size={16} />
              )}
              <span>Wallet &amp; balance</span>
              {walletConnection && !handle?.invalidated && (
                <span className="status-dot" />
              )}
              {walletConnection && <ChevronDown size={14} aria-hidden="true" />}
            </button>
          </div>
        </header>
        {RETIRED_RUNTIME && (
          <div className="settlement-banner" role="status">
            <span>
              This Pool is retired. Only existing deposits can be opened here.
              The old service is no longer connected. Recovery is currently
              unavailable.
            </span>
            <a href="../">Return to the current app</a>
          </div>
        )}
        {unavailableSavedModel && !RETIRED_RUNTIME && (
          <div className="settlement-banner" role="status">
            <span>
              This chat’s model is no longer available. Start a new chat to use
              an available model. Your saved conversation is kept.
            </span>
            <button disabled={sending || connectionBusy} onClick={newChat}>
              Start a new chat
            </button>
          </div>
        )}
        {updateAvailable && (
          <div className="settlement-banner" role="status">
            <span>
              {updateOperationPending
                ? "An update is ready. Finish the current payment or operation before reloading."
                : draft.length > 0
                  ? "An update is ready. Send or clear your draft before reloading."
                  : "An update is ready. Reload to use the latest fixes."}
            </span>
            <button
              disabled={updateOperationPending || draft.length > 0}
              onClick={() => window.location.reload()}
            >
              Reload app
            </button>
          </div>
        )}
        {!online && (
          <div className="top-notice error-message" role="alert">
            You’re offline. Reconnect to send. Your draft is saved.
          </div>
        )}
        {storageError && (
          <div className="top-notice error-message" role="alert">
            Chat history cannot be saved. Use Save as Markdown to keep a copy.
          </div>
        )}
        {selectedMode === "demo" && (
          <div className="demo-banner">
            <span>
              <FlaskConical size={14} />
              Demo · Sample replies, no AI or payments
            </span>
            <button disabled={sending} onClick={() => changeMode("live")}>
              Use AI chat <ArrowUp size={13} />
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          className={`conversation-scroll ${showOnboarding ? "onboarding-scroll" : !current?.messages.length ? "empty" : ""}`}
          onScroll={(e) => {
            if (!current?.messages.length) {
              nearBottom.current = true;
              setShowScroll(false);
              return;
            }
            const el = e.currentTarget;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            setShowScroll(!nearBottom.current);
          }}
        >
          <ConnectionPanel
            presentation={
              dialog === "connection"
                ? "dialog"
                : showOnboarding
                  ? "inline"
                  : "hidden"
            }
            request={connectionRequest}
            onClose={() => setDialog(null)}
            onContinueChat={continueToChat}
            onTryDemo={() => changeMode("demo")}
            chatReady={liveChatReady && online && !sending && !connectionBusy}
            needsConversationSettlement={needsConversationSettlement}
            onBusy={setConnectionBusy}
            walletConnection={walletConnection}
            onWalletConnect={setWalletConnection}
            config={config}
            configError={configError}
            configLoading={configLoading}
            onRetryConfig={() => void retryConfig()}
            handle={handle}
            status={status}
            walletObservation={walletObservation}
            locked={sending || connectionBusy}
            refresh={refresh}
            onConnect={(h) => {
              activeHandle.current = h;
              statusRevision.current++;
              setStatus(null);
              setHandle(h);
              setSessionOwner(null);
              setMode("live");
              if (current?.mode === "demo") setActiveId(null);
            }}
            onDisconnect={disconnect}
          />
          {!current?.messages.length ? (
            showOnboarding ? null : (
              <div className="welcome">
                <div className="welcome-logo">
                  <Brand />
                </div>
                <h1>Start a conversation.</h1>
                <p className="welcome-description">
                  {selectedMode === "demo"
                    ? "Try a sample chat. No wallet needed."
                    : handle
                      ? "Choose a prompt or type your message below."
                      : "Connect your wallet, add test USDC, then send a message."}
                </p>
                <div className="suggestions">
                  {suggestions.map(({ icon: Icon, title, detail, prompt }) => (
                    <button
                      key={title}
                      className="suggestion"
                      onClick={() => {
                        setDraft(prompt);
                        textareaRef.current?.focus();
                      }}
                    >
                      <Icon size={20} strokeWidth={1.5} />
                      <strong>{title}</strong>
                      <span>{detail}</span>
                      <ArrowUp size={14} className="suggestion-arrow" />
                    </button>
                  ))}
                </div>
              </div>
            )
          ) : (
            <div
              className="messages"
              aria-label="Conversation"
              aria-busy={sending}
            >
              {current.messages.map((message, i) => (
                <article key={message.id} className={`message ${message.role}`}>
                  <div className="message-avatar">
                    {message.role === "assistant" ? (
                      <Brand small />
                    ) : (
                      <span>Y</span>
                    )}
                  </div>
                  <div className="message-main">
                    <div className="message-byline">
                      <strong>
                        {message.role === "user" ? "You" : "zkchat"}
                      </strong>
                      {message.role === "assistant" && (
                        <span>
                          {current.mode === "demo"
                            ? "Demo"
                            : models.find((m) => m.id === current.model)
                                ?.label || current.model}
                        </span>
                      )}
                    </div>
                    {message.role === "user" ? (
                      <p className="user-text">{message.content}</p>
                    ) : (
                      <>
                        {message.content ? (
                          <Markdown text={message.content} />
                        ) : message.state === "streaming" ? (
                          <div className="thinking" role="status">
                            <span />
                            <span />
                            <span />
                            <p>{activity}</p>
                          </div>
                        ) : null}
                        {message.error && (
                          <div
                            className={`message-feedback ${message.state === "error" ? "error" : ""}`}
                            role={
                              message.state === "error" ? "alert" : "status"
                            }
                          >
                            {message.error}
                          </div>
                        )}
                        {message.finishReason === "length" && (
                          <div className="message-feedback" role="status">
                            Response reached the length limit. Ask to continue.
                          </div>
                        )}
                        {message.finishReason === "content_filter" && (
                          <div className="message-feedback" role="status">
                            The provider stopped this response because of its
                            content filter.
                          </div>
                        )}
                        {message.state !== "streaming" && (
                          <div className="message-actions">
                            {current.mode === "live" &&
                              (message.state === "error" ||
                                message.state === "stopped") &&
                              i === current.messages.length - 1 && (
                                <button
                                  className="text-button"
                                  disabled={sending || connectionBusy}
                                  onClick={() =>
                                    openConnection(
                                      status?.session
                                        ? "payment"
                                        : connectionBlocker.intent,
                                    )
                                  }
                                >
                                  <Wallet size={14} />
                                  {status?.session
                                    ? "Resolve payment"
                                    : status?.walletOperation
                                      ? "Continue transaction"
                                      : "Review connection"}
                                </button>
                              )}
                            {message.content && (
                              <button
                                className="icon-button"
                                aria-label="Copy response"
                                onClick={() => void copy(message.content)}
                              >
                                <Copy size={15} />
                              </button>
                            )}
                            {(message.state === "error" ||
                              message.state === "stopped") &&
                              i === current.messages.length - 1 && (
                                <button
                                  className="text-button"
                                  disabled={
                                    sending ||
                                    connectionBusy ||
                                    needsConversationSettlement ||
                                    (selectedMode === "live" &&
                                      (RETIRED_RUNTIME ||
                                        !selectedModelAvailable ||
                                        !status?.canRequest))
                                  }
                                  onClick={() =>
                                    void send(current.messages[i - 1]?.content)
                                  }
                                >
                                  <RefreshCw size={14} />
                                  Send again
                                </button>
                              )}
                            {message.state === "complete" &&
                              selectedMode === "live" && (
                                <span className="billing-note">
                                  {status?.lastSettlement?.operationIds.includes(
                                    message.operationId,
                                  )
                                    ? status.lastSettlement.operationIds
                                        .length > 1
                                      ? `Session settled · ${formatUsdc(status.lastSettlement.chargeMicroUsdc)} USDC total`
                                      : `Settled · ${formatUsdc(status.lastSettlement.chargeMicroUsdc)} USDC`
                                    : "Payment not yet verified"}
                                </span>
                              )}
                          </div>
                        )}
                      </>
                    )}
                  </div>
                </article>
              ))}
            </div>
          )}
        </div>
        <div
          className={`composer-area ${showOnboarding ? "setup-composer" : ""}`}
        >
          {selectedMode === "live" &&
            !showOnboarding &&
            !liveChatReady &&
            !sending &&
            !connectionBusy &&
            !RETIRED_RUNTIME &&
            !unavailableSavedModel &&
            online && (
              <div className="composer-notice" id="chat-blocker" role="status">
                <span>{connectionBlocker.message}</span>
                <button
                  onClick={() => openConnection(connectionBlocker.intent)}
                >
                  {connectionBlocker.label}
                </button>
              </div>
            )}
          {showScroll && (
            <button
              className="scroll-bottom icon-button"
              aria-label="Go to latest message"
              onClick={() => {
                nearBottom.current = true;
                scrollRef.current?.scrollTo({
                  top: scrollRef.current.scrollHeight,
                  behavior: "smooth",
                });
              }}
            >
              <ArrowDown size={18} />
            </button>
          )}
          <form
            className={`composer ${sending ? "is-busy" : ""}`}
            onSubmit={(e) => {
              e.preventDefault();
              void send();
            }}
          >
            <label htmlFor="message-input" className="sr-only">
              Message
            </label>
            <textarea
              ref={textareaRef}
              id="message-input"
              aria-label="Message"
              placeholder="What is on your mind?"
              value={draft}
              rows={1}
              maxLength={MAX_INPUT}
              onChange={(e) => setDraft(e.target.value)}
              onKeyDown={(e) => {
                if (
                  e.key === "Enter" &&
                  !e.shiftKey &&
                  !e.nativeEvent.isComposing &&
                  e.keyCode !== 229
                ) {
                  e.preventDefault();
                  void send();
                }
              }}
            />
            <div className="composer-bottom">
              <span className="composer-label">
                <ShieldCheck size={14} />
                {selectedMode === "demo" ? "Demo" : "Powered by ZKAPI"}
                {draft.length > 12000 && (
                  <span>
                    {draft.length.toLocaleString()} /{" "}
                    {MAX_INPUT.toLocaleString()}
                  </span>
                )}
              </span>
              <div className="composer-controls">
                <span className="keyboard-hint">
                  Shift + Enter for a new line
                </span>
                {sending ? (
                  <button
                    type="button"
                    className="send-button stop"
                    aria-label="Stop generation"
                    onClick={() => {
                      abortRef.current?.abort();
                      setActivity("Confirming stop…");
                    }}
                  >
                    <Square size={15} fill="currentColor" />
                  </button>
                ) : (
                  <button
                    type="submit"
                    className="send-button"
                    aria-label="Send message"
                    disabled={!canSend}
                    title={
                      RETIRED_RUNTIME
                        ? "This Pool is retired"
                        : unavailableSavedModel
                          ? "This model is unavailable. Start a new chat"
                          : needsConversationSettlement
                            ? "Settle the previous chat before sending here"
                            : selectedMode === "live" && !liveChatReady
                              ? connectionBlocker.message
                              : "Send message"
                    }
                  >
                    <ArrowUp size={20} />
                  </button>
                )}
              </div>
            </div>
          </form>
          <p className="composer-footnote">
            {selectedMode === "demo"
              ? "Sample replies. No usage charges."
              : "AI can make mistakes. Check important facts."}
            <button onClick={() => setDialog("about")}>Privacy</button>
          </p>
        </div>
        <footer className="main-footer">
          <span>
            <span className="status-dot" />
            SOLANA DEVNET
          </span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {dialog === "preferences" && (
        <Modal title="Appearance and chat" onClose={() => setDialog(null)}>
          <div className="field">
            <label htmlFor="theme">Theme</label>
            <select
              id="theme"
              value={preferences.theme}
              onChange={(e) =>
                setPreferences((p) => ({
                  ...p,
                  theme: e.target.value as Preferences["theme"],
                }))
              }
            >
              <option value="system">System</option>
              <option value="light">Light</option>
              <option value="dark">Dark</option>
            </select>
          </div>
          <div className="field">
            <label htmlFor="max-tokens">
              Response length (tokens){" "}
              <strong>{maxOutputTokens.toLocaleString()}</strong>
            </label>
            <input
              id="max-tokens"
              type="range"
              min={MIN_OUTPUT_TOKENS}
              max={outputTokenLimit}
              step={MIN_OUTPUT_TOKENS}
              value={maxOutputTokens}
              onChange={(e) =>
                setPreferences((p) => ({
                  ...p,
                  maxTokens: Number(e.target.value),
                }))
              }
            />
            <small>
              {RECOVERY_RUNTIME && config?.schema === 2
                ? "Limited to 128 tokens in this older recovery version."
                : "Longer replies can cost more."}
            </small>
          </div>
          <label className="toggle-row" htmlFor="stream">
            <div>
              <strong>Stream responses</strong>
              <span>Show text as it arrives</span>
            </div>
            <input
              id="stream"
              type="checkbox"
              role="switch"
              checked={useStreaming}
              disabled={!streamingSupported}
              onChange={(e) =>
                setPreferences((p) => ({ ...p, stream: e.target.checked }))
              }
            />
          </label>
          {!streamingSupported && (
            <p className="small muted">
              This model shows replies when complete.
            </p>
          )}
          <div className="preferences-mode">
            <strong>Chat mode</strong>
            <p className="small muted">Choose real AI or sample replies.</p>
            <div className="segmented">
              <button
                className={selectedMode === "live" ? "selected" : ""}
                disabled={sending}
                onClick={() => changeMode("live")}
              >
                AI chat
              </button>
              <button
                className={selectedMode === "demo" ? "selected" : ""}
                disabled={sending}
                onClick={() => changeMode("demo")}
              >
                Demo
              </button>
            </div>
          </div>
        </Modal>
      )}
      {dialog === "about" && (
        <Modal title="About zkchat" onClose={() => setDialog(null)}>
          <div className="about-brand">
            <Brand />
            <strong>
              zkchat<span>.</span>
            </strong>
          </div>
          <p>Chat with AI. Pay with USDC on Solana Devnet.</p>
          <div className="about-item">
            <h3>Saved on this browser</h3>
            <p>
              Chat history is not encrypted. Deleting a chat keeps your payment
              recovery data.
            </p>
          </div>
          <div className="about-item">
            <h3>Who sees your messages</h3>
            <p>
              Your messages go to the AI provider. A proxy operator can also
              read them.{" "}
              {RECOVERY_RUNTIME
                ? "Older payment records may also contain sent messages."
                : "OpenRouter requests require zero data retention. This does not prove deletion or hide your IP. Requests in one session may be linked."}
            </p>
          </div>
          <div className="about-item">
            <h3>Test network</h3>
            <p>Use test USDC and SOL only. Provider availability can change.</p>
          </div>
          <details className="connection-details">
            <summary>Payment data details</summary>
            <p>
              App {APP_VERSION} · SDK {SDK_VERSION}
              {LOCAL_RECOVERY_PREVIEW ? " (local recovery preview)" : ""}.
              Payment records are encrypted in this browser.{" "}
              {RECOVERY_RUNTIME
                ? "Older records can include sent messages."
                : "Sent message bodies are omitted from new SDK records. Request fingerprints and payment records remain."}{" "}
              Chat history, older records, and external backups are not
              automatically erased.
            </p>
          </details>
          <a
            className="source-link"
            href={SDK_SOURCE_URL}
            target="_blank"
            rel="noreferrer"
          >
            {LOCAL_RECOVERY_PREVIEW
              ? "Upstream source for local recovery preview"
              : `SDK release (${SDK_VERSION})`}{" "}
            <ExternalLink size={14} />
          </a>
        </Modal>
      )}
      {dialog === "rename" && current && (
        <Modal title="Rename conversation" onClose={() => setDialog(null)}>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (rename.trim()) {
                updateChat(current.id, (c) => ({
                  ...c,
                  title: rename.trim().slice(0, 100),
                }));
                setDialog(null);
              }
            }}
          >
            <div className="field">
              <label htmlFor="chat-title">Conversation name</label>
              <input
                id="chat-title"
                value={rename}
                autoComplete="off"
                onChange={(e) => setRename(e.target.value)}
                maxLength={100}
                autoFocus
              />
            </div>
            <button className="primary full" disabled={!rename.trim()}>
              Save
            </button>
          </form>
        </Modal>
      )}
      {dialog === "delete" && current && (
        <Modal
          title="Delete this conversation?"
          onClose={() => setDialog(null)}
        >
          <p>Remove “{current.title}” from chat history in this browser.</p>
          <p className="small muted">
            Your funds and payment recovery data stay saved.
          </p>
          <div className="button-row align-end">
            <button className="secondary" onClick={() => setDialog(null)}>
              Cancel
            </button>
            <button
              className="destructive"
              onClick={() => {
                setChats((prev) => prev.filter((c) => c.id !== current.id));
                setActiveId(null);
                setDialog(null);
                setToast("Conversation deleted");
              }}
            >
              Delete
            </button>
          </div>
        </Modal>
      )}
    </div>
  );
}
