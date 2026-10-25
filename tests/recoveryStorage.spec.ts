import {
  expect,
  firefox,
  test,
  webkit,
  type BrowserContext,
  type Page,
} from "@playwright/test";
import { recoveryService } from "./fixtures/recoveryService";

async function harness(
  context: BrowserContext,
  page: Page,
  server = recoveryService(),
) {
  await context.route(
    "https://d366buuvadnp3.cloudfront.net/recovery/v1/**",
    async (route) => {
      const request = route.request();
      const response = await server.respond(
        request.url(),
        request.method(),
        new Headers(request.headers()),
        request.postData(),
      );
      await route.fulfill({
        status: response.status,
        contentType: "application/json",
        body: await response.text(),
        headers: { "access-control-allow-origin": "*" },
      });
    },
  );
  await context.route("**/recovery-storage-harness", (route) =>
    route.fulfill({
      contentType: "text/html",
      body: "<!doctype html><title>Recovery custody test</title>",
    }),
  );
  await page.goto("/recovery-storage-harness");
  return server;
}

test("real IndexedDB loss restores all deposits, selection and unresolved financial evidence without sending financial requests", async ({
  context,
  page,
}) => {
  await harness(context, page);
  const original = await page.evaluate(async () => {
    const testModule = await import("/tests/fixtures/recoveryHarness.ts");
    return testModule.initialize();
  });
  expect(original.migrated).toEqual(original.before);
  expect(original.latest.catalog.deposits).toHaveLength(3);
  expect(original.sourceExtractable).toBe(false);
  expect(original.binding).toEqual({
    exists: true,
    extractable: false,
    hasKeyHex: false,
  });

  // Keep only the user's independently saved file and the remote encrypted
  // service. Delete ALL data at the original browser origin, then open a new page.
  const origin = new URL(page.url()).origin;
  const cdp = await context.newCDPSession(page);
  await cdp.send("Storage.clearDataForOrigin", { origin, storageTypes: "all" });
  expect(
    await page.evaluate(async () => (await indexedDB.databases()).length),
  ).toBe(0);
  await page.close();
  const fresh = await context.newPage();
  await fresh.goto("/recovery-storage-harness");
  const restored = await fresh.evaluate(async (file) => {
    const testModule = await import("/tests/fixtures/recoveryHarness.ts");
    return testModule.restore(file);
  }, original.file);
  expect(restored.restoredState).toEqual(original.latest);
  expect(restored.binding).toEqual({
    exists: true,
    extractable: false,
    hasKeyHex: false,
  });
  expect(restored.prepareError).toContain("unresolved authorization");
  expect(restored.sendError).toContain("active direct session");
  expect(restored.financialCalls).toBe(0);
  expect(
    await fresh.evaluate(async () =>
      (await import("/tests/fixtures/recoveryHarness.ts")).openState(),
    ),
  ).toEqual(original.latest);
});

test("losing just the browser recovery binding cannot reopen stale local notes; the saved file resumes safely", async ({
  context,
  page,
}) => {
  await harness(context, page);
  const original = await page.evaluate(async () =>
    (await import("/tests/fixtures/recoveryHarness.ts")).initialize(),
  );
  const lost = await page.evaluate(async () =>
    (await import("/tests/fixtures/recoveryHarness.ts")).bindingLost(),
  );
  expect(lost.blocked).toBe(true);
  const resumed = await page.evaluate(
    async (file) =>
      (await import("/tests/fixtures/recoveryHarness.ts")).resume(file),
    original.file,
  );
  // The original notes contain an older balance and only two deposits. A resume
  // must keep the current remote balance and the later third deposit.
  expect(resumed).toEqual(original.latest);
});

// Default runs need only Chromium. Opt in to two different destination engines
// while keeping the same app, SDK, encrypted service and custody assertions.
const recoveryDestinations =
  process.env.ZKCHAT_CROSS_BROWSER_RECOVERY === "1"
    ? (["firefox", "webkit"] as const)
    : (["chromium"] as const);

