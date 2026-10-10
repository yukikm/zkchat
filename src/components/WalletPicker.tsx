import { useEffect, useId, useRef, useState } from "react";
import { Check, ChevronDown, Wallet } from "lucide-react";
import type { AppWallet } from "../lib/zkapi";

export function WalletIcon({ wallet }: { wallet: AppWallet }) {
  const [failedIcon, setFailedIcon] = useState("");
  return wallet.icon && failedIcon !== wallet.icon ? (
    <img
      className="wallet-icon"
      src={wallet.icon}
      alt=""
      onError={() => setFailedIcon(wallet.icon)}
    />
  ) : (
    <Wallet className="wallet-icon" aria-hidden="true" />
  );
}

export function WalletPicker({
  wallets,
  selected,
  disabled,
  onSelect,
}: {
  wallets: AppWallet[];
  selected: AppWallet;
  disabled: boolean;
  onSelect: (wallet: AppWallet) => void;
}) {
  const [open, setOpen] = useState(false);
  const root = useRef<HTMLDivElement>(null);
  const trigger = useRef<HTMLButtonElement>(null);
  const options = useRef<(HTMLButtonElement | null)[]>([]);
  const listId = useId();
  const expanded = open && !disabled;
  useEffect(() => {
    if (!expanded) return;
    options.current[Math.max(0, wallets.indexOf(selected))]?.focus();
    const dismiss = (event: PointerEvent) => {
      if (!root.current?.contains(event.target as Node)) setOpen(false);
    };
    document.addEventListener("pointerdown", dismiss);
    return () => document.removeEventListener("pointerdown", dismiss);
  }, [expanded, selected, wallets]);
  return (
    <div
      className="wallet-picker"
      ref={root}
      onBlur={(event) => {
        if (!event.currentTarget.contains(event.relatedTarget)) setOpen(false);
      }}
      onKeyDown={(event) => {
        if (event.key === "Escape" && expanded) {
          event.preventDefault();
          event.stopPropagation();
          setOpen(false);
          trigger.current?.focus();
        }
      }}
    >
      <button
        ref={trigger}
        className="wallet-picker-trigger"
        type="button"
        aria-label="Select wallet"
        aria-haspopup="listbox"
        aria-expanded={expanded}
        aria-controls={expanded ? listId : undefined}
        disabled={disabled}
        onClick={() => setOpen(!open)}
        onKeyDown={(event) => {
          if (event.key === "ArrowDown" || event.key === "ArrowUp") {
            event.preventDefault();
            setOpen(true);
          }
        }}
      >
        <WalletIcon wallet={selected} />
        <span>{selected.name}</span>
        <ChevronDown size={18} aria-hidden="true" />
      </button>
      {expanded && (
        <div
          className="wallet-options"
          role="listbox"
          aria-label="Available wallets"
          id={listId}
        >
          {wallets.map((wallet, index) => (
            <button
              ref={(element) => {
                options.current[index] = element;
              }}
              type="button"
              role="option"
              aria-selected={wallet === selected}
              key={`${wallet.name}-${index}`}
              tabIndex={-1}
              onKeyDown={(event) => {
                let next = index;
                if (event.key === "ArrowDown")
                  next = (index + 1) % wallets.length;
                else if (event.key === "ArrowUp")
                  next = (index + wallets.length - 1) % wallets.length;
                else if (event.key === "Home") next = 0;
                else if (event.key === "End") next = wallets.length - 1;
                else return;
                event.preventDefault();
                options.current[next]?.focus();
              }}
              onClick={() => {
                onSelect(wallet);
                setOpen(false);
                trigger.current?.focus();
              }}
            >
              <WalletIcon wallet={wallet} />
              <span>{wallet.name}</span>
              {wallet === selected && <Check size={17} aria-hidden="true" />}
            </button>
          ))}
        </div>
      )}
    </div>
  );
}
