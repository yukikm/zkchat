import assert from "node:assert/strict";
import { parseArgs } from "node:util";
import { preview } from "vite";
import { chromium } from "@playwright/test";

const { values } = parseArgs({
  options: { base: { type: "string", default: "/" } },
});
const base = values.base.endsWith("/") ? values.base : `${values.base}/`;
const server = await preview({
  base,
  preview: { port: 4183, host: "127.0.0.1", strictPort: true },
});
let browser;
try {
  browser = await chromium.launch();
  const page = await browser.newPage();
  const origin = "http://127.0.0.1:4183";
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  // Test the emitted profile pins separately; never contact the public deployment.
  const pins = [
    [base, "ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77"],
    [
      `${base}recovery-v3/`,
      "449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5",
    ],
  ];
  for (const [path, expected] of pins) {
    const response = await fetch(`${origin}${path}zkapi-config.json`);
    assert.equal(response.status, 200);
    assert.equal((await response.json()).profileSha256, expected);
  }
  await page.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    if (url.pathname.endsWith("/zkapi-config.json"))
      return route.fulfill({ json: null });
    return route.continue();
  });
  await page.goto(`${origin}${base}`);
  await page.evaluate(() =>
    localStorage.setItem("original-custody-sentinel", "preserved"),
  );
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  assert.match(
    await page.getByRole("dialog").textContent(),
    /SDK 0\.2\.0-devnet\.12/,
  );
  await page.getByText("Have an older deposit?", { exact: true }).click();
  await page.getByRole("link", { name: "Recover an older deposit" }).click();
  await page.waitForURL(`${origin}${base}recovery-v3/`);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  assert.match(
    await page.getByRole("dialog").textContent(),
    /SDK 0\.2\.0-devnet\.3/,
  );
  assert.equal(
    await page.evaluate(() =>
      localStorage.getItem("original-custody-sentinel"),
    ),
    "preserved",
  );
  assert.deepEqual(errors, []);
  console.log(
    `Built app and original recovery passed at ${base}: correct SDK labels, profile pins, same-origin navigation and retained storage. No public API calls.`,
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.httpServer.close(resolve));
}
