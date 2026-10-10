import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AppWallet, StandardAccount } from "../src/lib/zkapi";

const connector = vi.hoisted(() => ({
  state: {
    wallets: [] as { raw: AppWallet }[],
    connected: null as {
      wallet: { raw: AppWallet };
      account: { address: string };
    } | null,
  },
  connect: vi.fn(),
  selectAccount: vi.fn(),
}));
vi.mock("@solana/kit", () => ({
  createClient: () => ({
    use: () => ({
      wallet: {
        getState: () => connector.state,
        connect: connector.connect,
        selectAccount: connector.selectAccount,
      },
    }),
  }),
}));
vi.mock("@solana/kit-plugin-wallet", () => ({
  walletWithoutSigner: vi.fn(),
}));
vi.mock("@wallet-standard/ui-registry", () => ({
  getWalletForHandle: (handle: { raw: AppWallet }) => handle.raw,
}));
import {
  connectSelectedWallet,
  getConnectedWalletAccount,
  selectConnectedAccount,
} from "../src/lib/walletConnector";

const account = (address: string): StandardAccount => ({
  address,
  publicKey: new Uint8Array(32),
  chains: ["solana:devnet"],
  features: ["solana:signTransaction"],
});

describe("connector-selected account", () => {
  beforeEach(() => {
    vi.clearAllMocks();
    connector.state.wallets = [];
    connector.state.connected = null;
  });

  it("returns the wallet's original active account when it is not first", async () => {
    const previous = account("previous"),
      active = account("active");
    const wallet = { name: "Test", accounts: [previous, active] } as AppWallet;
    const handle = { raw: wallet };
    connector.state.wallets = [handle];
    connector.connect.mockImplementationOnce(async () => {
      connector.state.connected = { wallet: handle, account: { ...active } };
    });

    await connectSelectedWallet(wallet);
    expect(getConnectedWalletAccount(wallet)).toBe(active);
    expect(() => selectConnectedAccount(wallet, active)).not.toThrow();
    expect(connector.selectAccount).not.toHaveBeenCalled();
  });

  it("rejects a stale account even when that address remains authorized", () => {
    const previous = account("previous"),
      active = account("active");
    const wallet = { name: "Test", accounts: [previous, active] } as AppWallet;
    connector.state.connected = { wallet: { raw: wallet }, account: active };

    expect(() => selectConnectedAccount(wallet, previous)).toThrow(/changed/);
    expect(connector.selectAccount).not.toHaveBeenCalled();
  });

  it("does not reuse an account from a different connected wallet", () => {
    const active = account("same-address");
    const wallet = { name: "Test", accounts: [active] } as AppWallet;
    const other = { ...wallet, name: "Other" };
    connector.state.connected = { wallet: { raw: other }, account: active };

    expect(getConnectedWalletAccount(wallet)).toBeNull();
    expect(() => selectConnectedAccount(wallet, active)).toThrow(/Reconnect/);
  });

  it("clears the active account after the wallet removes it", () => {
    const active = account("active");
    const wallet = { name: "Test", accounts: [] } as unknown as AppWallet;
    connector.state.connected = { wallet: { raw: wallet }, account: active };

    expect(getConnectedWalletAccount(wallet)).toBeNull();
  });
});
