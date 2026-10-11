import { afterEach, describe, expect, it, vi } from "vitest";
import { ChatResponseError } from "@zkapi/solana-sdk/chat";
import { readChatResponse } from "../src/lib/chatResponse";

const headers = {
  "Content-Type": "text/event-stream",
  "X-Zkapi-Operation-Id": "fixture-operation",
};
const frame = (value: unknown) => `data: ${JSON.stringify(value)}\n\n`;
const choice = (content: string, finish_reason: string | null) => ({
  index: 0,
  delta: { content },
  finish_reason,
});
const completed = (reason = "stop", text = "Reply") =>
  frame({ choices: [choice(text, reason)] }) + "data: [DONE]\n\n";

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

function read(
  response: Response,
  stream = true,
  controller = new AbortController(),
) {
  const chunks: string[] = [];
  const promise = readChatResponse(response, {
    stream,
    signal: controller.signal,
    onDelta: (text) => chunks.push(text),
  });
  return { chunks, promise };
}

afterEach(() => vi.useRealTimers());

describe("chat response completion metadata", () => {
  it.each(["stop", "length", "content_filter"])(
    "preserves %s from streaming responses",
    async (reason) => {
      const result = read(new Response(completed(reason), { headers }));
      expect(await result.promise).toBe(reason);
      expect(result.chunks).toEqual(["Reply"]);
    },
  );

  it.each(["stop", "length", "content_filter"])(
    "preserves %s from JSON responses",
    async (reason) => {
      const response = new Response(
        JSON.stringify({
          choices: [
            { message: { content: "日本語の回答" }, finish_reason: reason },
          ],
        }),
        { headers: { "Content-Type": "application/json" } },
      );
      const result = read(response, false);
      expect(await result.promise).toBe(reason);
      expect(result.chunks).toEqual(["日本語の回答"]);
      expect(response.body?.locked).toBe(false);
    },
  );

  it("handles split Japanese bytes, CRLF, multiline data and trailing usage frames", async () => {
    const source =
      ': keepalive\r\ndata: {"choices":\r\ndata: [' +
      JSON.stringify(choice("こんにちは👩‍💻", null)) +
      "]}\r\n\r\n" +
      frame({ choices: [choice("、続きです", "length")] }) +
      frame({
        choices: [choice("", "length")],
        usage: { completion_tokens: 20 },
      }) +
      frame({ choices: [], usage: { completion_tokens: 20 } }) +
      "data: [DONE]\r\n\r\n";
    const bytes = new TextEncoder().encode(source);
    const body = new ReadableStream<Uint8Array>({
      start(controller) {
        for (const byte of bytes) controller.enqueue(new Uint8Array([byte]));
        controller.close();
      },
    });
    const result = read(new Response(body, { headers }));
    expect(await result.promise).toBe("length");
    expect(result.chunks).toEqual(["こんにちは👩‍💻", "、続きです"]);
  });

  it("delivers deltas promptly but waits for HTTP EOF after terminal SSE", async () => {
    vi.useFakeTimers();
    const source = controlledResponse();
    const result = read(source.response);
    let finished = false;
    void result.promise.then(() => (finished = true));
    source.write(completed("length", "途中"));
    await vi.advanceTimersByTimeAsync(0);
    expect(result.chunks).toEqual(["途中"]);
    expect(finished).toBe(false);
    expect(source.cancel).not.toHaveBeenCalled();
    source.close();
    expect(await result.promise).toBe("length");
    expect(source.cancel).not.toHaveBeenCalled();
    expect(source.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("rejects premature EOF and preserves already delivered text", async () => {
    const result = read(
      new Response(frame({ choices: [choice("途中", "length")] }), { headers }),
    );
    await expect(result.promise).rejects.toMatchObject({
      code: "incomplete_stream",
    });
    expect(result.chunks).toEqual(["途中"]);
  });

  it("keeps SDK validation and redacted errors after a terminal marker", async () => {
    vi.useFakeTimers();
    const source = controlledResponse();
    const result = read(source.response);
    const outcome = result.promise.catch((error: unknown) => error);
    source.write(completed("length"));
    await vi.advanceTimersByTimeAsync(0);
    source.fail(new Error("private transport detail"));
    const error = await outcome;
    expect(error).toBeInstanceOf(ChatResponseError);
    expect(error).toMatchObject({
      code: "invalid_response",
      operationId: "fixture-operation",
      status: 200,
    });
    expect((error as Error).message).not.toContain("private transport detail");
    expect(result.chunks).toEqual(["Reply"]);
    expect(source.response.body?.locked).toBe(false);
  });

  it("rejects appended output after DONE and invalid JSON choice shapes", async () => {
    const trailing = read(new Response(completed() + completed(), { headers }));
    await expect(trailing.promise).rejects.toMatchObject({
      code: "invalid_response",
    });
    const invalid = read(
      new Response(
        JSON.stringify({
          choices: [{ message: { content: 42 }, finish_reason: "length" }],
        }),
        { headers: { "Content-Type": "application/json" } },
      ),
      false,
    );
    await expect(invalid.promise).rejects.toMatchObject({
      code: "invalid_response",
    });
    expect(invalid.chunks).toEqual([]);
  });

  it("preserves the SDK read deadline and cancels a stalled source", async () => {
    vi.useFakeTimers();
    const source = controlledResponse();
    const result = read(source.response);
    const outcome = result.promise.catch((error: unknown) => error);
    source.write(completed("length"));
    await vi.advanceTimersByTimeAsync(0);
    await vi.advanceTimersByTimeAsync(600_000);
    expect(await outcome).toMatchObject({ code: "incomplete_stream" });
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("propagates cancellation during a pending read to the underlying source", async () => {
    vi.useFakeTimers();
    const controller = new AbortController();
    const source = controlledResponse();
    const result = read(source.response, true, controller);
    const outcome = result.promise.catch((error: unknown) => error);
    source.write(frame({ choices: [choice("途中", null)] }));
    await vi.advanceTimersByTimeAsync(0);
    controller.abort();
    expect(await outcome).toMatchObject({ name: "AbortError" });
    expect(result.chunks).toEqual(["途中"]);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.response.body?.locked).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("cancels a response without reading when already aborted", async () => {
    const controller = new AbortController();
    controller.abort();
    const source = controlledResponse();
    const result = read(source.response, true, controller);
    await expect(result.promise).rejects.toMatchObject({ name: "AbortError" });
    expect(result.chunks).toEqual([]);
    expect(source.cancel).toHaveBeenCalledOnce();
    expect(source.response.body?.locked).toBe(false);
  });

  it.each([true, false])(
    "does not report completion after cancellation in a final delta (stream=%s)",
    async (stream) => {
      const controller = new AbortController();
      const response = new Response(
        stream
          ? completed("length")
          : JSON.stringify({
              choices: [
                { message: { content: "Reply" }, finish_reason: "length" },
              ],
            }),
        {
          headers: {
            "Content-Type": stream ? "text/event-stream" : "application/json",
          },
        },
      );
      await expect(
        readChatResponse(response, {
          stream,
          signal: controller.signal,
          onDelta: () => controller.abort(),
        }),
      ).rejects.toMatchObject({ name: "AbortError" });
    },
  );
});
