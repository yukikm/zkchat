# Reply interruption diagnostics

2026-10-12 JST.

The public app displayed an empty assistant reply with `Reply interrupted`.
The connection screen subsequently showed `Payment checked` and `Ready to chat`.
Those observations do not establish why the reply failed or whether the failed
reply incurred a charge. The original exception code was not retained, so this
incident cannot be retrospectively classified from the saved message.

## Change

The app now distinguishes the SDK's three redacted `ChatResponseError` codes:

- `incomplete_stream`: response completion could not be confirmed.
- `invalid_response`: the response could not be validated.
- `http_error`: the provider HTTP status, when it is an integer from 400 to 599.

Recognized provider guidance still takes precedence. Unknown exceptions retain
the generic message. Provider bodies, arbitrary exception messages, credentials
and operation IDs are not displayed. Every failure retains the instruction to
check status before sending again; no request or transaction is automatically
resent. Existing saved error messages are not reclassified.

This is a diagnostic improvement, not a confirmed fix for the live interruption.
SDK `.12`, the original profile and custody, and the `.3` recovery route remain
unchanged.

## Verification

- Node 24.19.0; all 226 unit tests passed.
- Six relevant browser tests passed, covering partial-stream failure, early
  request failure, provider errors, terminal SSE/EOF and Stop without replay.
- Type checking, both production builds, archive hashes, local build/routing
  checks, formatting and `git diff --check` passed.
- The default Playwright browser download timed out. Browser checks used the
  installed Google Chrome through an isolated `channel: "chrome"` context,
  without the user's browser data or wallet.
- No live inference, financial transaction or wallet signature was submitted
  during this change.

Published-file verification is recorded in
[`evidence/deployment-reply-diagnostics-20261012.json`](evidence/deployment-reply-diagnostics-20261012.json).
