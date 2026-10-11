export type ChatMode = "live" | "demo";
export type Message = {
  id: string;
  role: "user" | "assistant";
  content: string;
  state: "complete" | "streaming" | "error" | "stopped";
  operationId: string;
  createdAt: number;
  error?: string;
  finishReason?: "stop" | "length" | "content_filter";
};
export type Conversation = {
  id: string;
  title: string;
  mode: ChatMode;
  model: string;
  updatedAt: number;
  messages: Message[];
};
export const HISTORY_KEY = "zkchat:conversations:v1";
export const SETTINGS_KEY = "zkchat:preferences:v1";
export const MAX_CHATS = 100;
export const MAX_INPUT = 16000;
export const MIN_OUTPUT_TOKENS = 128;
export const MAX_OUTPUT_TOKENS = 4096;
export type Preferences = {
  theme: "system" | "light" | "dark";
  stream: boolean;
  maxTokens: number;
};
export const defaultPreferences: Preferences = {
  theme: "system",
  stream: true,
  maxTokens: MAX_OUTPUT_TOKENS,
};
export function newConversation(mode: ChatMode, model = ""): Conversation {
  return {
    id: crypto.randomUUID(),
    title: "New chat",
    mode,
    model,
    updatedAt: Date.now(),
    messages: [],
  };
}
export function titleFrom(text: string) {
  const title = text.trim().replace(/\s+/g, " ");
  return title.length > 28 ? `${title.slice(0, 28)}…` : title;
}
export function parseHistory(raw: string | null): Conversation[] {
  if (!raw) return [];
  try {
    const data: unknown = JSON.parse(raw);
    if (!Array.isArray(data)) return [];
    return data
      .filter(
        (c): c is Conversation =>
          c &&
          typeof c.id === "string" &&
          typeof c.title === "string" &&
          typeof c.model === "string" &&
          (c.mode === "live" || c.mode === "demo") &&
          Number.isFinite(c.updatedAt) &&
          Array.isArray(c.messages) &&
          c.messages.length <= 1000 &&
          c.messages.every(
            (m: Message) =>
              m &&
              typeof m.id === "string" &&
              typeof m.content === "string" &&
              m.content.length <= 4 * 1024 * 1024 &&
              (m.role === "user" || m.role === "assistant") &&
              ["complete", "streaming", "error", "stopped"].includes(m.state) &&
              typeof m.operationId === "string" &&
              Number.isFinite(m.createdAt) &&
              (m.error === undefined || typeof m.error === "string") &&
              (m.finishReason === undefined ||
                ["stop", "length", "content_filter"].includes(m.finishReason)),
          ),
      )
      .slice(0, MAX_CHATS)
      .map((c) => ({
        ...c,
        messages: c.messages.map((m) =>
          m.state === "streaming"
            ? {
                ...m,
                state: "stopped",
                error:
                  "Display was interrupted. In live mode, check pending wallet settlement.",
              }
            : m,
        ),
      }));
  } catch {
    return [];
  }
}
export function parsePreferences(raw: string | null): Preferences {
  try {
    const p = JSON.parse(raw ?? "{}");
    return {
      theme: ["system", "light", "dark"].includes(p?.theme)
        ? p.theme
        : "system",
      stream: typeof p?.stream === "boolean" ? p.stream : true,
      maxTokens:
        Number.isInteger(p?.maxTokens) &&
        p.maxTokens >= MIN_OUTPUT_TOKENS &&
        p.maxTokens <= MAX_OUTPUT_TOKENS
          ? p.maxTokens
          : defaultPreferences.maxTokens,
    };
  } catch {
    return defaultPreferences;
  }
}
/** Only successfully received user/assistant pairs go back to the provider.
 * Length-limited replies remain context so the user can ask to continue;
 * failed and cancelled transports stay visible locally. */
