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
  const button = page.getByRole("button", {
    name: "Check public connection",
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
  expect(visibleResult).toContain("10 SDK checks passed.");
  expect(visibleResult).toContain("No invitation required.");
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
    page.getByRole("button", { name: "Integration Test Wallet", exact: true }),
  ).toBeEnabled({ timeout: 180_000 });
  await page
    .getByRole("button", { name: "Integration Test Wallet", exact: true })
    .click();
  await page
    .getByLabel("2. Select an account")
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Verify connection", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Create storage for this wallet",
      exact: true,
    }),
  ).toBeEnabled({ timeout: 90_000 });
  await page
    .getByRole("button", {
      name: "Create storage for this wallet",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Deployment and wallet connection verified.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", { name: "Prepare deposit", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await page
    .getByRole("button", { name: "Integration Test Wallet", exact: true })
    .click();
  await page
    .getByLabel("2. Select an account")
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Verify connection", exact: true })
    .click();
  await expect(
    page.getByText("Deployment and wallet connection verified.", {
      exact: true,
    }),
  ).toBeVisible({ timeout: 90_000 });
  await expect(
    page.getByRole("button", {
      name: "Create storage for this wallet",
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
        sdk: "0.2.0-devnet.8",
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
