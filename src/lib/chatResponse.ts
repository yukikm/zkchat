import { readChatDeltas, readChatText } from "@zkapi/solana-sdk/chat";

export type ChatFinishReason = "stop" | "length" | "content_filter";

// These are observation limits, not response validation. The SDK remains the
// authority for accepted bytes, choice shape, terminal markers and HTTP EOF.
const MAX_FRAME = 1024 * 1024;
const MAX_JSON = 4 * 1024 * 1024;
const MAX_STREAM = 16 * 1024 * 1024;

class FinishReasonObserver {
  reason: ChatFinishReason | undefined;
  private decoder = new TextDecoder();
  private buffer = "";
  private data: string[] = [];
  private frameSize = 0;
  private bytes = 0;
  private disabled = false;

  constructor(private stream: boolean) {}

  push(chunk: Uint8Array) {
    if (this.disabled) return;
    this.bytes += chunk.byteLength;
    if (this.bytes > (this.stream ? MAX_STREAM : MAX_JSON)) {
      this.disable();
      return;
    }
    this.buffer += this.decoder.decode(chunk, { stream: true });
    if (this.stream) this.lines(false);
  }

  finish() {
    if (this.disabled) return;
    this.buffer += this.decoder.decode();
    if (this.stream) this.lines(true);
    else this.observe(this.buffer);
    this.disable();
  }

  private disable() {
    this.disabled = true;
    this.buffer = "";
    this.data = [];
  }

  private observe(source: string) {
    if (source === "[DONE]") {
      this.disable();
      return;
    }
    try {
      const value = JSON.parse(source);
      const reason = value?.choices?.[0]?.finish_reason;
      if (
        reason === "stop" ||
        reason === "length" ||
        reason === "content_filter"
      ) {
        this.reason = reason;
      }
    } catch {
      // Invalid frames are rejected by the SDK, with its public error details.
    }
  }

  private lines(eof: boolean) {
    while (!this.disabled) {
      const match = /\r\n|\r|\n/.exec(this.buffer);
      if (
        !match ||
        (!eof && match[0] === "\r" && match.index === this.buffer.length - 1)
      ) {
        break;
      }
      const line = this.buffer.slice(0, match.index);
      this.buffer = this.buffer.slice(match.index + match[0].length);
      this.frameSize += line.length;
      if (this.frameSize > MAX_FRAME) {
        this.disable();
        return;
      }
      if (!line) {
        const source = this.data.join("\n");
        this.data = [];
        this.frameSize = 0;
        if (source) this.observe(source);
      } else if (line.startsWith("data:")) {
        this.data.push(line.slice(5).replace(/^ /, ""));
      }
    }
    if (this.buffer.length + this.frameSize > MAX_FRAME) this.disable();
  }
}

/** Read text through the SDK and retain its validated completion reason. */
export async function readChatResponse(
  response: Response,
  options: {
    stream: boolean;
    signal: AbortSignal;
    onDelta: (text: string) => void;
  },
): Promise<ChatFinishReason | undefined> {
  const { stream, signal, onDelta } = options;
  if (signal.aborted) {
    await response.body?.cancel(signal.reason).catch(() => {});
    signal.throwIfAborted();
  }
  const observer = new FinishReasonObserver(stream);
  let observed = response;
  let piping: Promise<void> | undefined;
  if (response.body && response.ok) {
    // One pass through the original body. TransformStream backpressure avoids
    // cloning/buffering another response, and cancellation reaches the source.
    const passThrough = new TransformStream<Uint8Array, Uint8Array>({
      transform(chunk, controller) {
        observer.push(chunk);
        controller.enqueue(chunk);
      },
      flush() {
        observer.finish();
      },
    });
    piping = response.body.pipeTo(passThrough.writable, { signal });
    // The SDK reports stream errors; handle the pipe promise immediately so a
    // source failure cannot create a separate unhandled rejection.
    void piping.catch(() => {});
    observed = new Response(passThrough.readable, {
      headers: response.headers,
      status: response.status,
      statusText: response.statusText,
    });
  }

  try {
    if (stream) {
      for await (const delta of readChatDeltas(observed)) {
        signal.throwIfAborted();
        onDelta(delta);
      }
    } else {
      const text = await readChatText(observed);
      signal.throwIfAborted();
      onDelta(text);
    }
  } catch (error) {
    signal.throwIfAborted();
    throw error;
  } finally {
    // Preserve the SDK error while finishing source cancellation/lock release.
    await piping?.catch(() => {});
  }
  signal.throwIfAborted();
  return observer.reason;
}
