import { expect, test, type Page } from "@playwright/test";

const currentEntry = "index-Current1.js";
const nextEntry = "index-Updated2.js";
const html = (base: string, entry = currentEntry) =>
  `<!doctype html><script type="module" src="${base}assets/${entry}"></script>`;

async function updateFixture(page: Page, base = "/") {
  let navigationCount = 0;
  let checks = 0;
  let reply = { status: 200, contentType: "text/html", body: html(base) };
  let hold: Promise<void> | undefined;
  await page.route("**/zkapi-config.json", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(`**${base}assets/${currentEntry}`, (route) =>
    route.fulfill({ contentType: "application/javascript", body: "" }),
  );
  await page.route(
    (url) => url.pathname === base,
    async (route) => {
      if (route.request().isNavigationRequest()) {
        navigationCount++;
        const response = await route.fetch();
        await route.fulfill({
          response,
          body: (await response.text()).replace(
            "</head>",
            `${html(base)}</head>`,
          ),
        });
        return;
      }
      checks++;
      await hold;
      await route.fulfill(reply);
    },
  );
  await page.goto(base);
  await expect.poll(() => checks).toBeGreaterThan(0);
  await expect(
    page.getByRole("button", { name: "Wallet & balance", exact: true }),
  ).toBeVisible();
  // Complete React's initial check before dispatching the next focus event.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) =>
        requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
      ),
  );
  return {
    navigationCount: () => navigationCount,
    checks: () => checks,
    reply: (value: typeof reply) => {
      reply = value;
    },
    hold: (value: Promise<void> | undefined) => {
      hold = value;
    },
  };
}

const checkAgain = (page: Page) =>
  page.evaluate(() => window.dispatchEvent(new Event("focus")));
const reloadButton = (page: Page) =>
  page.getByRole("button", { name: "Reload app", exact: true });

for (const base of ["/", "/recovery-v12/", "/recovery-v3/"]) {
  test(`an update under ${base} is advisory, retains drafts, and stays latched`, async ({
    page,
  }) => {
    const fixture = await updateFixture(page, base);
    await expect(reloadButton(page)).toHaveCount(0);
    const draft = page.getByRole("textbox", { name: "Message", exact: true });
    await draft.fill("送信前の下書きを保持する");
    await page.evaluate(() => localStorage.setItem("fixture:keep", "saved"));
    const previousChecks = fixture.checks();
    let release!: () => void;
    fixture.hold(
      new Promise<void>((resolve) => {
        release = resolve;
      }),
    );
    fixture.reply({
      status: 200,
      contentType: "text/html",
      body: html(base, nextEntry),
    });
    await checkAgain(page);
    await expect.poll(() => fixture.checks()).toBe(previousChecks + 1);
    await checkAgain(page);
    await page.evaluate(() =>
      document.dispatchEvent(new Event("visibilitychange")),
    );
    // Focus and visibility events must share the one pending HTML check.
    expect(fixture.checks()).toBe(previousChecks + 1);
    release();
    fixture.hold(undefined);
    await expect(reloadButton(page)).toBeDisabled();
    await expect(
      page.getByText(
        "An update is ready. Send or clear your draft before reloading.",
      ),
    ).toBeVisible();
    await expect(draft).toHaveValue("送信前の下書きを保持する");
    expect(
      await page.evaluate(() => localStorage.getItem("fixture:keep")),
    ).toBe("saved");
    expect(fixture.navigationCount()).toBe(1);
    await draft.fill("");
    await expect(reloadButton(page)).toBeEnabled();
    fixture.reply({ status: 200, contentType: "text/html", body: html(base) });
    await checkAgain(page);
    await expect(reloadButton(page)).toBeEnabled();
    expect(fixture.navigationCount()).toBe(1);
  });
}