export function contextMessages(
  messages: Message[],
): { role: "user" | "assistant"; content: string }[] {
  const result: { role: "user" | "assistant"; content: string }[] = [];
  for (let i = 0; i < messages.length - 1; i++) {
    const u = messages[i],
      a = messages[i + 1];
    if (
      u.role === "user" &&
      a.role === "assistant" &&
      u.operationId === a.operationId &&
      u.state === "complete" &&
      a.state === "complete"
    ) {
      result.push(
        { role: "user", content: u.content },
        { role: "assistant", content: a.content },
      );
      i++;
    }
  }
  return result;
}
export class AmountInputError extends Error {}
export function microUsdc(value: string): string {
  if (!/^(0|[1-9]\d*)(\.\d{1,6})?$/.test(value))
    throw new AmountInputError(
      "Enter a positive USDC amount with up to six decimal places.",
    );
  const [whole, decimal = ""] = value.split(".");
  const amount = BigInt(whole) * 1000000n + BigInt(decimal.padEnd(6, "0"));
  if (amount <= 0n || amount > 18446744073709551615n)
    throw new AmountInputError("The USDC amount is out of range.");
  return amount.toString();
}
/** Prepared and withdrawn notes can retain historical SDK balances. */
export function fundedNoteBalance(
  status: { wallet: string; settledBalanceMicroUsdc: string } | null,
) {
  if (!status) return undefined;
  return ["empty", "unfunded", "closed"].includes(status.wallet)
    ? "0"
    : status.settledBalanceMicroUsdc;
}
export function formatUsdc(value: string | undefined) {
  if (!value || !/^\d+$/.test(value)) return "—";
  const v = BigInt(value);
  const fraction = (v % 1000000n)
    .toString()
    .padStart(6, "0")
    .replace(/0+$/, "");
  return `${(v / 1000000n).toLocaleString("en-US")}${fraction ? `.${fraction}` : ".00"}`;
}
export function conversationMarkdown(c: Conversation) {
  return `# ${c.title}\n\n${c.mode === "demo" ? "> This is an interactive demo. It is not connected to AI or Solana.\n\n" : ""}${c.messages.map((m) => `## ${m.role === "user" ? "You" : "zkchat"}${m.state !== "complete" ? " (incomplete)" : ""}\n\n${m.content}`).join("\n\n---\n\n")}`;
}
export function demoAnswer(input: string, messages: Message[]): string {
  const intro = "> Demo reply · No AI request or payment.\n\n";
  if (/コード|code|プログラ|typescript/i.test(input))
    return (
      intro +
      "Here is a TypeScript example that removes duplicate values from an array.\n\n```typescript\nfunction unique<T>(values: T[]): T[] {\n  return [...new Set(values)];\n}\n\nunique([1, 2, 2, 3]); // [1, 2, 3]\n```\n\nTo discuss code with a real model, connect your ZKAPI wallet in Connection settings."
    );
  if (/zk|ゼロ知識|solana|仕組み/i.test(input))
    return (
      intro +
      "ZKAPI lets you pay API usage charges with USDC on Solana.\n\n1. **Deposit** — Fund credits from your wallet.\n2. **Authorize** — Use a locally generated zero-knowledge proof.\n3. **Chat** — Send a request to the configured AI provider.\n4. **Settle** — See charges and balances verified by the SDK.\n\nPrompts go to the AI provider. In proxy mode, the operator can also read their content. ZK proofs do not guarantee response accuracy."
    );
  if (/文章|メール|書|ライティング|write|writing|email/i.test(input))
    return (
      intro +
      "Before writing, decide **who you are addressing, what you want to say, and what you want them to do**.\n\nFor example, to request a meeting:\n\n> Hello,\n> Could we schedule 30 minutes to discuss the new project?\n> Please send two or three times that would work for you.\n\nIn live mode, share your goal and draft to refine them with the model."
    );
  if (/アイデア|考え|企画|idea|brainstorm/i.test(input))
    return (
      intro +
      "To explore an idea, start with these three questions.\n\n- **Who is it for?** — Think of one person you want to help.\n- **What is the problem?** — Describe a specific everyday difficulty.\n- **What could you test first?** — Pick something you can build in a day.\n\nIn live mode, continue the conversation to develop the idea with its context."
    );
  const turns = contextMessages(messages).length / 2;
  return (
    intro +
    `Received: “${input.slice(0, 100)}${input.length > 100 ? "…" : ""}”.\n\n${turns > 0 ? `This conversation contains ${turns} completed exchanges.` : "Here you can try sending, stopping the display, Markdown, and conversation history."}\n\nTo use AI, connect your wallet in **Connection settings**.`
  );
}
export async function streamDemo(
  text: string,
  signal: AbortSignal,
  onDelta: (delta: string) => void,
) {
  const segments = Array.from(text);
  for (let i = 0; i < segments.length; i += 5) {
    signal.throwIfAborted();
    await new Promise<void>((resolve, reject) => {
      const abort = () => {
        clearTimeout(timer);
        reject(new DOMException("Stopped", "AbortError"));
      };
      const timer = setTimeout(() => {
        signal.removeEventListener("abort", abort);
        resolve();
      }, 18);
      signal.addEventListener("abort", abort, { once: true });
    });
    onDelta(segments.slice(i, i + 5).join(""));
  }
}
