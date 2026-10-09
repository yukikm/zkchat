import { describe, expect, it } from "vitest";
import {
  walletConnectionError,
  WalletConnectionError,
} from "../src/lib/walletErrors";

describe("wallet connection failures", () => {
  it.each([
    [4001, "was declined"],
    [-32002, "pending request"],
    [4100, "has not authorized"],
    [4900, "could not connect to its network"],
    [-32603, "internal connection error (code -32603)"],
  ])(
    "explains provider code %s without blaming funds or ZKAPI",
    (code, text) => {
      const failure = walletConnectionError("Phantom", { code });
      expect(failure.message).toContain(text);
      expect(failure.message).toContain("No transaction was requested");
      expect(failure.code).toBe(code);
    },
  );
  it("recognizes Phantom's generic internal error without a code", () => {
    expect(
      walletConnectionError("Phantom", new Error("Unexpected error")).message,
    ).toContain("internal connection error");
  });
  it("does not reveal arbitrary error payloads", () => {
    const error = Object.assign(new Error("private diagnostic payload"), {
      code: "private token",
    });
    expect(walletConnectionError("Phantom", error).message).not.toContain(
      "private",
    );
  });
  it("preserves explicit account and reconnect guidance", () => {
    const error = new WalletConnectionError(
      "Reconnect the selected wallet first.",
    );
    expect(walletConnectionError("Phantom", error)).toBe(error);
  });
});
