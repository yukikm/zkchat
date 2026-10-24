// Public TEST-ONLY Groth16/signature fixture. No real wallet or network service.
import { openBrowserStorage } from "@zkapi/solana-sdk/browser";
import {
  ControlClient,
  validateNoteJournal,
  type NoteJournal,
} from "@zkapi/solana-sdk/control";
import { ProverSessionVerifier } from "@zkapi/solana-sdk/control-prover";
import { EncryptedJournal } from "@zkapi/solana-sdk/journal";
import { WorkerProver } from "@zkapi/solana-sdk/prover-runtime";
import { sha256Hex } from "@zkapi/solana-sdk/trust";
import {
  CURRENT_VERIFIER,
  currentVerifier,
} from "../../src/lib/currentVerifier";
import type { LoadedDeploymentAssets } from "@zkapi/solana-sdk/deployment";

export async function verifyWaiverInBrowser(fixture: any) {
  const installed = await currentVerifier(
    { schema: 2, profileSha256: CURRENT_VERIFIER.profileSha256 },
    {
      verifiedManifest: {
        deployment_id: CURRENT_VERIFIER.deploymentId,
        pool: CURRENT_VERIFIER.pool,
      },
      wasmSha256: CURRENT_VERIFIER.originalWasmSha256,
    } as LoadedDeploymentAssets,
  );
  const worker = new Worker(
    new URL("../../src/lib/prover.worker.ts", import.meta.url),
    { type: "module" },
  );
  const prover = new WorkerProver(worker, installed.wasm, installed.wasmSha256);
  const storage = await openBrowserStorage(
    "zkchat-test-waiver-" + crypto.randomUUID(),
    { initialize: true },
  );
  try {
    const c = fixture.success;
    const journal = new EncryptedJournal<NoteJournal>(
      storage.store,
      storage.key,
      { deploymentId: c.context.deployment_id, pool: c.context.pool },
      validateNoteJournal,
    );
    const initial: NoteJournal = {
      schema: 1,
      state: c.state,
      history: [],
      pending: {
        prepared: c.prepared,
        exactRequest: JSON.stringify(c.prepared.request),
        phase: "closing",
        closeRequested: true,
        serverState: "ISSUANCE_UNKNOWN",
        recovery: {
          reason_code: "provider_key_absent",
          requires_operator_action: true,
        },
        operations: [],
      },
    };
    await journal.create("note", initial);
    const key = await sha256Hex(
      new TextEncoder().encode(
        JSON.stringify([
          "zkapi-client-journal-v1",
          c.context.deployment_id,
          c.context.pool,
          "note",
        ]),
      ),
    );
    const encrypted = await storage.store.read(key);
    let invalid = true;
    const methods: string[] = [];
    const http: typeof fetch = async (input, init) => {
      const url = new URL(String(input));
      methods.push(init!.method!);
      if (init!.method !== "GET")
        throw new Error("Fixture forbids financial writes and inference");
      if (url.pathname.endsWith("/receipts"))
        return Response.json(
          url.search
            ? { receipts: [], next_cursor: null }
            : {
                receipts: (invalid ? fixture.rejected.at(-1) : c).receipts,
                next_cursor: "1",
              },
        );
      if (
        url.pathname !==
        "/zkapi/v1/sessions/" + c.prepared.request.authorization.request_id
      )
        throw new Error("Unexpected fixture route");
      return Response.json({
        request_id: c.prepared.request.authorization.request_id,
        mode: "direct_openrouter",
        state: "SETTLED",
        cap_micro_usdc: c.context.cap_micro_usdc,
        settlement: c.settlement,
      });
    };
    const control = new ControlClient({
      context: c.context,
      journal,
      verifier: new ProverSessionVerifier(prover),
      fetch: http,
      allowLoopbackHttp: true,
    });
    let rejected = false;
    try {
      await control.recover("note");
    } catch {
      rejected = true;
    }
    const retained =
      JSON.stringify(await storage.store.read(key)) ===
      JSON.stringify(encrypted);
    invalid = false;
    await control.recover("note");
    const settled = (await journal.read("note"))!.value;
    const reopened = new EncryptedJournal<NoteJournal>(
      storage.store,
      storage.key,
      { deploymentId: c.context.deployment_id, pool: c.context.pool },
      validateNoteJournal,
    );
    return {
      rejected,
      retained,
      pendingCleared: settled.pending === null,
      signedSuccessor:
        JSON.stringify(settled.state) === JSON.stringify(fixture.expected),
      balanceUnchanged:
        settled.state.balance_micro_usdc === c.state.balance_micro_usdc,
      observedStillUnknown:
        settled.history[0].receipts[0].body.observed_nano_usdc === null,
      historyCount: settled.history.length,
      reopened:
        JSON.stringify((await reopened.read("note"))!.value) ===
        JSON.stringify(settled),
      methods,
    };
  } finally {
    prover.terminate();
    storage.close();
  }
}
