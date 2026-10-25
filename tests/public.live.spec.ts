import { test, expect, type Request } from "@playwright/test";
import { readFile, writeFile } from "node:fs/promises";

test("public browser preflight without custody or financial actions", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ZKCHAT_LIVE_CHECK !== "1",
    "Opt-in read-only public deployment check.",
  );
  test.setTimeout(240_000);
  const observations: unknown[] = [];
  const failures: unknown[] = [];
  const requestFailures: Request[] = [];
  const responseStatuses = new Map<Request, number>();
  const responseReads: Promise<void>[] = [];
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push({ console: msg.text() });
  });
  page.on("requestfailed", (req) => requestFailures.push(req));
  page.on("response", (response) => {
    const req = response.request();
    responseStatuses.set(req, response.status());
    if (response.status() >= 400) {
      failures.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
    }
    if (!response.url().includes("cloudfront.net")) return;
    const observation: {
      path: string;
      status: number;
      rpc: { method?: string; error: unknown; resultType: string } | null;
    } = {
      path: new URL(response.url()).pathname,
      status: response.status(),
      rpc: null,
    };
    observations.push(observation);
    if (req.method() === "POST") {
      responseReads.push(
        response
          .json()
          .then((body) => {
            observation.rpc = {
              method: req.postDataJSON()?.method,
              error: body.error,
              resultType: typeof body.result,
            };
          })
          .catch(() => {}),
      );
    }
  });
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (req.method() === "POST") {
      const method = req.postDataJSON()?.method;
      if (
        ![
          "getGenesisHash",
          "getAccountInfo",
          "getMultipleAccounts",
          "getBlock",
        ].includes(method)
      ) {
        failures.push({ forbiddenRequest: new URL(req.url()).pathname });
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page.getByText("Connection details", { exact: true }).click();
  const button = page.getByRole("button", {
    name: "Check service",
    exact: true,
  });
  await expect(button).toBeEnabled({ timeout: 180_000 });
  await button.click();
  await expect(button).toBeEnabled({ timeout: 90_000 });
  const visibleResult = await page.getByRole("dialog").innerText();
  await Promise.all(responseReads);
  const serviceReady = visibleResult.includes(
    "Service ready. Select a wallet to connect.",
  );
  const installedConfig = JSON.parse(
    await readFile(
      new URL("../public/zkapi-config.json", import.meta.url),
      "utf8",
    ),
  );
  // Read the profile already authenticated by the app; do not fetch or trust
  // another profile solely to explain an otherwise failed network request.
  const verifiedOrigins = await page.evaluate(async (config) => {
    // @ts-expect-error Test-only Vite module.
    const { cachedAppProfile } = await import("/src/lib/publicDeployment.ts");
    const loaded = cachedAppProfile(config);
    return loaded
      ? {
          control: loaded.assets.verifiedManifest.control_api_origin,
          indexer: loaded.profile.indexerOrigin,
        }
      : null;
  }, installedConfig);
  const expectedReaderCancellations: unknown[] = [];
  for (const req of requestFailures) {
    const url = new URL(req.url());
    const failure = {
      path: url.pathname,
      method: req.method(),
      status: responseStatuses.get(req),
      error: req.failure()?.errorText,
    };
    const sdkReadPath =
      (url.origin === verifiedOrigins?.control &&
        ["/zkapi/v1/config", "/zkapi/v1/catalog"].includes(url.pathname)) ||
      (url.origin === verifiedOrigins?.indexer &&
        (url.pathname === "/zkapi/v1/tree/snapshot" ||
          /^\/zkapi\/v1\/tree\/snapshots\/[0-9a-f]{64}\.json$/.test(
            url.pathname,
          )));
    // SDK readers cancel in finally, including after validated EOF. Chromium
    // can report ERR_ABORTED for that cleanup. Exempt only this exact request's
    // HTTP 200 GET after the full preflight/readiness verification succeeded.
    if (
      serviceReady &&
      sdkReadPath &&
      url.protocol === "https:" &&
      !url.username &&
      !url.password &&
      !url.search &&
      !url.hash &&
      failure.method === "GET" &&
      failure.status === 200 &&
      failure.error === "net::ERR_ABORTED"
    ) {
      expectedReaderCancellations.push(failure);
    } else {
      failures.push(failure);
    }
  }
  const report = testInfo.outputPath("public-browser-check.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        observations,
        failures,
        expectedReaderCancellations,
        visibleResult,
      },
      null,
      2,
    ),
  );
  await testInfo.attach("public-browser-check.json", {
    path: report,
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("public-browser-check.png"),
    fullPage: true,
  });
  expect(visibleResult).toContain("Service ready. Select a wallet to connect.");
  expect(failures).toEqual([]);
});

