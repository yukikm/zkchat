# Deposit lifetime

SDK `0.2.0-devnet.20` supports an explicit non-expiring Deposit policy. The
public app uses the fresh `public-devnet-20261025-nonexpiry-v1` deployment:

- Program: `GnVHYANsc3zsYQfU6EBuFbT8v8tHZtd91baGNKJWFkMZ`
- Pool: `DfzSmjTetKSNwAcGPM8Th3k2orQtxT1vZVheWr1YttTX`
- Pool policy: `note_ttl_seconds: "0"`
- Main profile SHA-256: `6a050132ad02df94996521d37337faf13d9a77c979e47fac11742ac65538121a`
- Model profile SHA-256: `c4c74bc9c980c2e2549ea513aa1792b7e94cc00442f1954573cd3791f6843706`
- Browser namespace: `zkchat-sdk-public-devnet-20261025-nonexpiry-v1`
- First note ID: `zkchat-note-sdk-public-devnet-20261025-nonexpiry-v1`

The archive SHA-256 is
`58538cd0e8a566c6b094c1f523e9275a68c640b14f239f2a6ce281728d728e8c`.
The [immutable SDK `.20` prerelease](https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.20)
was published on 2026-10-25 at 09:58 UTC from source commit
`813032cd9070a049c97a81eaa1ca26562416460f`. All seven downloaded assets matched
the reviewed bytes; the release and individual asset attestations passed
verification. The app's pins and publication metadata are recorded in
`vendor/patches/solana-sdk-nonexpiring-devnet.20-activation.json`.

The matching operator services and new admissions were activated on 2026-10-25.
The [public app](https://dzt0611ozdx70.cloudfront.net) was published at 10:50 UTC
and verified at 10:51–10:52 UTC: both authenticated profiles passed SDK preflight,
all 11 CORS checks passed, and the compiled app displayed SDK `.20` and "Service
ready." Deployed file hashes, content types, caching, routing, the local demo
and retained recovery pages also passed. This is public deployment and read-only
acceptance; no funded new-Pool lifecycle or paid inference was performed.

## Behavior

- A zero-TTL Pool requires the canonical max-u64 Note expiry
  `18446744073709551615` and refuses expiry claims. The SDK authenticates both
  manifest and finalized Pool before reporting `depositExpiryPolicy: "none"`
  and `expiry: null`.
- Deposit review omits expiry messaging for a verified non-expiring deployment.
  It does not format the canonical identity value as a distant date.
- Deposits remain available while their balance covers the existing
  authorization cap and the service and note are otherwise usable. Selecting a
  deposit does not renew it, create a note or move funds.
- Withdrawal challenge timing and pending-state restrictions remain in place.
  Quote, authorization and provider-lease expiry are separate and unchanged.
- Finite and legacy deployments retain their expiry/forfeiture warnings. An
  existing Note's expiry is bound into its tree leaf and private signed state.

## Same-Pool recovery across browsers

Save the recovery file when setting up the new Pool. Later deposits, balances,
selection and pending financial operations are encrypted and saved automatically;
the file does not become stale when another deposit is added. To switch browsers,
close the old browser's zkChat tabs, connect the same wallet in the new browser,
and choose the saved recovery file. The backup service must remain available.
Restoring transfers access to the new browser and rejects further operations
from the old owner's binding. Chat history is stored separately and is not
included in deposit recovery.

An interrupted operation can leave a persistent backup lock, including when the
server has already settled a payment. The app identifies this storage error and
offers **Restore access** from the pending payment screen. Close other zkChat
tabs and devices, select the saved recovery file and confirm restoration. This
authenticated transfer preserves encrypted deposit and payment records while
fencing the previous owner. Then use **Resolve payment** to import the verified
settlement. Neither elapsed time nor a server-side `SETTLED` label alone clears
the browser's pending payment. Do not delete lock records or browser data to
bypass recovery.

If the SDK refuses disposal because an operation is still running, the app keeps
the client, subscriptions and backup storage attached until disposal succeeds.
This protects normal reconnect handling; abruptly closing a tab or process can
still require the recovery-file flow above.

The storage namespace belongs to this Pool and must remain stable across future
SDK upgrades for the same Pool. The deployment, Pool, wallet and installed
profile pin must also match. Changing the profile hash is not an automatic
recovery migration. Keep these identities unchanged when updating only SDK/UI
code.

## Previous Pools

This is a fresh prelaunch Pool. Earlier test balances are not transferred to it.
Existing browser records and recovery files are not deleted, relabeled or
rewritten. SDK `.13`–`.19` and the earlier `.20-noexpiry.1` preview keep their
`public-devnet-20261021-state-v1` mapping; `.12` and `.3` recovery runtimes keep
their own original identities. A saved file for another Pool is rejected by the
new-Pool recovery flow.

The protocol policy and operational steps are documented in the companion
`solana-zkapi` repository at `docs/adr/0004-non-expiring-deposits.md` and
`docs/getting-started/non-expiring-deposits.md`.

## Validation

Protocol tests use real request/withdrawal/tree proofs and Vault SBF execution
in LiteSVM. They cover max-expiry deposits, rejection of expiry claims, late
withdrawals, challenge boundaries and compatibility with finite Pools. SDK
tests cover authenticated policy, admission, proof rebuilding and recovery.

App tests cover finite/non-expiring deposit review and storage isolation.
`tests/recoveryStorage.spec.ts` uses separate Chromium contexts with the real
SDK and a mocked encrypted backup service: a file exported before subsequent
deposit and balance changes restores the entire latest catalog, MAX-u64
witnesses and unresolved operations. Wrong Pool/wallet/file/secret attempts are
rejected; the old owner cannot read, write cached state or fall back to retained
local custody. No financial requests are sent. These tests do not replace a
public funded lifecycle acceptance test.

On 2026-10-25 at 09:58 UTC, the same recovery checks also passed against the
hosted `https://d366buuvadnp3.cloudfront.net/recovery/v1` service from two isolated
Chromium contexts using the allowed zkChat production origin and the new Pool's
final identity/profile pin. The bundled app/SDK harness preserved three
synthetic notes, later balance/catalog updates and unresolved operations,
rejected mismatched files, fenced the old owner, and reopened after reload.
All 97 requests were to recovery storage; there were no provider calls or wallet
transactions. Additional checks passed with separate Chromium 156 → Firefox 157
and Chromium 156 → WebKit 27.2 browser instances against the same hosted service
and final Pool identity. Each pair made 97 recovery requests and preserved the
latest catalog, balances, MAX-u64 witnesses and pending operations, rejected
mismatched files, fenced the previous owner and reopened after reload. These
checks verify cross-engine encrypted recovery with synthetic records. They do
not establish a funded wallet lifecycle or testing in the Safari application.

The same assertions are available as an isolated local regression with
`npm run test:recovery:cross-browser`; see
[browser installation and test scope](../tests/fixtures/README.md#cross-browser-deposit-recovery).
