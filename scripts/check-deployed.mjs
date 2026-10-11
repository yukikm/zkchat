import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { readFile, readdir, writeFile } from "node:fs/promises";
import { extname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { parseArgs } from "node:util";
import { chromium, expect } from "@playwright/test";

// Read-only release check. Uses a new browser context with a null config fixture
// and blocks every external request, so no user's storage or wallet is touched.
const { values } = parseArgs({
  options: {
    origin: { type: "string" },
    sdk: { type: "string" },
    baseline: { type: "string" },
    output: { type: "string" },
  },
});
assert(values.origin, "--origin is required");
assert(values.sdk, "--sdk is required (the expected main SDK version)");
const site = new URL(values.origin);
assert.equal(site.protocol, "https:", "Use the HTTPS production origin");
assert.equal(site.href, `${site.origin}/`, "--origin must have no path/query");
const origin = site.origin;
const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const mutableCache = "public,max-age=0,s-maxage=60,must-revalidate";
const immutableCache = "public,max-age=31536000,immutable";
const expectedTypes = {
  ".html": /^text\/html(?:;|$)/,
  ".json": /^application\/json(?:;|$)/,
  ".js": /^(?:application|text)\/javascript(?:;|$)/,
  ".css": /^text\/css(?:;|$)/,
  ".txt": /^text\/plain(?:;|$)/,
};
const sha256 = (bytes) => createHash("sha256").update(bytes).digest("hex");
async function request(path, options = {}) {
  return fetch(new URL(path, origin), {
    signal: AbortSignal.timeout(30000),
    redirect: "manual",
    ...options,
  });
}
async function asset(path) {
  assert(path.startsWith("/") && !path.startsWith("//"));
  const response = await request(path);
  assert.equal(response.status, 200, `${path} HTTP status`);
  const bytes = Buffer.from(await response.arrayBuffer());
  const type = response.headers.get("content-type") ?? "";
  const cache = response.headers.get("cache-control");
  assert.match(type, expectedTypes[extname(path)], `${path} MIME`);
  assert.equal(
    cache,
    path.includes("/assets/") ? immutableCache : mutableCache,
    `${path} cache policy`,
  );
  return { path, sha256: sha256(bytes), bytes: bytes.length, type, cache };
}

const checks = [];
for (const base of ["/", "/recovery-v3/"]) {
  const html = await readFile(resolve(dist, `.${base}index.html`), "utf8");
  const paths = new Set([
    `${base}index.html`,
    `${base}zkapi-config.json`,
    `${base}THIRD-PARTY-NOTICES.json`,
    `${base}THIRD-PARTY-NOTICES.txt`,
    ...[...html.matchAll(/(?:src|href)="([^"]+\.(?:js|css))"/g)].map(
      ([, path]) => {
        const url = new URL(path, `${origin}${base}`);
        assert.equal(url.origin, origin, "Entry assets must be same-origin");
        return url.pathname;
      },
    ),
  ]);
  const workers = (await readdir(resolve(dist, `.${base}assets`))).filter(
    (name) => /^prover\.worker-.*\.js$/.test(name),
  );
  assert(workers.length > 0, `${base} must have a module worker`);
  for (const worker of workers) paths.add(`${base}assets/${worker}`);
  const results = await Promise.all(
    [...paths].sort().map(async (path) => {
      const local = await readFile(resolve(dist, `.${path}`));
      const result = await asset(path);
      assert.equal(result.sha256, sha256(local), `${path} deployed bytes`);
      return result;
    }),
  );
  checks.push(...results);
  const entry = await request(base);
  assert.equal(entry.status, 200, `${base} directory entry`);
  assert.equal(await entry.text(), html, `${base} directory rewrite`);
}

