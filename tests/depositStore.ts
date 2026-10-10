import type {
  AtomicJournalStore,
  EncryptedRecord,
} from "@zkapi/solana-sdk/journal";

/** Persistent in-memory ciphertext with real SDK encryption and serialized locks. */
export async function memoryCustody() {
  const records = new Map<string, EncryptedRecord>();
  const locks = new Map<string, Promise<unknown>>();
  const store: AtomicJournalStore = {
    async read(key) {
      return structuredClone(records.get(key) ?? null);
    },
    async compareAndSwap(key, revision, next) {
      if ((records.get(key)?.revision ?? null) !== revision)
        throw new Error("conflict");
      records.set(key, structuredClone(next));
    },
    async withLock<T>(key: string, action: () => Promise<T>): Promise<T> {
      const result = (locks.get(key) ?? Promise.resolve())
        .catch(() => {})
        .then(action);
      locks.set(key, result);
      return result;
    },
  };
  const key = await crypto.subtle.generateKey(
    { name: "AES-GCM", length: 256 },
    false,
    ["encrypt", "decrypt"],
  );
  return { store, key, records };
}
