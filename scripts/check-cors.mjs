import { readFile, writeFile } from "node:fs/promises";
import { loadPublicDeploymentProfile } from "@zkapi/solana-sdk/public-profile";

// OPTIONS only on financial routes. UUIDs are route-shape placeholders,
// never an existing session and never submitted as AUTH or inference.
const session = "00000000-0000-4000-8000-000000000000";
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
const indexer = loaded.profile.indexerOrigin;
const routes = [
  [loaded.profile.rpcUrl, "POST", ["content-type"]],
  [control + "/zkapi/v1/quotes", "POST", ["content-type"]],
  [control + "/zkapi/v1/sessions", "POST", ["authorization", "content-type"]],
  [
    control + "/zkapi/v1/sessions/retire",
    "POST",
    ["authorization", "content-type"],
  ],
  [control + `/zkapi/v1/sessions/${session}`, "GET", ["authorization"]],
  [
    control + `/zkapi/v1/sessions/${session}/close`,
    "POST",
    ["authorization", "content-type"],
  ],
  [
    control + `/zkapi/v1/sessions/${session}/receipts`,
    "GET",
    ["authorization"],
  ],
  [control + "/zkapi/v1/withdraw/clearance", "POST", ["content-type"]],
  [control + "/zkapi/v1/readiness", "GET", []],
  [indexer + "/zkapi/v1/tree/root", "GET", []],
  [indexer + "/zkapi/v1/tree/snapshot", "GET", []],
];
const checks = [];
for (const [endpoint, method, headers] of routes) {
  try {
    const response = await fetch(endpoint, {
      method: "OPTIONS",
      headers: {
        Origin: origin,
        "Access-Control-Request-Method": method,
        ...(headers.length
          ? { "Access-Control-Request-Headers": headers.join(", ") }
          : {}),
      },
      redirect: "error",
      credentials: "omit",
      signal: AbortSignal.timeout(15000),
    });
    const allowOrigin = response.headers.get("access-control-allow-origin");
    const allowMethods = (
      response.headers.get("access-control-allow-methods") ?? ""
    )
      .split(",")
      .map((v) => v.trim().toUpperCase());
    const allowHeaders = (
      response.headers.get("access-control-allow-headers") ?? ""
    )
      .split(",")
      .map((v) => v.trim().toLowerCase());
    const allowed =
      response.ok &&
      (allowOrigin === origin || allowOrigin === "*") &&
      allowMethods.includes(method) &&
      headers.every((header) => allowHeaders.includes(header));
    await response.body?.cancel();
    checks.push({
      endpoint: new URL(endpoint).pathname,
      method,
      requestedHeaders: headers,
      status: response.status,
      allowOrigin,
      allowMethods,
      allowHeaders,
      allowed,
    });
  } catch {
    checks.push({
      endpoint: new URL(endpoint).pathname,
      method,
      allowed: false,
      error: "OPTIONS unavailable",
    });
  }
}
const report = {
  observedAt: new Date().toISOString(),
  origin,
  profileSha256: config.profileSha256,
  checks,
  scope:
    "Authenticated profile loading and exact-origin OPTIONS only. No wallet, quote, AUTH, inference or transaction. CORS permission is not financial-route acceptance.",
};
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[3]) await writeFile(process.argv[3], json);
console.log(json);
if (checks.some((check) => !check.allowed)) process.exitCode = 1;
