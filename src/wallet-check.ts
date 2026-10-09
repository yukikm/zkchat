import "./styles.css";
import { getWallets } from "@wallet-standard/app";
import type { StandardConnectFeature } from "@wallet-standard/features";
import { walletConnectionError } from "./lib/walletErrors";

const registry = getWallets();
const select = document.querySelector<HTMLSelectElement>("#wallet")!;
const button = document.querySelector<HTMLButtonElement>("#connect")!;
const result = document.querySelector<HTMLElement>("#result")!;
let wallets = registry.get();
let pending = false;
function render() {
  const selected =
    select.value === "" ? undefined : wallets[Number(select.value)];
  wallets = registry
    .get()
    .filter(
      (wallet) =>
        wallet.chains.includes("solana:devnet") &&
        wallet.features["standard:connect"],
    );
  select.replaceChildren(
    new Option("Select wallet", ""),
    ...wallets.map((wallet, index) => new Option(wallet.name, String(index))),
  );
  const index = selected ? wallets.indexOf(selected) : -1;
  select.value = index >= 0 ? String(index) : "";
  button.disabled = pending || select.value === "";
}
registry.on("register", render);
registry.on("unregister", render);
render();
select.onchange = () => {
  button.disabled = pending || select.value === "";
};
button.onclick = async () => {
  const wallet = wallets[Number(select.value)];
  if (pending || select.value === "" || !wallet) return;
  pending = true;
  select.disabled = button.disabled = true;
  result.textContent = "Waiting for the wallet connection approval…";
  try {
    const feature = wallet.features[
      "standard:connect"
    ] as StandardConnectFeature["standard:connect"];
    const connected = await feature.connect();
    result.textContent = `${wallet.name}: Wallet Standard connection succeeded (${connected.accounts.length} accounts). No transaction was requested.`;
  } catch (error) {
    result.textContent = `${walletConnectionError(wallet.name, error).message} This check did not use the Kit connector or ZKAPI.`;
  } finally {
    pending = false;
    select.disabled = false;
    button.disabled = select.value === "";
  }
};
