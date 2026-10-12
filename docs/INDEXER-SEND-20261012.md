# First-send indexer failure

2026-10-12 JST. Published as v0.1.3 to the existing public origin.

## Finding

The reported message maps to the SDK's exact `finalized indexer unavailable`
exception. The current SDK throws this when an indexer GET returns a non-2xx
response. Public preflight failures are wrapped and shown differently, so this
message identifies the later runtime chain read, rather than the admission check.

The app already retries a transient failure during the read-only preflight. After
that check, the SDK independently fetches the shared snapshot for authorization.
That fetch previously failed immediately on any non-2xx response. Another Send
could succeed if the service recovered between attempts; the code does not
require the first send to fail.

Local upstream source explains how readiness and a later snapshot can disagree:
readiness probes `/tree/root` and caches its observation for five seconds. The
indexer temporarily withdraws availability during refresh, waits for a verified
cut, and can return 503 after a refresh failure or bounded wait expiry. The exact
deployed backend revision and the HTTP response from the user's failing send
were not captured, so the specific upstream incident remains unconfirmed.

Read-only live probes are saved in
[indexer-first-send-20261012.json](evidence/indexer-first-send-20261012.json).
All three full public SDK preflights passed. Completed descriptor GETs varied
from 169 ms to 18.6 seconds and returned HTTP 200. One diagnostic request used a
shorter 15-second deadline and timed out; this is not evidence that the app's
60-second deadline expired. The reported HTTP failure was not reproduced.

## Change

The current public SDK's existing fetch transport is wrapped only for GETs to
the pinned indexer origin's shared snapshot descriptor and digest-addressed JSON.
HTTP 429/502/503/504 or a fetch network error gets one retry after 2.5 seconds.
A longer `Retry-After` is honored up to ten seconds; values beyond that return
the failure rather than retrying early. The original SDK deadline is retained,
and Stop also interrupts the read or retry wait.

No entire chat operation, quote, AUTH, inference, RPC or transaction is retried.
Successful HTTP responses still go through the SDK's digest, schema, membership
and finalized-chain verification; validation failures are not retried. The `.3`
recovery transport, profile pins and custody identifiers are unchanged. A
persistent outage still produces the existing Check status guidance.

## Verification

- App integration tests cover recovery, persistent 503 and Stop within one chat
  call; inference proceeds once only after a successful read.
- Fetch tests cover URL/method restrictions, bounded retries, Retry-After,
  response cleanup, signals and unchanged validation inputs.
- Type checking, the current and recovery builds, SDK archive hash checks and
  all 282 unit tests passed with Node 24.19.0.
- The built app and recovery navigation passed in an isolated installed Chrome
  session. The default Playwright Chromium binary was missing; no user browser
  profile or wallet was used.
- Release verification passed all 67 offline browser tests; three live-network
  tests were skipped. Four initial browser-context teardown failures were caused
  by disk exhaustion while writing traces. Those four passed when rerun with one
  worker and tracing disabled. Local CloudFront routing checks also passed.
- No live inference, authorization, wallet signature or transaction was sent.

## Publication

The existing `zkchat-static` stack received 272 files (13,050,169 bytes) at
`https://dzt0611ozdx70.cloudfront.net`. CloudFront invalidation
`IE0TXO2ZTGUUBMLB6PK93YGGOH` completed. The deployment verification checked
18 file hashes/MIME/cache policies, six routing cases, ten retained assets,
and isolated demo/recovery navigation with the original storage origin.
See [deployment evidence](evidence/deployment-indexer-retry-20261012.json).

Open tabs need to load the new entry via `Reload app` or a page reload after
active operations finish. Publication does not automatically replay failed chats
or establish that an upstream outage has ended.