for (const destination of recoveryDestinations) {
  test(`a saved file restores a new non-expiring pool from Chromium to ${destination} and fences the old owner @non-expiring-recovery`, async ({
    browser,
    context: browserA,
    page: pageA,
    baseURL,
  }) => {
    expect(browser.browserType().name()).toBe("chromium");
    const server = recoveryService();
    const otherBrowser =
      destination === "chromium"
        ? undefined
        : await { firefox, webkit }[destination].launch();
    let browserB: BrowserContext | undefined;
    const externalRequests: string[] = [];
    try {
      browserB = await (otherBrowser ?? browser).newContext({ baseURL });
      // Only the local app modules and the in-memory recovery service are reachable.
      // In particular, neither browser can reach RPC, control or inference services.
      for (const context of [browserA, browserB]) {
        await context.route("**/*", (route) => {
          const url = route.request().url();
          if (new URL(url).origin === new URL(baseURL!).origin)
            return route.continue();
          externalRequests.push(url);
          return route.abort();
        });
      }
      await harness(browserA, pageA, server);
      const original = await pageA.evaluate(async () =>
        (
          await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
        ).initialize(),
      );
      expect(original.migrated).toEqual(original.before);
      expect(original.latest.catalog.deposits).toHaveLength(3);
      expect(original.latest.catalog.selectedId).toBe(original.thirdNoteId);
      expect(
        original.latest.notes.every(
          ({ record }) =>
            record?.value.witness?.expiry === "18446744073709551615",
        ),
      ).toBe(true);
      expect(original.binding).toEqual({
        exists: true,
        extractable: false,
        hasKeyHex: false,
      });
      expect(original.sourceExtractable).toBe(false);

      const pageB = await browserB.newPage();
      await harness(browserB, pageB, server);
      // The destination starts with its own empty storage partition. Cross-engine
      // runs transfer only the saved file, not local data or browser key objects.
      expect(
        await pageB.evaluate(async () =>
          (
            await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
          ).openState(),
        ),
      ).toBeNull();
      const vault = [...server.vaults.values()][0];
      const initialEpoch = vault.epoch;
      const initialOwner = vault.owner;
      const initialWrites = server.writes;
      const initialRequests = server.requests;
      const rejectedFiles = await pageB.evaluate(
        async (file) =>
          (
            await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
          ).rejectMismatchedFiles(file),
        original.file,
      );
      expect(rejectedFiles.pool).toContain("different payment deployment");
      expect(rejectedFiles.wallet).toContain("wallet used for these deposits");
      expect(rejectedFiles.malformed).toContain("valid zkChat recovery file");
      expect(server.requests).toBe(initialRequests);
      const wrongSecret = await pageB.evaluate(
        async (file) =>
          (
            await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
          ).rejectWrongSecret(file),
        original.file,
      );
      expect(wrongSecret.rejected).toBe(true);
      expect(wrongSecret.binding.exists).toBe(false);
      expect(server.requests).toBe(initialRequests + 1);
      expect(vault.epoch).toBe(initialEpoch);
      expect(vault.owner).toBe(initialOwner);
      expect(server.writes).toBe(initialWrites);

      const restored = await pageB.evaluate(
        async (file) =>
          (
            await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
          ).restore(file),
        original.file,
      );
      expect(restored.context).toEqual(original.context);
      expect(restored.restoredState).toEqual(original.latest);
      expect(restored.binding).toEqual({
        exists: true,
        extractable: false,
        hasKeyHex: false,
      });
      expect(restored.prepareError).toContain("unresolved authorization");
      expect(restored.sendError).toContain("active direct session");
      expect(restored.financialCalls).toBe(0);
      expect(vault.epoch).toBe(initialEpoch + 1);
      expect(vault.owner).not.toBe(initialOwner);
      const fenced = await pageA.evaluate(async () =>
        (
          await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
        ).oldOwnerAccess(),
      );
      expect(fenced).toEqual({
        reopened: false,
        cachedWrite: false,
        localFallback: false,
      });
      expect(server.writes).toBe(initialWrites);

      await pageB.reload();
      expect(
        await pageB.evaluate(async () =>
          (
            await import("/tests/fixtures/nonExpiringRecoveryHarness.ts")
          ).openState(),
        ),
      ).toEqual(original.latest);
      expect(externalRequests).toEqual([]);
    } finally {
      await browserB?.close();
      await otherBrowser?.close();
    }
  });
}
