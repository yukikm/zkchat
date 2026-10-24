import { test, expect } from "@playwright/test";
import { readFile } from "node:fs/promises";

test("installed browser WASM verifies a signed waiver before committing the encrypted successor", async ({
  page,
}) => {
  const fixture = JSON.parse(
    await readFile(
      new URL("./fixtures/direct-waiver-verifier.json", import.meta.url),
      "utf8",
    ),
  );
  await page.goto("/tests/fixtures/waiver-browser.html");
  await page.waitForFunction(
    () =>
      // @ts-expect-error Test-only harness entry point.
      typeof window.verifyWaiverInBrowser === "function",
  );
  const result = await page.evaluate(async (fixture) => {
    // @ts-expect-error Test-only harness entry point.
    return window.verifyWaiverInBrowser(fixture);
  }, fixture);
  expect(result).toEqual({
    rejected: true,
    retained: true,
    pendingCleared: true,
    signedSuccessor: true,
    balanceUnchanged: true,
    observedStillUnknown: true,
    historyCount: 1,
    reopened: true,
    methods: ["GET", "GET", "GET", "GET", "GET", "GET"],
  });
});
