# Recoverable deposits — 2026-10-25

zkChat uses the published **0.2.0-devnet.18** SDK. The SDK was committed and
pushed to `main`, the encrypted recovery service was deployed, and the immutable
GitHub release was published and verified before app integration began.

- Release: <https://github.com/yukikm/solana-zkapi/releases/tag/v0.2.0-devnet.18>
- Source: `fa51467cc9ab3849e56ac4de29adce5568d99e4e`
- SDK archive SHA-256: `027a64e110286ea425b9d2d4333d956c9a3d5ebf0a2d7efc140a86375e8ea503`
- SDK distribution remains the official release tarball, not the npm registry.
- [Release and public-service verification](evidence/sdk-recovery-release-20261025.json)

## User flow

Before a new deposit, save the recovery file separately and confirm that it has
been saved. Existing deposit owners can enable recovery from Wallet & balance;
chat and withdrawal remain available before enrollment. Once enabled, further
deposits and payment progress use the same automatically updated encrypted
backup. Faucet links remain available throughout setup.

After losing browser data, connect the same wallet, choose **Restore deposits
from a recovery file**, and upload the saved file. Stop the previous browser or
device first. Restoration moves access to this browser; concurrent use on
multiple devices is not supported. The file is private and must be kept safely.

Interrupted enrollment offers **Finish recovery setup** with the same file and
original browser data. A partially copied backup never becomes usable custody.
The app restores the deposit catalog, selected deposit, and financial journals;
chat history is separate and is not in this backup.

## Integration boundary

The app independently pins the backup service and authenticates its installed
deployment profile. A file cannot select another endpoint, Pool, profile, or
wallet. The existing current-Pool storage namespace is preserved. The original
`.12` and `.3` recovery pages retain their original SDK and data; this feature
does not revive their retired services.

Enrollment stops the local client, holds the deposit catalog lock, records an
encrypted intent in the original custody, and copies every financial journal
with the SDK's validated `copyTo`. Original financial bytes are retained. An
encrypted completion record is committed only after the catalog and notes have
been copied. A saved binding or intent prevents fallback to the stale local
copy, including when opening the remote backup fails. Interrupted setup is
resumable with the same file.

Both the selected note client and the catalog use the SDK's authoritative
remote encrypted storage. Journal changes must be durably saved before the SDK
performs the corresponding external financial action. Restoration preserves
pending requests, signed transactions, revisions, and normal SDK recovery
gates; it never automatically submits a payment or sends a chat message.

## Limits

The recovery file supplies the private recovery key; the recovery service holds
the encrypted deposit data. Both are needed. The service cannot decrypt notes,
but is trusted for freshness, durability, and availability. This is not an
offline, self-contained exit mechanism. Losing the file and all device state,
deleting data before enrollment, retired services, and expired deposits are not
repaired by this feature. The same expiry and withdrawal rules still apply.

## Verification

The released SDK passed 601 tests, 12 recovery-service tests, and an independent
installation test of the actual tarball (346 lifecycle/trust cases plus a
data-loss recovery case). Real Chromium origin-data deletion and fresh Node.js
process/directory restoration passed. The published service also passed the
installed SDK's synthetic Node data-loss test and real-browser CORS checks.

App verification covers initial setup, additional deposits, restoring a file,
interrupted setup, preservation of original custody, and rejecting unrelated
backup files. Final app results and deployment evidence are recorded alongside
the release receipt. These tests use synthetic financial state; no user wallet
signatures, transfers, or paid inference are performed by verification.

Final app verification passed **422 unit tests and 101 browser tests**. Three
opt-in public-service cases were excluded from the offline browser run; the
released SDK’s independent public preflight passed separately. The browser run
includes the actual SDK and IndexedDB erasure/restore test, plus the installed
WASM’s signed-receipt validation. All three production builds and CloudFront
routing checks passed. [App test receipt](evidence/recovery-backup-ux-20261025.json).

## Publication

App source `a6e24f02e8522194853a4e148610f07a294fba0c` was committed and pushed
to `main`, then published to <https://dzt0611ozdx70.cloudfront.net/>. The
existing ACTIVE/FREE distribution was verified, old assets were retained, and
CloudFront invalidation `I81JQQ6AKBGVJKJDE8D2O72EKD` completed. The upload
contained 442 files / 28,253,014 bytes.

[Deployed checks](evidence/deployment-backup-20261025.json) passed: 27 file
SHA/MIME/cache checks, 9 routing checks, 15 retained assets, demo behavior, and
same-origin navigation to both original recovery runtimes. The previous six
HTML/config entries were saved locally for rollback before publication.

The [production browser recovery smoke](evidence/public-backup-restore-20261025.json)
also passed against the actual published app, SDK `.18`, and live recovery
service. A generated unfunded test wallet saved its file and enabled backup;
the isolated browser's entire origin data was erased and verified empty before
loading the app again. The same file restored the zero-balance deposit screen.
Wallet signatures, deposits, AUTH, paid inference, and transfers were all zero.
The recovery file was kept only in test-process memory and is not in evidence.