test("public SDK browser factory creates and reopens unfunded custody with no signing", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ZKCHAT_LIVE_CHECK !== "1",
    "Opt-in real SDK and public-service check.",
  );
  test.setTimeout(240_000);
  const blocked: string[] = [];
  await page.route("**/*", async (route) => {
    const req = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(req.method())) {
      let method: string | undefined;
      try {
        method = req.postDataJSON()?.method;
      } catch {}
      if (
        req.method() !== "POST" ||
        ![
          "getGenesisHash",
          "getAccountInfo",
          "getMultipleAccounts",
          "getBlock",
        ].includes(method ?? "")
      ) {
        blocked.push(new URL(req.url()).pathname);
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  await page.goto("/");
  await page.evaluate(async () => {
    // @ts-expect-error Test-only Vite module; signer always throws.
    const { registerTestWallet } = await import("/tests/walletHarness.ts");
    registerTestWallet();
  });
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select wallet", exact: true }),
  ).toBeEnabled({ timeout: 180_000 });
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Create new deposits",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 90_000 });
  await page
    .getByRole("button", {
      name: "Create new deposits",
      exact: true,
    })
    .click();
  await expect(page.locator(".topbar-status")).toHaveText("Wallet connected", {
    timeout: 90_000,
  });
  await expect(
    page.getByRole("button", { name: "Download recovery file", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.locator(".topbar-status")).toHaveText("Wallet connected", {
    timeout: 90_000,
  });
  await expect(
    page.getByRole("button", {
      name: "Create new deposits",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(blocked).toEqual([]);
  const report = testInfo.outputPath("public-browser-custody.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sdk: "0.2.0-devnet.19",
        result: "initialized and reopened",
        blocked,
        visibleResult: await page.getByRole("dialog").innerText(),
        scope:
          "Real published SDK, public profile, public services, bundled Worker/WASM and IndexedDB in isolated Chromium. Fixture Wallet Standard account cannot sign. No deposit, AUTH or inference. Not a Phantom or funded-lifecycle success.",
      },
      null,
      2,
    ) + "\n",
  );
  await testInfo.attach("public-browser-custody.json", {
    path: report,
    contentType: "application/json",
  });
  await page.screenshot({
    path: testInfo.outputPath("public-browser-custody.png"),
    fullPage: true,
  });
});

test("public app requires backup before preparing a deposit", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ZKCHAT_LIVE_CHECK !== "1",
    "Opt-in app backup guard check with the published SDK and an isolated fixture wallet.",
  );
  test.setTimeout(240_000);
  const blocked: string[] = [];
  const serviceErrors: { path: string; status: number }[] = [];
  page.on("response", (response) => {
    if (response.status() >= 400 && response.url().includes("cloudfront.net"))
      serviceErrors.push({
        path: new URL(response.url()).pathname,
        status: response.status(),
      });
  });
  await page.route("**/*", async (route) => {
    const request = route.request();
    if (!["GET", "HEAD", "OPTIONS"].includes(request.method())) {
      let method: string | undefined;
      try {
        method = request.postDataJSON()?.method;
      } catch {}
      if (
        request.method() !== "POST" ||
        ![
          "getGenesisHash",
          "getAccountInfo",
          "getMultipleAccounts",
          "getBlock",
        ].includes(method ?? "")
      ) {
        blocked.push(new URL(request.url()).pathname);
        await route.abort();
        return;
      }
    }
    await route.continue();
  });
  // Keep this SDK fixture independent of app HMR and any page wallet state.
  await page.route("**/__deposit-backup-guard-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Isolated deposit backup guard</title>",
    }),
  );
  await page.goto("/__deposit-backup-guard-harness");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Test-only Vite module; signer always throws.
    const { registerTestWallet } = await import("/tests/walletHarness.ts");
    const {
      loadConfig,
      listWallets,
      connectWalletAccount,
      connectZkapi,
      RecoveryError,
    } =
      // @ts-expect-error Vite source module in Playwright's fresh browser context.
      await import("/src/lib/zkapi.ts");
    const unregister = registerTestWallet();
    const wallet = listWallets().find(
      (candidate: { name: string }) =>
        candidate.name === "Integration Test Wallet",
    );
    const account = await connectWalletAccount(wallet);
    const config = await loadConfig();
    const handle = await connectZkapi(config, wallet, account, true);
    const started = performance.now();
    try {
      const before = await handle.client.status();
      let blockedByBackup = false;
      let errorName: string | null = null;
      try {
        // The app must reject new funding until the user has saved a recovery
        // file. Do not bypass that guard or write a backup to the public service.
        await handle.client.prepareDeposit("2000000");
      } catch (error) {
        blockedByBackup =
          error instanceof RecoveryError &&
          error.message ===
            "Save your recovery file and enable backup before depositing.";
        errorName = error instanceof Error ? error.name : "UnknownError";
      }
      const after = await handle.client.status();
      return {
        blockedByBackup,
        errorName,
        recoveryEnabled: handle.recoveryEnabled,
        elapsedMs: performance.now() - started,
        before: {
          wallet: before.wallet,
          balance: before.settledBalanceMicroUsdc,
          hasWalletOperation: before.walletOperation !== null,
        },
        after: {
          wallet: after.wallet,
          balance: after.settledBalanceMicroUsdc,
          hasWalletOperation: after.walletOperation !== null,
        },
      };
    } finally {
      handle.dispose();
      unregister();
    }
  });
  const report = testInfo.outputPath(
    "public-browser-deposit-backup-guard.json",
  );
  await writeFile(
    report,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sdk: "0.2.0-devnet.19",
        result,
        blocked,
        serviceErrors,
        scope:
          "Real published SDK and verified public profile/services in isolated Chromium. Checks the app's required-backup guard and unchanged empty deposit state; does not generate a deposit proof or construct a transaction. Public mutation requests are blocked. Fixture wallet cannot sign; no backup enrollment, advance, broadcast, AUTH or inference. No user wallet or funds are accessed. Real proof generation is covered separately by the SDK's prover-browser and wallet-integration fixtures.",
      },
      null,
      2,
    ) + "\n",
  );
  await testInfo.attach("public-browser-deposit-backup-guard.json", {
    path: report,
    contentType: "application/json",
  });
  expect(blocked).toEqual([]);
  expect(result).toMatchObject({
    blockedByBackup: true,
    errorName: "RecoveryError",
    recoveryEnabled: false,
    before: { wallet: "empty", balance: "0", hasWalletOperation: false },
    after: { wallet: "empty", balance: "0", hasWalletOperation: false },
  });
});
