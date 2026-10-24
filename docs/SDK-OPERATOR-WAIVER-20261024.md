# Local recovery preview — 2026-10-24

SDK `0.2.0-devnet.16` is a local patch candidate based on upstream commit
`94e4969f3169bfc790fc6f4186fc2bf94dbe074a`; it is not a published GitHub release.
The app labels it as a local recovery preview and links to that existing source
base. This preview is now deployed to the public app; that deployment is separate
from a GitHub release. The original payment has been settled and recovered in the
user's browser, as recorded below.

This patch accepts a direct OpenRouter `waived_unknown` receipt only when it has
the signed operator-approval digest, `UNKNOWN_OPERATOR_LOSS`, a zero user charge,
unknown observed usage and operator loss (`null`), unknown provider USD (`null`),
empty usage, and no operation or provider request ID. It does not turn unknown
issuance into `not_dispatched` or unknown usage into zero. The normal receipt
signature, tariff, session, cap, signed successor, and history checks still run.
The backend signer separately validates the immutable signed operator approval.

The current app selects the new verifier only for the exact reviewed profile,
deployment, Pool, and original verifier hash. Its independently bundled bytes are
hashed before Worker initialization. The authenticated profile, financial
manifest, custody identity, storage name, and note IDs retain their original
values. The `.12` and `.3` recovery builds retain their original SDK and verifier.

| Artifact | SHA-256 |
| --- | --- |
| Local SDK archive `vendor/zkapi-solana-sdk-0.2.0-devnet.16.tgz` | `29b8f521a95e99d2fd7aae11d6abdb728229a712d5cd4b967e857daaa1449d07` |
| New local verifier | `395465e39aef68ff1e9fd3167cb80d03a653bab09a54c83c18cbf8df06c60d84` |
| Unchanged authenticated profile | `5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a` |
| Original profile verifier | `c06a247e1ff88f1ac415ea127bcf49d486b5b4954715cdf00f133b5ac71c1f30` |

The new verifier's license and provenance index is
`public/verifier-notices/CURRENT-RUNTIME.json`. Original notice bytes are retained;
their original bundle provenance is not presented as provenance for the new build.

Local verification includes:

- Shared Rust receipt validation and a real proof/signed-successor fixture in the
  native companion verifier, including altered cap, request, signature, charge,
  duplicate receipt, missing digest, and invalid successor failures.
- The same signed fixture through the built WASM verifier, then an authentic
  released `.15` encrypted journal read and settled by `.16`. Rejected receipts
  preserve both journal state and ciphertext revision; accepted receipts commit
  the signed successor and clear pending state atomically.
- Chromium with the actual Worker, bundled WASM, and IndexedDB journal. The test
  reopens the committed record and verifies failure preservation, unchanged
  balance, and retained unknown usage. Its network fixture permits status and
  receipt GETs only; it never replays AUTH, inference, or a withdrawal.
- SDK archive/runtime hashes, current and historical storage compatibility,
  recovery UI behavior, and all three production builds with CloudFront routing
  emulation.

Run the app checks with `npm run verify:sdk`, `npm run typecheck`, `npm test`,
`npx playwright test tests/paymentRecovery.spec.ts tests/waiverVerifier.spec.ts
--workers=1`, `npm run build`, `node scripts/check-build.mjs`, and
`npm run check:aws`. The upstream fixture-generation and real WASM commands are
documented in `docs/releases/direct-waiver-preview.md` in the source checkout.

These fixtures use public test keys and isolated browser storage. They prove the
validation and journal transition; the live outcome was checked separately.

## Deployment and original payment recovery

The app was published and its CloudFront invalidation completed on 2026-10-24.
The [13:19 JST deployment check](evidence/deployment-sdk16-preview-20261024.json)
passed for the current app, both historical recovery builds, routing, same-origin
storage, and retained old assets. The [deployed verifier check](evidence/deployed-waiver-verifier-20261024.json)
confirmed the exact WASM hash above, 3,929,040 bytes, `application/wasm`, and
immutable caching. These deployment checks themselves did not access user data
or perform financial operations.

Backend migration 5 preserved the original financial records. The first operator
CLI attempt refused an existing numeric representation before changing financial
state. After canonical numeric parsing was fixed and tested, all three backend
binaries were deployed from source manifest
`5d7828512bddcb392f7cad597576314034b527ea9ed9acbd4becfa959f127528`.
Original profile, keys, claims, and signer journal were retained.

The explicit signed operator approval then settled the original session with a
zero user charge, one receipt, and a signed settlement. The original AUTH
reservation remains; no provider issuance was replayed and no withdrawal was
started. Provider usage remains unknown, with any unknown cost accepted by the
operator. Backend audit summaries remain in the upstream checkout's ignored
`target/direct-waiver-20261024-r2/` directory.

In the original browser, `Check payment` accepted the signed successor and showed
`Ready to chat`, a 2.00 USDC balance, and `This payment is no longer pending. No
message was resent.` A new, unique test message was then sent explicitly.
`openai/gpt-4o-mini` replied `チャットを再開できました。` over the direct route.
After `Settle charges`, the new session also reached `SETTLED` with a signed
settlement and zero user charge. This was normal metered settlement:
`metered` / `OPENROUTER_USAGE`, with `provider_reported_usd`,
`observed_nano_usdc`, and `operator_loss_nano_usdc` all equal to the string `"0"`.
The session had activated and recorded a provider key reference, with one
issuance attempt and no unquiesced attempts. A GET for that key after close
returned 404.

The browser showed the reply, `Settled · 0.00 USDC`, `Ready to chat`, and a
2.00 USDC balance. The final backend audit is retained in the upstream checkout's
ignored `target/direct-waiver-20261024-r2/final-audit-summary.json`; it also
confirmed preservation of original ledger records, claims and signer history,
and successful signer reconciliation.

After a full page reload and reconnecting the same wallet, the saved deposit
reopened at 2.00 USDC with `Ready to chat` and no pending payment. Reopening the
test conversation retained both the response and `Settled · 0.00 USDC`.
The [completion evidence](evidence/payment-recovery-complete-20261024.json)
records these final checks without wallet addresses or session identifiers.

The new receipt records zero usage at the provider observation used for
settlement. An additional daily Activity query returned HTTP 400 and was
inconclusive, so this is not an independent confirmation of the provider's final
bill. The original incident remains an explicit unknown-cost operator waiver,
not a zero-usage observation. See the [incident chronology](INCIDENT-PAYMENT-20261024.md).
