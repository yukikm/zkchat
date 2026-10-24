import type { EncryptedRecord } from "@zkapi/solana-sdk/journal";

/** A deterministic HTTP backup service fixture. All cryptography, journal
 * validation, migration, CAS recovery, and binding persistence use the real SDK. */
export function recoveryService() {
  type Vault = {
    auth: string;
    owner: string;
    context: string;
    epoch: number;
    records: Map<string, EncryptedRecord>;
    locks: Map<string, string>;
  };
  const vaults = new Map<string, Vault>();
  let requests = 0,
    writes = 0,
    failWrite: number | null = null;
  async function respond(
    url: string,
    method: string,
    headers: Headers,
    rawBody?: string | null,
  ) {
    requests++;
    const path = new URL(url).pathname;
    const match = /^\/recovery\/v1\/vaults\/([0-9a-f]{64})(.*)$/.exec(path);
    const reply = (status: number, body: unknown) =>
      new Response(JSON.stringify(body), {
        status,
        headers: { "content-type": "application/json" },
      });
    if (!match) return reply(404, { error: "not_found" });
    const [, id, tail] = match,
      token = headers.get("authorization")?.replace(/^Bearer /, "") ?? "";
    const body = rawBody ? JSON.parse(rawBody) : undefined;
    let vault = vaults.get(id);
    if (!tail && method === "POST") {
      if (!vault) {
        vault = {
          auth: token,
          owner: body.ownerToken,
          context: body.context,
          epoch: 1,
          records: new Map(),
          locks: new Map(),
        };
        vaults.set(id, vault);
      } else if (vault.auth !== token)
        return reply(401, { error: "unauthorized" });
      else if (
        vault.owner !== body.ownerToken ||
        vault.context !== body.context
      )
        return reply(409, { error: "conflict" });
      return reply(201, { context: vault.context, epoch: vault.epoch });
    }
    if (!vault) return reply(404, { error: "not_found" });
    if (tail === "/takeover" && method === "POST") {
      if (vault.auth !== token) return reply(401, { error: "unauthorized" });
      if (body.previousOwnerStopped !== true)
        return reply(400, { error: "invalid" });
      if (vault.owner !== body.ownerToken) {
        vault.owner = body.ownerToken;
        vault.epoch++;
        vault.locks.clear();
      }
      return reply(200, { context: vault.context, epoch: vault.epoch });
    }
    if (vault.owner !== token) return reply(401, { error: "unauthorized" });
    if (!tail && method === "GET")
      return reply(200, { context: vault.context, epoch: vault.epoch });
    const recordPath = /^\/records\/([0-9a-f]{64})$/.exec(tail);
    if (recordPath) {
      const key = recordPath[1],
        previous = vault.records.get(key);
      if (method === "GET") return reply(200, { record: previous ?? null });
      if (method === "PUT") {
        writes++;
        if (writes === failWrite) return reply(503, { error: "unavailable" });
        if (JSON.stringify(previous) === JSON.stringify(body.record))
          return reply(200, { ok: true });
        if ((previous?.revision ?? null) !== body.expectedRevision)
          return reply(409, { error: "conflict" });
        vault.records.set(key, structuredClone(body.record));
        return reply(200, { ok: true });
      }
    }
    const lockPath = /^\/locks\/([0-9a-f]{64})$/.exec(tail);
    if (lockPath) {
      const key = lockPath[1],
        held = vault.locks.get(key);
      if (held && held !== body.token) return reply(409, { error: "locked" });
      if (method === "POST") {
        vault.locks.set(key, body.token);
        return reply(200, { ok: true });
      }
      if (method === "DELETE") {
        vault.locks.delete(key);
        return reply(200, { ok: true });
      }
    }
    return reply(404, { error: "not_found" });
  }
  const fetcher: typeof fetch = async (input, init) => {
    const request = new Request(input, init);
    return respond(
      request.url,
      request.method,
      request.headers,
      await request.text(),
    );
  };
  return {
    fetch: fetcher,
    respond,
    vaults,
    get requests() {
      return requests;
    },
    get writes() {
      return writes;
    },
    failWriteAt(value: number | null) {
      failWrite = value;
    },
  };
}
