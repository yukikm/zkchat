import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatResponseError, readChatDeltas } from "@zkapi/solana-sdk/chat";

// Exercise the shipped SDK parser using local bytes, without a wallet or inference.
const headers = {
  "Content-Type": "text/event-stream",
  "X-Zkapi-Operation-Id": "fixture-operation",
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const completed =
  frame({
    choices: [{ index: 0, delta: { content: "Reply" }, finish_reason: "stop" }],
  }) + "data: [DONE]\n\n";

function controlledResponse() {
  let controller!: ReadableStreamDefaultController<Uint8Array>;
  const cancel = vi.fn();
  const body = new ReadableStream<Uint8Array>({
    start(value) {
      controller = value;
    },
    cancel,
  });
  return {
    response: new Response(body, { headers }),
    write: (text: string) => controller.enqueue(new TextEncoder().encode(text)),
    close: () => controller.close(),
    fail: (error: Error) => controller.error(error),
    cancel,
  };
}

async function collect(response: Response) {
  let text = "";
  for await (const delta of readChatDeltas(response)) text += delta;
  return text;
}

afterEach(() => vi.useRealTimers());

describe("packaged SDK streaming completion", () => {
  it("keeps terminal SSE pending until HTTP EOF and does not cancel success", async () => {
    vi.useFakeTimers();
    const stream = controlledResponse();
    stream.write(completed);
    const reader = readChatDeltas(stream.response);
    expect(await reader.next()).toEqual({ value: "Reply", done: false });
    let finished = false;
    const completion = reader.next().then((value) => {
      finished = true;
      return value;
    });
    await vi.advanceTimersByTimeAsync(0);
    expect(finished).toBe(false);
    expect(stream.response.body?.locked).toBe(true);
    expect(stream.cancel).not.toHaveBeenCalled();
    stream.close();
    expect(await completion).toEqual({ value: undefined, done: true });
    expect(stream.cancel).not.toHaveBeenCalled();
    expect(stream.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("preserves a partial delta but rejects an aborted transport after terminal SSE", async () => {
    const stream = controlledResponse();
    stream.write(completed);
    const reader = readChatDeltas(stream.response);
    expect((await reader.next()).value).toBe("Reply");
    const completion = reader.next().catch((error: unknown) => error);
    stream.fail(new DOMException("private transport detail", "AbortError"));
    const error = await completion;
    expect(error).toBeInstanceOf(ChatResponseError);
    expect(error).toMatchObject({
      code: "invalid_response",
      operationId: "fixture-operation",
      status: 200,
    });
    expect((error as Error).message).not.toContain("private transport detail");
    expect(stream.response.body?.locked).toBe(false);
  });

  it("rejects premature EOF and data appended after a terminal marker", async () => {
    const partial = frame({
      choices: [
        { index: 0, delta: { content: "Partial" }, finish_reason: null },
      ],
    });
    await expect(
      collect(new Response(partial, { headers })),
    ).rejects.toMatchObject({
      code: "incomplete_stream",
    });
    await expect(
      collect(new Response(completed + partial, { headers })),
    ).rejects.toMatchObject({ code: "invalid_response" });
  });

  it("lets a native clone finish while the other branch still has buffered text", async () => {
    const original = new Response(completed, { headers });
    const copy = original.clone();
    expect(await collect(copy)).toBe("Reply");
    expect(original.bodyUsed).toBe(false);
    expect(await collect(original)).toBe("Reply");
    expect(original.body?.locked).toBe(false);
    expect(copy.body?.locked).toBe(false);
  });

  it("bounds a stalled EOF read without timing out consumer processing pauses", async () => {
    vi.useFakeTimers();
    const stream = controlledResponse();
    stream.write(completed);
    const reader = readChatDeltas(stream.response);
    expect((await reader.next()).value).toBe("Reply");
    await vi.advanceTimersByTimeAsync(600_001);
    expect(stream.cancel).not.toHaveBeenCalled();
    const completion = reader.next().catch((error: unknown) => error);
    await vi.advanceTimersByTimeAsync(599_999);
    expect(stream.cancel).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(1);
    expect(await completion).toMatchObject({ code: "incomplete_stream" });
    expect(stream.cancel).toHaveBeenCalledOnce();
    expect(stream.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
