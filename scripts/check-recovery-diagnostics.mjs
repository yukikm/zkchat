import { readFile, writeFile } from "node:fs/promises";
import { loadPublicDeploymentProfile } from "@zkapi/solana-sdk/public-profile";

// Read-only GETs for a nonexistent session with a deliberately fake credential.
// The gateway validates the opt-in before forwarding to control: an invalid
// value must be rejected rather than silently stripped by an intermediary.
const session = "00000000-0000-4000-8000-000000000000";
const fakeAuthorization = `Bearer zkc1.${session}.${"A".repeat(43)}`;
const origin = process.argv[2] ?? "http://localhost:5173";
const url = new URL(origin);
if (!["http:", "https:"].includes(url.protocol) || url.origin !== origin)
  throw new Error("Supply an exact app origin.");
const config = JSON.parse(
  await readFile(
    new URL("../public/zkapi-config.json", import.meta.url),
    "utf8",
  ),
);
const loaded = await loadPublicDeploymentProfile(config.profileUrl, {
  profileSha256: config.profileSha256,
});
const control = loaded.assets.verifiedManifest.control_api_origin;
const checks = [];
for (const [diagnostic, expectedStatus] of [
  [null, 404],
  ["1", 404],
  ["2", 400],
]) {
  try {
    const response = await fetch(control + `/zkapi/v1/sessions/${session}`, {
      method: "GET",
      headers: {
        Origin: origin,
        Authorization: fakeAuthorization,
        ...(diagnostic === null
          ? {}
          : { "X-Zkapi-Recovery-Diagnostics": diagnostic }),
      },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    const body = await response.json().catch(() => null);
    const invalidValueRejected =
      response.status === 400 &&
      body?.error === "local acceptance request refused";
    checks.push({
      diagnostic,
      expectedStatus,
      status: response.status,
      invalidValueRejected,
      passed:
        response.status === expectedStatus &&
        (diagnostic !== "2" || invalidValueRejected),
    });
  } catch {
    checks.push({ diagnostic, expectedStatus, status: null, passed: false });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  origin,
  profileSha256: config.profileSha256,
  checks,
  passed: checks.every((check) => check.passed),
  scope:
    "Verified profile loading and read-only GETs for a nonexistent session with a fake credential. Checks public gateway diagnostic-header forwarding only. No real session credentials, wallet, AUTH creation, recovery, inference or transaction. Does not verify an authenticated recovery payload or payment settlement.",
};
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[3]) await writeFile(process.argv[3], json);
console.log(json);
if (!report.passed) process.exitCode = 1;
