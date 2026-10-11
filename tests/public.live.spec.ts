import { test, expect } from "@playwright/test";
import { writeFile } from "node:fs/promises";

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
  page.on("console", (msg) => {
    if (msg.type() === "error") failures.push({ console: msg.text() });
  });
  page.on("requestfailed", (req) =>
    failures.push({
      path: new URL(req.url()).pathname,
      error: req.failure()?.errorText,
    }),
  );
  page.on("response", async (response) => {
    if (!response.url().includes("cloudfront.net")) return;
    const req = response.request();
    let rpc = null;
    if (req.method() === "POST") {
      try {
        const body = await response.json();
        rpc = {
          method: req.postDataJSON()?.method,
          error: body.error,
          resultType: typeof body.result,
        };
      } catch {}
    }
    observations.push({
      path: new URL(response.url()).pathname,
      status: response.status(),
      rpc,
    });
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
    .getByRole("button", { name: "Connection settings", exact: true })
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
  const report = testInfo.outputPath("public-browser-check.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        timestamp: new Date().toISOString(),
        observations,
        failures,
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
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Select wallet", exact: true }),
  ).toBeEnabled({ timeout: 180_000 });
  await page
    .getByRole("dialog", { name: "Connection settings" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Set up this wallet",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 90_000 });
  await page
    .getByRole("button", {
      name: "Set up this wallet",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Wallet connected.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Connection settings" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByText("Wallet connected.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", {
      name: "Set up this wallet",
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
        sdk: "0.2.0-devnet.10",
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

test("public SDK prepares an inline deposit before any signing", async ({
  page,
}, testInfo) => {
  test.skip(
    process.env.ZKCHAT_LIVE_CHECK !== "1",
    "Opt-in public-service deposit preparation with an isolated fixture wallet.",
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
  await page.route("**/__deposit-preparation-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Isolated SDK deposit preparation</title>",
    }),
  );
  await page.goto("/__deposit-preparation-harness");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Test-only Vite module; signer always throws.
    const { registerTestWallet } = await import("/tests/walletHarness.ts");
    const { loadConfig, listWallets, connectWalletAccount, connectZkapi } =
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
      // Creates only an encrypted local candidate. Never advance it, sign,
      // broadcast, authorize a session, or request inference.
      await handle.client.prepareDeposit("2000000");
      const status = await handle.client.status();
      return {
        completed: true,
        elapsedMs: performance.now() - started,
        wallet: status.wallet,
        operation: status.walletOperation && {
          kind: status.walletOperation.kind,
          phase: status.walletOperation.phase,
          signature: status.walletOperation.signature,
        },
      };
    } catch (error) {
      // Do not export full SDK status, journal contents, or exception details.
      const knownFailures = [
        "finalized indexer unavailable",
        "RPC/indexer finalized cut changed; retry snapshot",
        "RPC finalized account cut block missing or invalid",
        "untrusted indexer root",
      ];
      return {
        completed: false,
        elapsedMs: performance.now() - started,
        errorName: error instanceof Error ? error.name : "UnknownError",
        failure:
          error instanceof Error && knownFailures.includes(error.message)
            ? error.message
            : "Unclassified preparation error",
      };
    } finally {
      handle.dispose();
      unregister();
    }
  });
  const report = testInfo.outputPath("public-browser-deposit-preparation.json");
  await writeFile(
    report,
    JSON.stringify(
      {
        observedAt: new Date().toISOString(),
        sdk: "0.2.0-devnet.10",
        result,
        blocked,
        serviceErrors,
        scope:
          "Real published SDK, public profile and services, prover and inline transaction construction in isolated Chromium. Fixture wallet cannot sign; no advance, broadcast, AUTH or inference. No user wallet or funds are accessed.",
      },
      null,
      2,
    ) + "\n",
  );
  await testInfo.attach("public-browser-deposit-preparation.json", {
    path: report,
    contentType: "application/json",
  });
  expect(blocked).toEqual([]);
  expect(result).toMatchObject({
    completed: true,
    wallet: "unfunded",
    operation: { kind: "deposit", phase: "ready", signature: null },
  });
});