for (const pending of [
  {
    name: "active session",
    status: { session: { phase: "active", operations: [] } },
  },
  {
    name: "wallet operation",
    status: {
      walletOperation: { kind: "deposit", phase: "prepared", signature: null },
    },
  },
  { name: "withdrawal waiting period", status: { wallet: "pending_escape" } },
]) {
  test(`the ${pending.name} blocks reload until saved payment status permits it`, async ({
    page,
  }) => {
    const source = `
      export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateZkchatRecoveryFile() {}
export class RecoverySetupIncomplete extends RecoveryError {}
export const restoreZkchatDeposits = async () => { throw new Error('Unexpected recovery'); };
export const finishZkchatRecoverySetup = async () => { throw new Error('Unexpected recovery setup'); };
      const account = { address: '11111111111111111111111111111111' };
      const wallet = { name: 'Update Guard Test Wallet' };
      export const configuredModels = () => [{ id: 'test/model', apis: ['chat'] }];
      export const configuredMode = () => 'direct_openrouter';
      export const configuredStreaming = () => false;
      export const loadConfig = async () => ({ schema: 2 });
      export const listWallets = () => [wallet];
      export const watchWallets = () => () => {};
      export const connectWalletAccount = async () => account;
      let state = { noteId: 'saved-note', mode: 'direct_openrouter', wallet: 'active', canRequest: true, busy: false, session: null, walletOperation: null, emergencyEscape: null, settledBalanceMicroUsdc: '2000000', authorizationCapMicroUsdc: '100000', ...${JSON.stringify(pending.status)} };
      const listeners = new Set();
      window.testPaymentActions = [];
      window.testCompleteSavedOperation = () => {
        state = { ...state, wallet: 'active', session: null, walletOperation: null };
        for (const listener of listeners) listener(state);
      };
      export const connectZkapi = async () => ({ account, wallet, recoveryEnabled: true, persistence: 'persistent', publicAdmissionReady: true, deposits: [{ id: 'saved-note' }], selectedDepositId: 'saved-note', deployment: { mint: 'fixture-mint' }, dispose() {}, refreshPreflight: async () => {}, client: {
        status: async () => state,
        subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
        recover: async () => { window.testPaymentActions.push('recover'); },
        settle: async () => { window.testPaymentActions.push('settle'); },
        advanceWallet: async () => { window.testPaymentActions.push('advanceWallet'); },
        prepareFinalizeEscape: async () => { window.testPaymentActions.push('prepareFinalizeEscape'); },
      } });`;
    await page.route("**/src/lib/zkapi.ts*", (route) =>
      route.fulfill({ contentType: "application/javascript", body: source }),
    );
    const fixture = await updateFixture(page);
    await page
      .getByRole("button", { name: "Wallet & balance", exact: true })
      .click();
    await page
      .getByRole("dialog", { name: "Wallet & balance" })
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(page.locator(".topbar-status")).toHaveText("Wallet connected");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    fixture.reply({
      status: 200,
      contentType: "text/html",
      body: html("/", nextEntry),
    });
    await checkAgain(page);
    await expect(reloadButton(page)).toBeDisabled();
    await expect(
      page.getByText(
        "An update is ready. Finish the current payment or operation before reloading.",
      ),
    ).toBeVisible();
    await page.evaluate(() =>
      (
        window as unknown as { testCompleteSavedOperation: () => void }
      ).testCompleteSavedOperation(),
    );
    await expect(reloadButton(page)).toBeEnabled();
    expect(
      await page.evaluate(
        () =>
          (window as unknown as { testPaymentActions: string[] })
            .testPaymentActions,
      ),
    ).toEqual([]);
    expect(fixture.navigationCount()).toBe(1);
  });
}

for (const failure of [
  {
    name: "HTTP failure",
    status: 503,
    contentType: "text/html",
    body: html("/", nextEntry),
  },
  {
    name: "non-HTML response",
    status: 200,
    contentType: "application/json",
    body: html("/", nextEntry),
  },
  {
    name: "missing version hash",
    status: 200,
    contentType: "text/html",
    body: html("/", "index.js"),
  },
  {
    name: "external entry",
    status: 200,
    contentType: "text/html",
    body: html("https://example.invalid/", nextEntry),
  },
]) {
  test(`a ${failure.name} does not falsely report an update`, async ({
    page,
  }) => {
    const fixture = await updateFixture(page);
    const previousChecks = fixture.checks();
    fixture.reply(failure);
    await checkAgain(page);
    await expect.poll(() => fixture.checks()).toBe(previousChecks + 1);
    await expect(reloadButton(page)).toHaveCount(0);
    // A later valid check can still detect an update after a failed check.
    fixture.reply({
      status: 200,
      contentType: "text/html",
      body: html("/", nextEntry),
    });
    await expect
      .poll(async () => {
        await checkAgain(page);
        return reloadButton(page).count();
      })
      .toBe(1);
    expect(fixture.navigationCount()).toBe(1);
  });
}

test("development source and Vite client scripts do not trigger update checks", async ({
  page,
}) => {
  let htmlChecks = 0;
  await page.route("**/zkapi-config.json", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route(
    (url) => url.pathname === "/",
    async (route) => {
      if (!route.request().isNavigationRequest()) htmlChecks++;
      await route.continue();
    },
  );
  await page.goto("/");
  await checkAgain(page);
  await expect(reloadButton(page)).toHaveCount(0);
  expect(htmlChecks).toBe(0);
});