const routing = [];
const redirectPath = "/recovery-v3?source=old%20deposit&source=second";
const recoveryRedirect = await request(redirectPath);
assert.equal(recoveryRedirect.status, 301);
assert.equal(
  recoveryRedirect.headers.get("location"),
  "/recovery-v3/?source=old%20deposit&source=second",
);
routing.push({ path: redirectPath, status: 301, queryPreserved: true });
const http = await fetch(`http://${site.host}/`, {
  redirect: "manual",
  signal: AbortSignal.timeout(30000),
});
assert([301, 302, 307, 308].includes(http.status), "HTTP redirects to HTTPS");
assert.equal(new URL(http.headers.get("location")).origin, origin);
routing.push({
  path: `http://${site.host}/`,
  status: http.status,
  https: true,
});
for (const base of ["/", "/recovery-v3/"]) {
  for (const name of [
    "assets/release-check-missing.js",
    "release-check-missing.json",
  ]) {
    const path = `${base}${name}`;
    const response = await request(path);
    assert([403, 404].includes(response.status), `${path} must be absent`);
    assert.doesNotMatch(
      response.headers.get("content-type") ?? "",
      /text\/html/,
      `${path} must not return an HTML fallback`,
    );
    routing.push({ path, status: response.status, noHtmlFallback: true });
  }
}

let baseline;
const retainedAssets = [];
if (values.baseline) {
  baseline = JSON.parse(await readFile(resolve(values.baseline), "utf8"));
  assert.equal(baseline.origin, origin, "Baseline must belong to this origin");
  const oldAssets = baseline.checks.filter(
    (entry) => entry.path.includes("/assets/") && entry.sha256,
  );
  assert(oldAssets.length > 0, "Baseline must contain asset hashes");
  retainedAssets.push(
    ...(await Promise.all(
      oldAssets.map(async (entry) => {
        const result = await asset(entry.path);
        assert.equal(
          result.sha256,
          entry.sha256,
          `${entry.path} retained bytes`,
        );
        return { ...result, oldAssetRetained: true };
      }),
    )),
  );
}

const pageErrors = [];
const blockedExternalRequests = [];
let browser;
try {
  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "block" });
  context.setDefaultTimeout(20000);
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) {
      blockedExternalRequests.push(url.origin);
      return route.abort();
    }
    if (url.pathname.endsWith("/zkapi-config.json"))
      return route.fulfill({ json: null });
    if (route.request().method() !== "GET") return route.abort();
    return route.continue();
  });
  const page = await context.newPage();
  page.on("pageerror", (error) => pageErrors.push(error.message));
  assert.equal((await page.goto(origin)).status(), 200);
  await page.evaluate(() =>
    localStorage.setItem("deployment-recovery-sentinel", "preserved"),
  );
  await page.getByRole("button", { name: "Try the demo", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Release verification demo");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Demo reply · No AI request or payment",
  );
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(`SDK ${values.sdk}`);
  await page.getByText("Have an older deposit?", { exact: true }).click();
  await page.getByRole("link", { name: "Recover an older deposit" }).click();
  await page.waitForURL(`${origin}/recovery-v3/`);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText("SDK 0.2.0-devnet.3");
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("deployment-recovery-sentinel"),
    ),
    "preserved",
  );
  assert.deepEqual(pageErrors, []);
} finally {
  await browser?.close();
}

const evidence = {
  observedAt: new Date().toISOString(),
  origin,
  sdk: values.sdk,
  checks,
  routing,
  baselineObservedAt: baseline?.observedAt,
  retainedAssets,
  browser: {
    demo: true,
    currentSdk: true,
    legacyRecovery: true,
    sameOriginStorageSentinel: true,
    configFixture: null,
    externalRequestsBlocked: true,
    blockedExternalRequests,
    pageErrors,
  },
  scope:
    "Public files and isolated browser demo/recovery with external requests blocked. No user browser data, wallet, AUTH, inference or financial changes.",
};
if (values.output)
  await writeFile(
    resolve(values.output),
    `${JSON.stringify(evidence, null, 2)}\n`,
  );
console.log(
  `Deployment passed: ${checks.length} file SHA/MIME/cache checks, ${routing.length} routing checks, ${retainedAssets.length} retained assets, demo and same-origin recovery.`,
);
