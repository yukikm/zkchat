import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  ArrowDown,
  ArrowDownLeft,
  ArrowUp,
  Check,
  ChevronDown,
  Code2,
  Copy,
  Download,
  ExternalLink,
  Feather,
  Lightbulb,
  LoaderCircle,
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
import { readChatDeltas, readChatText } from "@zkapi/solana-sdk/chat";
import { SDK_VERSION, RECOVERY_RUNTIME } from "./lib/sdkVersion";
import { providerResponseError, reusableSession } from "./lib/sdkStatus";
import {
  loadConfig,
  configuredModels,
  configuredStreaming,
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
import { ConnectionPanel } from "./components/ConnectionPanel";
import { Markdown } from "./components/Markdown";
import { Modal } from "./components/Modal";
import { disconnectSelectedWallet } from "./lib/walletConnector";
import { PublicOnboardingError } from "./lib/publicDeployment";
import { DepositError, hasLowBalance } from "./lib/deposits";
const suggestions = [
  {
    icon: Feather,
    title: "Polish your writing",
    detail: "Find the right words together.",
    prompt: "Help me write a clear and polite email.",
  },
  {
    icon: Code2,
    title: "Write code",
    detail: "From a question to working code.",
    prompt: "Write TypeScript code that removes duplicates from an array.",
  },
  {
    icon: Lightbulb,
    title: "Explore ideas",
    detail: "Discover another possibility.",
    prompt: "Help me brainstorm ideas for a new project.",
  },
  {
    icon: ShieldCheck,
    title: "Understand how it works",
    detail: "An introduction to Solana and ZKAPI.",
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
  const [address, setAddress] = useState("");
  const [sending, setSending] = useState(false);
  const [connectionBusy, setConnectionBusy] = useState(false);
  const [activity, setActivity] = useState("");
  const [toast, setToast] = useState("");
  const [storageError, setStorageError] = useState(false);
  const [online, setOnline] = useState(navigator.onLine);
  const [showScroll, setShowScroll] = useState(false);
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
  const selectedModel = current?.model || model || models[0]?.id || "";
  const streamingSupported = configuredStreaming(config, selectedModel);
  const useStreaming = preferences.stream && streamingSupported;
  const maxOutputTokens =
    config?.schema === 2
      ? Math.min(preferences.maxTokens, 128)
      : preferences.maxTokens;
  const canSend =
    !sending &&
    !connectionBusy &&
    online &&
    !!draft.trim() &&
    draft.length <= MAX_INPUT &&
    (selectedMode === "demo" ||
      (!!handle && !!status?.canRequest && !!selectedModel));
  const refresh = useCallback(async () => {
    if (handle) setStatus(await handle.client.status());
  }, [handle]);
  const retryConfig = async () => {
    setConfigLoading(true);
    setConfigError("");
    try {
      setConfig(await loadConfig());
    } catch {
      setConfigError(
        "Public deployment settings could not be verified. Retry when the service is available.",
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
            "The configuration is invalid or unavailable. The operator should check the public URL, hash, and model configuration.",
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
    return handle.client.subscribe(setStatus);
  }, [handle]);
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
    if (nearBottom.current)
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
        if (!busyRef.current) {
          setActiveId(null);
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
  function newChat() {
    if (busyRef.current) return;
    setMode(selectedMode);
    setActiveId(null);
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
    if (
      selectedMode === "live" &&
      (!handle || !status?.canRequest || !selectedModel)
    ) {
      setDialog("connection");
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
        : "Checking proof and authorization…",
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
    try {
      if (selectedMode === "demo") {
        await streamDemo(
          demoAnswer(input, conversation.messages),
          controller.signal,
          delta,
        );
      } else {
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
        if (useStreaming) {
          for await (const chunk of readChatDeltas(response)) {
            controller.signal.throwIfAborted();
            delta(chunk);
          }
        } else {
          const text = await readChatText(response);
          controller.signal.throwIfAborted();
          delta(text);
        }
      }
      updateChat(conversation.id, (c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.id === assistant.id ? { ...m, state: "complete" } : m,
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
                    : "Display stopped. Charges may still apply. Check the pending settlement."
                  : error instanceof PublicOnboardingError ||
                      error instanceof DepositError
                    ? error.message
                    : ((!RECOVERY_RUNTIME &&
                      status?.mode === "direct_openrouter"
                        ? providerResponseError(response)
                        : undefined) ??
                      "The response could not be completed. Check pending operations in Connection settings. Requests are not retried automatically."),
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
            "Settlement could not be verified. Check the status in Connection settings.",
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
  function disconnect() {
    if (!handle || busyRef.current) return;
    try {
      handle.dispose();
      setHandle(null);
      setStatus(null);
      setAddress("");
      void disconnectSelectedWallet().catch(() =>
        setToast(
          "App disconnected. Disconnect the extension from its wallet menu if needed.",
        ),
      );
      setToast("Disconnected. Saved data is retained.");
    } catch {
      setToast(
        "An operation is in progress. Wait for it to finish before disconnecting.",
      );
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
          <button className="brand" onClick={newChat} disabled={sending}>
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
        <button className="new-chat" onClick={newChat} disabled={sending}>
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
                Credits
              </span>
              <span className="network-label">
                <span className="status-dot" />
                DEVNET
              </span>
            </div>
            <div className="credit-line">
              <strong>{formatUsdc(fundedNoteBalance(status))}</strong>
              <span>USDC</span>
              <button
                className="icon-button"
                aria-label="Deposit and manage credits"
                onClick={() => setDialog("connection")}
              >
                <Plus size={16} />
              </button>
            </div>
            <p>
              {handle
                ? `${address.slice(0, 5)}…${address.slice(-5)}`
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
                  models.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.label || m.id}
                    </option>
                  ))
                ) : (
                  <option value="">Select model</option>
                )}
              </select>
              <ChevronDown size={14} />
            </div>
            <span className="topbar-status">
              {selectedMode === "demo"
                ? "Interactive demo"
                : handle
                  ? "ZKAPI"
                  : "Disconnected"}
            </span>
          </div>
          <div className="topbar-right">
            <button
              className="connect-button deposit-button"
              onClick={() => setDialog("connection")}
              disabled={sending || connectionBusy}
            >
              <ArrowDownLeft size={16} />
              <span>Deposit</span>
            </button>
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
              className={`connect-button ${handle ? "connected" : ""}`}
              aria-label={handle ? "Connected" : "Connection settings"}
              onClick={() => setDialog("connection")}
            >
              <Wallet size={16} />
              <span>{handle ? "Connected" : "Connection settings"}</span>
              {handle && <span className="status-dot" />}
            </button>
          </div>
        </header>
        {!online && (
          <div className="top-notice error-message" role="alert">
            You are offline. Check your connection. Your draft is retained.
          </div>
        )}
        {storageError && (
          <div className="top-notice error-message" role="alert">
            Conversations cannot be saved in this browser. Export any needed
            conversations as Markdown.
          </div>
        )}
        {selectedMode === "demo" && (
          <div className="demo-banner">
            <span>
              <FlaskConical size={14} />
              Interactive demo · Not connected to AI or Solana
            </span>
            <button disabled={sending} onClick={() => changeMode("live")}>
              Return to live mode <ArrowUp size={13} />
            </button>
          </div>
        )}
        {selectedMode === "live" && status?.session && (
          <div className="settlement-banner">
            <span>
              <RefreshCw size={14} />
              {reusableSession(status)
                ? "Session ready for reuse · charges settle when closed"
                : "Settlement needs attention"}
            </span>
            <button onClick={() => setDialog("connection")}>
              {reusableSession(status) ? "Manage session" : "Check recovery"}
            </button>
          </div>
        )}
        {selectedMode === "live" && hasLowBalance(status) && (
          <div className="settlement-banner">
            <span>Low balance · Add a deposit to continue chatting</span>
            <button
              disabled={sending || connectionBusy}
              onClick={() => setDialog("connection")}
            >
              Add funds
            </button>
          </div>
        )}
        <div
          ref={scrollRef}
          className={`conversation-scroll ${!current?.messages.length ? "empty" : ""}`}
          onScroll={(e) => {
            const el = e.currentTarget;
            nearBottom.current =
              el.scrollHeight - el.scrollTop - el.clientHeight < 100;
            setShowScroll(!nearBottom.current);
          }}
        >
          {!current?.messages.length ? (
            <div className="welcome">
              <div className="welcome-eyebrow">
                <span className="tiny-line" /> A LITTLE CURIOSITY GOES A LONG
                WAY
              </div>
              <div className="welcome-logo">
                <Brand />
              </div>
              <h1>
                Start with an idea.
                <br className="mobile-break" />
                Make it a conversation.
              </h1>
              <p className="welcome-description">
                Write, build, and explore.
                <br className="mobile-break" />
                Take your next step here.
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
              <div className="welcome-connection">
                {configLoading ? (
                  <span className="inline-status">
                    <LoaderCircle size={14} className="spin" />
                    Loading connection settings
                  </span>
                ) : selectedMode === "demo" ? (
                  <span>
                    <FlaskConical size={14} />
                    Explore the chat using sample responses
                  </span>
                ) : handle ? (
                  <span>
                    <Check size={14} />
                    {status?.canRequest
                      ? "Ready. Send your first message."
                      : "Prepare credits in Connection settings."}
                  </span>
                ) : (
                  <>
                    <span>
                      <ShieldCheck size={15} />
                      {config
                        ? "Connect your wallet to chat with ZKAPI."
                        : "Live mode requires an operator configuration."}
                    </span>
                    <button onClick={() => changeMode("demo")}>
                      Try the demo <ArrowUp size={13} />
                    </button>
                  </>
                )}
              </div>
            </div>
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
                            ? "Interactive demo"
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
                        {message.state !== "streaming" && (
                          <div className="message-actions">
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
                                    (selectedMode === "live" &&
                                      !status?.canRequest)
                                  }
                                  onClick={() =>
                                    void send(current.messages[i - 1]?.content)
                                  }
                                >
                                  <RefreshCw size={14} />
                                  Retry as a new request
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
                                    : "Check settlement in Connection settings"}
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
        <div className="composer-area">
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
                {selectedMode === "demo"
                  ? "Interactive demo"
                  : "Powered by ZKAPI"}
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
                      selectedMode === "live" && !status?.canRequest
                        ? "Prepare to send in Connection settings"
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
              ? "Demo responses are samples. No usage charges apply."
              : "AI responses can be inaccurate. Verify important information."}
            <button onClick={() => setDialog("about")}>Privacy</button>
          </p>
        </div>
        <footer className="main-footer">
          <span>
            <span className="status-dot" />
            SOLANA DEVNET
          </span>
          <span>YOUR IDEAS. YOUR CONVERSATIONS.</span>
        </footer>
      </main>
      {toast && (
        <div className="toast" role="status">
          <Check size={16} />
          {toast}
        </div>
      )}
      {dialog === "connection" && (
        <Modal
          title="Connection settings"
          onClose={() => {
            if (connectionBusy)
              setToast(
                "An operation is in progress. Wait for it to finish or cancel it in your wallet.",
              );
            else setDialog(null);
          }}
          wide
        >
          <ConnectionPanel
            onBusy={setConnectionBusy}
            config={config}
            configError={configError}
            configLoading={configLoading}
            onRetryConfig={() => void retryConfig()}
            handle={handle}
            status={status}
            locked={sending}
            refresh={refresh}
            onConnect={(h, addr) => {
              setHandle(h);
              setAddress(addr);
              setMode("live");
              setActiveId(null);
              void h.client
                .status()
                .then(setStatus)
                .catch(() => {
                  setStatus(null);
                  setToast(
                    "Status is unavailable. Refresh it in Connection settings.",
                  );
                });
            }}
            onDisconnect={disconnect}
          />
          {!handle && (
            <div className="modal-demo">
              <span>Explore the interface first</span>
              <button
                className="secondary"
                onClick={() => changeMode("demo")}
                disabled={sending || connectionBusy}
              >
                <FlaskConical size={15} />
                Try the demo
              </button>
            </div>
          )}
        </Modal>
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
              Maximum response tokens{" "}
              <strong>{maxOutputTokens.toLocaleString()}</strong>
            </label>
            <input
              id="max-tokens"
              type="range"
              min="128"
              max={config?.schema === 2 ? "128" : "4096"}
              step="128"
              value={maxOutputTokens}
              onChange={(e) =>
                setPreferences((p) => ({
                  ...p,
                  maxTokens: Number(e.target.value),
                }))
              }
            />
            <small>
              {config?.schema === 2
                ? "This public Devnet preview limits each response to 128 output tokens."
                : "Higher limits allow longer responses and affect usage charges and authorization limits."}
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
          <p className="small muted">
            {!streamingSupported
              ? "Streaming is unavailable in the authenticated profile for this model. Responses use JSON."
              : "Streaming support depends on the configured provider."}
          </p>
          <div className="preferences-mode">
            <strong>Connection mode</strong>
            <p className="small muted">
              Demo and live conversations are saved separately.
            </p>
            <div className="segmented">
              <button
                className={selectedMode === "live" ? "selected" : ""}
                disabled={sending}
                onClick={() => changeMode("live")}
              >
                ZKAPI live mode
              </button>
              <button
                className={selectedMode === "demo" ? "selected" : ""}
                disabled={sending}
                onClick={() => changeMode("demo")}
              >
                Interactive demo
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
          <p>
            An independent text chat application built with the public Solana
            zkAPI SDK. The upstream SDK is used without modification.
          </p>
          <div className="about-item">
            <h3>Conversations stay in this browser</h3>
            <p>
              Chat history is stored as plain text in localStorage. Take care on
              shared devices. Deleting a conversation does not delete encrypted
              wallet transaction records.
            </p>
          </div>
          <div className="about-item">
            <h3>Where prompts are sent</h3>
            <p>
              Live requests go to the AI provider. In proxy mode, the operator
              can also read their content.{" "}
              {RECOVERY_RUNTIME
                ? "Sent conversations may remain in the original encrypted recovery journal."
                : "Direct OpenRouter requests require zero data retention and denied data collection. The SDK omits sent request bodies from its journal, while fingerprints and financial recovery records remain. This does not verify provider deletion or hide your IP address. Requests within a reused session may be linked."}
            </p>
          </div>
          <div className="about-item">
            <h3>Development preview</h3>
            <p>
              This app uses the pinned SDK {SDK_VERSION} preview artifact. Real
              use requires an independently authenticated public profile and a
              complete proof bundle. Operator selection comes from the app's
              installed deployment configuration. Demo responses remain local
              samples.
            </p>
          </div>
          <a
            className="source-link"
            href={`https://github.com/yukikm/solana-zkapi/releases/tag/v${SDK_VERSION}`}
            target="_blank"
            rel="noreferrer"
          >
            SDK release ({SDK_VERSION}) <ExternalLink size={14} />
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
            Wallet and SDK recovery records are retained.
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
