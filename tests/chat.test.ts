import { afterEach, describe, expect, it, vi } from "vitest";
import {
  contextMessages,
  conversationMarkdown,
  defaultPreferences,
  demoAnswer,
  formatUsdc,
  fundedNoteBalance,
  MAX_CHATS,
  microUsdc,
  newConversation,
  parseHistory,
  parsePreferences,
  streamDemo,
  titleFrom,
  type Conversation,
  type Message,
} from "../src/lib/chat";
it("does not display prepared or withdrawn principal as funded credits", () => {
  for (const wallet of ["empty", "unfunded", "closed"]) {
    expect(
      fundedNoteBalance({ wallet, settledBalanceMicroUsdc: "2000000" }),
    ).toBe("0");
  }
  expect(
    fundedNoteBalance({ wallet: "active", settledBalanceMicroUsdc: "1900001" }),
  ).toBe("1900001");
  expect(
    fundedNoteBalance({
      wallet: "pending_escape",
      settledBalanceMicroUsdc: "1900001",
    }),
  ).toBe("1900001");
  expect(fundedNoteBalance(null)).toBeUndefined();
});
function message(
  role: Message["role"],
  operationId: string,
  state: Message["state"] = "complete",
  content = `${role}: ${operationId}`,
): Message {
  return {
    id: `${operationId}-${role}`,
    role,
    operationId,
    state,
    content,
    createdAt: 1700000000000,
  };
}
function conversation(messages: Message[] = []): Conversation {
  return {
    id: "chat-1",
    title: "相談",
    mode: "live",
    model: "provider/model",
    updatedAt: 1700000000000,
    messages,
  };
}
describe("provider conversation context", () => {
  it("sends only complete matching pairs in their original order", () => {
    const messages = [
      message("user", "first"),
      message("assistant", "first"),
      message("user", "failed"),
      message("assistant", "failed", "error"),
      message("user", "stopped"),
      message("assistant", "stopped", "stopped"),
      message("user", "streaming"),
      message("assistant", "streaming", "streaming"),
      message("user", "last"),
      message("assistant", "last"),
      message("user", "pending"),
    ];
    expect(contextMessages(messages)).toEqual([
      { role: "user", content: "user: first" },
      { role: "assistant", content: "assistant: first" },
      { role: "user", content: "user: last" },
      { role: "assistant", content: "assistant: last" },
    ]);
  });
  it("does not splice unrelated requests or orphan replies into a context", () => {
    expect(
      contextMessages([
        message("assistant", "orphan"),
        message("user", "one"),
        message("assistant", "two"),
        message("user", "broken", "error"),
        message("assistant", "broken"),
        message("user", "valid"),
        message("assistant", "valid"),
      ]),
    ).toEqual([
      { role: "user", content: "user: valid" },
      { role: "assistant", content: "assistant: valid" },
    ]);
  });
});
describe("history restoration", () => {
  it("preserves length-limited replies and their context for an explicit follow-up", () => {
    const original = conversation([
      message("user", "a"),
      {
        ...message("assistant", "a", "complete", "1. 友人は入口の"),
        finishReason: "length",
      },
    ] as Message[]);
    const [restored] = parseHistory(JSON.stringify([original]));
    expect(restored).toEqual(original);
    expect(contextMessages(restored.messages)).toEqual([
      { role: "user", content: "user: a" },
      { role: "assistant", content: "1. 友人は入口の" },
    ]);
    original.messages[1].finishReason = "invalid" as Message["finishReason"];
    expect(parseHistory(JSON.stringify([original]))).toEqual([]);
  });
  it("keeps an interrupted reply readable but ineligible for provider context", () => {
    const original = conversation([
      message("user", "a"),
      message("assistant", "a", "streaming", "途中までの回答"),
    ]);
    const [restored] = parseHistory(JSON.stringify([original]));
    expect(restored.messages[1]).toMatchObject({
      state: "stopped",
      content: "途中までの回答",
    });
    expect(restored.messages[1].error).toContain("settlement");
    expect(contextMessages(restored.messages)).toEqual([]);
    expect(original.messages[1].state).toBe("streaming");
  });
  it.each([null, "", "{broken", "null", "{}", "42"])(
    "recovers from corrupted storage %s",
    (raw) => {
      expect(parseHistory(raw)).toEqual([]);
    },
  );
  it("retains good conversations while rejecting malformed messages and invalid modes", () => {
    const valid = conversation([
      message("user", "one"),
      message("assistant", "one"),
    ]);
    expect(
      parseHistory(
        JSON.stringify([
          null,
          { ...valid, mode: "fake" },
          { ...valid, updatedAt: "yesterday" },
          {
            ...valid,
            messages: [
              { ...message("user", "bad"), content: { html: "<img>" } },
            ],
          },
          {
            ...valid,
            messages: [{ ...message("assistant", "bad"), state: "paid" }],
          },
          valid,
        ]),
      ),
    ).toEqual([valid]);
  });
  it("caps history while preserving each conversation mode", () => {
    const input = Array.from({ length: MAX_CHATS + 5 }, (_, i) => ({
      ...conversation(),
      id: `chat-${i}`,
      mode: i % 2 ? "live" : "demo",
    }));
    const restored = parseHistory(JSON.stringify(input));
    expect(restored).toHaveLength(MAX_CHATS);
    expect(restored[0].mode).toBe("demo");
    expect(restored[1].mode).toBe("live");
  });
});
describe("USDC amounts", () => {
  it.each([
    ["0.000001", "1"],
    ["0.1", "100000"],
    ["1", "1000000"],
    ["12.345678", "12345678"],
    ["9007199254.740993", "9007199254740993"],
    ["18446744073709.551615", "18446744073709551615"],
  ])("converts %s with exact precision", (input, expected) => {
    expect(microUsdc(input)).toBe(expected);
  });
  it.each([
    "0",
    "0.000000",
    "-1",
    "1e3",
    "NaN",
    "Infinity",
    " 1",
    "1 ",
    "01",
    ".1",
    "1.",
    "1.0000001",
    "18446744073709.551616",
  ])("rejects invalid or overflowing amount %s", (input) => {
    expect(() => microUsdc(input)).toThrow();
  });
  it("formats u64 balances without precision loss", () => {
    expect(formatUsdc("18446744073709551615")).toBe(
      "18,446,744,073,709.551615",
    );
    expect(formatUsdc("9007199254740993")).toBe("9,007,199,254.740993");
    expect(formatUsdc("1000000")).toBe("1.00");
    expect(formatUsdc("1")).toBe("0.000001");
    expect(formatUsdc("0")).toBe("0.00");
    expect(formatUsdc(undefined)).toBe("—");
    expect(formatUsdc("garbage")).toBe("—");
  });
});
describe("local behavior", () => {
  afterEach(() => vi.useRealTimers());
  it("creates isolated conversations with distinct IDs", () => {
    const live = newConversation("live", "provider/model"),
      demo = newConversation("demo", "demo");
    expect(live.id).not.toBe(demo.id);
    expect(live).toMatchObject({
      mode: "live",
      model: "provider/model",
      messages: [],
    });
    expect(demo).toMatchObject({ mode: "demo", model: "demo", messages: [] });
  });
  it("validates stored preferences and recovers corrupted JSON", () => {
    expect(parsePreferences(null).maxTokens).toBe(4096);
    expect(parsePreferences("{")).toEqual(defaultPreferences);
    expect(parsePreferences("null")).toEqual(defaultPreferences);
    expect(
      parsePreferences(
        JSON.stringify({ theme: "dark", stream: false, maxTokens: 4096 }),
      ),
    ).toEqual({ theme: "dark", stream: false, maxTokens: 4096 });
    expect(
      parsePreferences(
        JSON.stringify({
          theme: "ultraviolet",
          stream: "false",
          maxTokens: 999999,
        }),
      ),
    ).toEqual(defaultPreferences);
    expect(parsePreferences('{"maxTokens":1024}').maxTokens).toBe(1024);
  });
  it("labels demo replies and exports without implying AI connectivity", () => {
    const c = {
      ...conversation([message("assistant", "one", "stopped", "途中")]),
      mode: "demo" as const,
    };
    expect(demoAnswer("こんにちは", [])).toContain("No AI request or payment");
    expect(conversationMarkdown(c)).toContain(
      "This is an interactive demo. It is not connected to AI or Solana",
    );
    expect(conversationMarkdown(c)).toContain("zkchat (incomplete)");
    expect(conversationMarkdown(conversation())).not.toContain(
      "interactive demo",
    );
  });
  it("streams Unicode text intact and stops yielding after cancellation", async () => {
    vi.useFakeTimers();
    const complete: string[] = [];
    const done = streamDemo(
      "こんにちは👩‍💻、Solana！",
      new AbortController().signal,
      (chunk) => complete.push(chunk),
    );
    await vi.runAllTimersAsync();
    await done;
    expect(complete.join("")).toBe("こんにちは👩‍💻、Solana！");
    const controller = new AbortController(),
      partial: string[] = [];
    const pending = streamDemo(
      "一二三四五六七八九十まだ続く",
      controller.signal,
      (chunk) => partial.push(chunk),
    );
    const rejected = expect(pending).rejects.toMatchObject({
      name: "AbortError",
    });
    await vi.advanceTimersByTimeAsync(18);
    controller.abort();
    await rejected;
    await vi.runAllTimersAsync();
    expect(partial).toEqual(["一二三四五"]);
  });
  it("normalizes and limits sidebar titles", () => {
    expect(titleFrom("  こんにちは\n\tSolana  ")).toBe("こんにちは Solana");
    expect(titleFrom("あ".repeat(50))).toHaveLength(29);
  });
});
