import { expect, test, type BrowserContext, type Page } from "@playwright/test";
import { recoveryService } from "./fixtures/recoveryService";

async function harness(context: BrowserContext, page: Page) {
  const server = recoveryService();
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
