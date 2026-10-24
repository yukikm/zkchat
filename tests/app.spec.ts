import { test, expect, type Page } from "@playwright/test";
const HISTORY = "zkchat:conversations:v1";
// Offline UI fixtures never download the live deployment; live acceptance is separate.
test.beforeEach(async ({ page }) => {
  await page.route("**/zkapi-config.json", (route) =>
    route.fulfill({ json: null }),
  );
});
const input = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
const send = (page: Page) =>
  page.getByRole("button", { name: "Send message", exact: true });
async function demo(page: Page) {
  await page.goto("/");
  await page.getByRole("button", { name: "Try the demo", exact: true }).click();
  await expect(page.locator(".demo-banner")).toContainText(
    "Sample replies, no AI or payments",
  );
}
async function finish(page: Page) {
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toHaveCount(0);
  await expect(page.locator(".message.assistant")).not.toHaveCount(0);
}
test("default is disconnected with no invented balance; demo makes no external requests", async ({
  page,
}) => {
  const external: string[] = [];
  page.on("request", (request) => {
    if (
      /^https?:/.test(request.url()) &&
      new URL(request.url()).hostname !== "127.0.0.1"
    )
      external.push(request.url());
  });
  await page.goto("/");
  await expect(page.locator(".topbar-status")).toHaveText("Disconnected");
  await expect(page.locator(".credit-line strong")).toHaveText("—");
  await page.screenshot({
    path: test.info().outputPath("zkchat-desktop.png"),
    fullPage: true,
  });
  await input(page).fill("こんにちは");
  await expect(send(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Wallet & balance" }),
  ).toContainText("Live chat is unavailable");
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Try the demo", exact: true })
    .click();
  await send(page).click();
  await finish(page);
  await expect(page.locator(".message.assistant")).toContainText(
    "Demo reply · No AI request or payment",
  );
  expect(external).toEqual([]);
});
test("demo history persists, restores its mode, and supports rename/search/export/delete", async ({
  page,
}) => {
  await demo(page);
  await input(page).fill("TypeScriptコードを書いて");
  await send(page).click();
  await finish(page);
  await expect(page.locator(".message.assistant pre code")).toContainText(
    "function unique<T>",
  );
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) || "[]")[0]?.messages[1]?.state,
        HISTORY,
      ),
    )
    .toBe("complete");
  await page.reload();
  await expect(page.locator(".topbar-status")).toHaveText("Disconnected");
  await page
    .locator(".history-item")
    .filter({ hasText: "TypeScriptコードを書いて" })
    .click();
  await expect(page.locator(".demo-banner")).toBeVisible();
  await expect(page.locator(".message.assistant pre code")).toContainText(
    "function unique<T>",
  );
  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await page.getByRole("button", { name: "Rename", exact: true }).click();
  await page
    .getByLabel("Conversation name", { exact: true })
    .fill("保存したコード相談");
  await page.getByRole("button", { name: "Save", exact: true }).click();
  await page.getByPlaceholder("Search chats").fill("絶対一致しない検索");
  await expect(page.getByText("No matching conversations")).toBeVisible();
  await page.getByPlaceholder("Search chats").fill("コード相談");
  await expect(page.locator(".history-item")).toHaveCount(1);
  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  const downloadPromise = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Save as Markdown", exact: true })
    .click();
  expect((await downloadPromise).suggestedFilename()).toMatch(
    /^zkchat-.*\.md$/,
  );
  await page.getByRole("button", { name: "Use AI chat", exact: true }).click();
  await expect(page.locator(".demo-banner")).toHaveCount(0);
  await input(page).fill("実接続で送る");
  await expect(send(page)).toBeDisabled();
  await page.locator(".history-item").click();
  await expect(page.locator(".demo-banner")).toBeVisible();
  await page
    .getByRole("button", { name: "Conversation actions", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Delete conversation", exact: true })
    .click();
  await page.getByRole("button", { name: "Delete", exact: true }).click();
  await expect(page.locator(".history-item")).toHaveCount(0);
});
test("stopped generation remains incomplete and retry is an explicit new operation", async ({
  page,
}) => {
  await demo(page);
  await input(page).fill("Solanaの仕組みを教えて");
  await send(page).click();
  await expect(page.locator(".message.assistant .markdown")).toBeVisible();
  await page
    .getByRole("button", { name: "Stop generation", exact: true })
    .click();
  await finish(page);
  await expect(page.locator(".message-feedback")).toHaveText(
    "Display stopped.",
  );
  await page.getByRole("button", { name: "Send again", exact: true }).click();
  await finish(page);
  await expect(page.locator(".message.assistant")).toHaveCount(2);
  await expect
    .poll(() =>
      page.evaluate(
        (key) =>
          JSON.parse(localStorage.getItem(key) || "[]")[0]?.messages[3]?.state,
        HISTORY,
      ),
    )
    .toBe("complete");
  const messages = await page.evaluate(
    (key) => JSON.parse(localStorage.getItem(key)!)[0].messages,
    HISTORY,
  );
  expect(messages[1].state).toBe("stopped");
  expect(messages[1].operationId).not.toBe(messages[3].operationId);
});
test("untrusted Markdown cannot execute HTML, script links, or remote images", async ({
  page,
}) => {
  const requests: string[] = [];
  page.on("request", (req) => requests.push(req.url()));
  const content =
    '<img src="https://example.invalid/leak" onerror="window.__xss=1">\n\n<script>window.__xss=2</script>\n\n[bad](javascript:alert(1))\n\n![tracking](https://example.invalid/pixel)\n\n```html\n<img onerror="alert(1)">\n```';
  await page.addInitScript(
    ({ key, content }) =>
      localStorage.setItem(
        key,
        JSON.stringify([
          {
            id: "untrusted",
            title: "Untrusted output",
            mode: "demo",
            model: "demo",
            updatedAt: 1,
            messages: [
              {
                id: "a",
                role: "assistant",
                operationId: "a",
                state: "complete",
                content,
                createdAt: 1,
              },
            ],
          },
        ]),
      ),
    { key: HISTORY, content },
  );
  await page.goto("/");
  await page.locator(".history-item").click();
  await expect(
    page.locator(".markdown img, .markdown script, .markdown iframe"),
  ).toHaveCount(0);
  await expect(page.locator('.markdown a[href^="javascript:"]')).toHaveCount(0);
  await expect(page.locator(".markdown code")).toContainText(
    '<img onerror="alert(1)">',
  );
  expect(
    await page.evaluate(() => (window as unknown as { __xss?: number }).__xss),
  ).toBeUndefined();
  expect(requests.filter((url) => url.includes("example.invalid"))).toEqual([]);
});
test("mobile layout fits 375px and dark preference survives reload", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await demo(page);
  await expect(send(page)).toBeInViewport();
  await page.screenshot({
    path: test.info().outputPath("zkchat-mobile.png"),
    fullPage: true,
  });
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.getByRole("button", { name: "Open menu", exact: true }).click();
  await page
    .getByRole("button", { name: "Appearance and chat", exact: true })
    .click();
  await page.getByLabel("Theme", { exact: true }).selectOption("dark");
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.reload();
  await expect(page.locator("html")).toHaveAttribute("data-theme", "dark");
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
});
test("offline state retains the draft and prevents sending", async ({
  page,
  context,
}) => {
  await demo(page);
  await input(page).fill("接続が戻ったら送る");
  await context.setOffline(true);
  await expect(page.getByRole("alert")).toContainText("offline");
  await expect(send(page)).toBeDisabled();
  await expect(input(page)).toHaveValue("接続が戻ったら送る");
  await context.setOffline(false);
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await finish(page);
});
// Test-only adapter. Production contains no fake funds/wallet/inference; published SDK parser is used.
const liveStub = `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoverySetupIncomplete extends RecoveryError {}
export const restoreZkchatDeposits = async () => { throw new Error('Unexpected recovery'); };
export const finishZkchatRecoverySetup = async () => { throw new Error('Unexpected recovery setup'); };
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Test Wallet' };
export const configuredModels = config => config?.models ?? [];
export const configuredMode = config => config.mode;
export const configuredStreaming = () => true;
export const loadConfig = async () => ({ label: 'Test Operator', mode: 'proxy', models: [{ id: 'test/model', label: 'Test Model', apis: ['chat'] }] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
let state = { noteId: 'test-note', mode: 'proxy', canRequest: true, wallet: 'active', busy: false, session: null, walletOperation: null, settledBalanceMicroUsdc: '2000000', authorizationCapMicroUsdc: '100000' };
const listeners = new Set();
const update = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
const calls = []; let recoveries = 0;
const frame = value => 'data: ' + JSON.stringify(value) + '\\n\\n';
export const connectZkapi = async () => ({ account, wallet, deposits: [{id:'test-note'},{id:'retained-note'}], selectedDepositId: 'test-note', recoveryEnabled: true, persistence: 'persistent', publicAdmissionReady: true, deployment: { mint: 'fixture-mint' }, async refreshPreflight() {}, dispose() {}, client: {
  status: async () => state,
  subscribe: fn => { listeners.add(fn); return () => listeners.delete(fn); },
  chat: async request => {
    calls.push({ operationId: request.operationId, messages: request.messages }); localStorage.setItem('zkchat:test-calls', JSON.stringify(calls));
    if (calls.length === 1) { update({ canRequest: false, session: { phase: 'settlement_pending', operations: [] } }); return new Response(frame({ choices: [{ index: 0, delta: { content: '途中までの応答' }, finish_reason: null }] }), { headers: { 'Content-Type': 'text/event-stream' } }); }
    update({ canRequest: true, session: null, settledBalanceMicroUsdc: '1980000', lastSettlement: { operationIds: [request.operationId], chargeMicroUsdc: '10000' } });
    return new Response(frame({ choices: [{ index: 0, delta: { content: '再試行後の回答' }, finish_reason: 'stop' }] }) + 'data: [DONE]\\n\\n', { headers: { 'Content-Type': 'text/event-stream' } });
  },
  recover: async () => { localStorage.setItem('zkchat:test-recoveries', String(++recoveries)); update({ canRequest: true, session: null }); },
} });`;
test("live partial failure blocks sends; recovery does not replay; explicit retry gets a new ID", async ({
  page,
}) => {
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: liveStub }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await input(page).fill("実接続テスト");
  await send(page).click();
  await finish(page);
  await expect(page.locator(".message.assistant")).toContainText(
    "途中までの応答",
  );
  await expect(page.locator(".message-feedback")).toContainText(
    "Nothing is resent automatically",
  );
  await expect(
    page.getByRole("button", { name: "Send again", exact: true }),
  ).toBeDisabled();
  await input(page).fill("未精算中の入力");
  await expect(send(page)).toBeDisabled();
  await page
    .locator(".message.assistant")
    .getByRole("button", { name: "Resolve payment", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Resolve payment", exact: true })
    .click();
  await expect(
    page.getByText("This payment is no longer pending. No message was resent."),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("zkchat:test-calls")!).length,
    ),
  ).toBe(1);
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-recoveries")),
  ).toBe("1");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.getByRole("button", { name: "Send again", exact: true }).click();
  await finish(page);
  await expect(page.locator(".message.assistant").last()).toContainText(
    "再試行後の回答",
  );
  const calls = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("zkchat:test-calls")!),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].operationId).not.toBe(calls[1].operationId);
  expect(calls[1].messages).toEqual([
    { role: "user", content: "実接続テスト" },
  ]);
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Settled · 0.01 USDC",
  );
});

for (const width of [768, 1280]) {
  test(`layout and dialog keyboard behavior at ${width}px`, async ({
    page,
  }) => {
    await page.setViewportSize({ width, height: 900 });
    await page.goto("/");
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    const settings = page.getByRole("button", {
      name: "Wallet & balance",
      exact: true,
    });
    await settings.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Wallet & balance" }),
    ).toBeVisible();
    await page.keyboard.press("Escape");
    await expect(page.getByRole("dialog")).toHaveCount(0);
    await expect(settings).toBeFocused();
  });
}

async function connectFixture(page: Page, source: string) {
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: source }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
}
test("saved rejected operation remains recoverable after reopening settings", async ({
  page,
}) => {
  const source = liveStub
    .replace(
      "walletOperation: null",
      "walletOperation: { kind: 'deposit', phase: 'failed', signature: null }",
    )
    .replace(
      "status: async () => state,",
      "status: async () => state, retryRejectedWalletOperation: async () => { localStorage.setItem('zkchat:test-wallet-retries', '1'); update({ walletOperation: {kind: 'deposit', phase: 'prepared'} }); },",
    );
  await connectFixture(page, source);
  await expect(
    page.getByRole("button", {
      name: "Try this step again",
      exact: true,
    }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Try this step again",
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zkchat:test-wallet-retries"),
    ),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
});
test("unknown proxy send has explicit absence reconciliation without replay", async ({
  page,
}) => {
  const source = liveStub
    .replace(
      "session: null, walletOperation:",
      "session: {phase:'unknown', operations:[{id:'saved',phase:'send_unknown'}]}, walletOperation:",
    )
    .replace(
      "status: async () => state,",
      "status: async () => state, reconcileAbsentOperations: async () => { localStorage.setItem('zkchat:test-absent', '1'); update({session:null}); },",
    );
  await connectFixture(page, source);
  await page.getByText("Payment details and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check unsent request", exact: true })
    .click();
  await expect(
    page.getByText("Request checked. No message was resent."),
  ).toBeVisible();
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-absent")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
});

test("public onboarding connects without invitation controls or a token argument", async ({
  page,
}) => {
  const publicStub = liveStub
    .replace(
      "label: 'Test Operator', mode:",
      "schema: 2, label: 'Test Operator', mode:",
    )
    .replace(
      "async () => ({ account,",
      "async (...args) => { window.testConnectArgumentCount = args.length; return ({ account,",
    )
    .replace(
      "publicAdmissionReady: true,",
      "publicAdmissionReady: true, diagnostic: { preflight: { paused: false }, unavailableComponent: null },",
    )
    .replace(/} }\);$/, "} }); };");
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: publicStub }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByText("Have an invitation?", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
  expect(
    await page.evaluate(() => (window as any).testConnectArgumentCount),
  ).toBe(4);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
  await page.reload();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(page.getByLabel("Invitation code")).toHaveCount(0);
});

for (const unavailableComponent of ["snapshot", "readiness"]) {
  test(`a failed ${unavailableComponent} check can be retried without withdrawing or losing the draft`, async ({
    page,
  }) => {
    const source = liveStub
      .replace(
        "label: 'Test Operator', mode:",
        "schema: 2, label: 'Test Operator', mode:",
      )
      .replace(
        "let state = { noteId: 'test-note', mode:",
        "let state = { noteId: 'existing-funded-note', mode:",
      )
      .replace(
        "const calls = []; let recoveries = 0;",
        `const calls = []; let recoveries = 0;
        let serviceReady = true; let serviceChecks = 0;
        window.testServiceOutage = () => { serviceReady = false; update({ canRequest: false }); };`,
      )
      .replace(
        "publicAdmissionReady: true,",
        `get publicAdmissionReady() { return serviceReady; },
        get diagnostic() { return { preflight: serviceReady ? { paused: false } : null, unavailableComponent: serviceReady ? null : '${unavailableComponent}' }; },
        selectedDepositId: 'existing-funded-note', deposits: [{ id: 'existing-funded-note' }],`,
      )
      .replace(
        "async refreshPreflight() {}",
        `async refreshPreflight() {
          localStorage.setItem('zkchat:test-service-checks', String(++serviceChecks));
          serviceReady = serviceChecks > 1;
          update({ canRequest: serviceReady });
        }`,
      )
      .replace(
        "status: async () => state,",
        `status: async () => { localStorage.setItem('zkchat:test-status-note', state.noteId); return state; },
        prepareWithdrawal: async () => { localStorage.setItem('zkchat:test-withdrawals', '1'); },`,
      )
      .replace("if (calls.length === 1)", "if (false)");
    await connectFixture(page, source);
    await page.getByRole("button", { name: "Close", exact: true }).click();
    const draft = "接続が戻ったらこのデポジットから送る";
    await input(page).fill(draft);
    await expect(send(page)).toBeEnabled();
    await page.evaluate(() =>
      (
        window as unknown as { testServiceOutage: () => void }
      ).testServiceOutage(),
    );
    await expect(send(page)).toBeDisabled();
    await page
      .getByRole("button", { name: "Wallet & balance", exact: true })
      .click();
    const banner = page
      .getByRole("status")
      .filter({ hasText: "New chats and deposits are paused" });
    const retry = banner.getByRole("button", {
      name: "Retry connection",
      exact: true,
    });
    const deposit = page.getByRole("dialog").getByRole("button", {
      name: "Add funds",
      exact: true,
    });
    const withdrawal = page.getByRole("button", {
      name: "Withdraw balance",
      exact: true,
    });
    await expect(banner).toBeVisible();
    await expect(banner).toContainText(
      unavailableComponent === "snapshot"
        ? "Could not verify the latest confirmed Solana state."
        : "Could not confirm that the payment service is ready.",
    );
    await expect(banner).toContainText("New chats and deposits are paused.");
    await expect(banner).toContainText(
      "Your saved funds and recovery options remain available.",
    );
    await expect(retry).toBeEnabled();
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toHaveCount(0);
    await expect(withdrawal).toBeEnabled();
    await expect(
      page.getByText("This deposit cannot authorize new messages.", {
        exact: false,
      }),
    ).toHaveCount(0);
    await retry.click();
    await expect(retry).toBeEnabled();
    await expect(banner).toBeVisible();
    await expect(
      page.getByRole("button", { name: "Review deposit", exact: true }),
    ).toHaveCount(0);
    await expect(withdrawal).toBeEnabled();
    expect(
      await page.evaluate(() =>
        localStorage.getItem("zkchat:test-service-checks"),
      ),
    ).toBe("1");
    await retry.click();
    await expect(banner).toHaveCount(0);
    await expect(
      page.getByRole("button", { name: "Return to chat", exact: true }),
    ).toBeEnabled();
    await expect(deposit).toBeEnabled();
    await expect(page.getByLabel("Saved deposits")).toHaveCount(0);
    expect(
      await page.evaluate(() => ({
        checks: localStorage.getItem("zkchat:test-service-checks"),
        note: localStorage.getItem("zkchat:test-status-note"),
        chat: localStorage.getItem("zkchat:test-calls"),
        recovery: localStorage.getItem("zkchat:test-recoveries"),
        withdrawal: localStorage.getItem("zkchat:test-withdrawals"),
      })),
    ).toEqual({
      checks: "2",
      note: "existing-funded-note",
      chat: null,
      recovery: null,
      withdrawal: null,
    });
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(input(page)).toHaveValue(draft);
    await expect(send(page)).toBeEnabled();
    await send(page).click();
    await finish(page);
    const calls = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("zkchat:test-calls") ?? "[]"),
    );
    expect(calls).toHaveLength(1);
    expect(calls[0].messages.at(-1)).toMatchObject({
      role: "user",
      content: draft,
    });
  });
}

test("Kit wallet connector discovers, automatically selects and disconnects the exact Wallet Standard account", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this test-only module in development.
    const { runWalletLifecycle } = await import("/tests/walletHarness.ts");
    return runWalletLifecycle();
  });
  expect(result).toEqual({
    sameAccount: true,
    address: "11111111111111111111111111111111",
    remaining: 0,
  });
});

test("Kit connector uses the newly approved account even when another address is already authorized", async ({
  page,
}) => {
  await page.goto("/");
  const result = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this test-only module in development.
    const { runWalletSelectedAccountLifecycle } =
      await import("/tests/walletHarness.ts");
    return runWalletSelectedAccountLifecycle();
  });
  expect(result).toEqual({
    sameAccount: true,
    activeAddress: "11111111111111111111111111111111",
    previousAddress: "4vJ9JU1bJJE96FWSJKvHsmmFADCg4gpZQff4P3bkLKi",
    remaining: 0,
  });
});

test("Kit connector preserves a wallet internal failure without starting SDK work", async ({
  page,
}) => {
  await page.goto("/");
  const failure = await page.evaluate(async () => {
    // @ts-expect-error Vite serves this test-only module in development.
    const { runWalletLifecycle } = await import("/tests/walletHarness.ts");
    try {
      await runWalletLifecycle(-32603);
      return null;
    } catch (error) {
      return (error as Error).message;
    }
  });
  expect(failure).toContain("internal connection error (code -32603)");
  expect(failure).toContain("No transaction was requested");
});

test("wallet rejection shows actionable diagnostics and a retry connects without selecting an address", async ({
  page,
}) => {
  const source =
    'import { walletConnectionError } from "/src/lib/walletErrors.ts";\n' +
    liveStub.replace(
      "export const connectWalletAccount = async () => account;",
      `let attempts = 0;
       export const connectWalletAccount = async () => {
         localStorage.setItem('zkchat:test-connect-attempts', String(++attempts));
         if (attempts === 1) throw walletConnectionError("Test Wallet", {code: 4001});
         return account;
       };`,
    );
  await connectFixture(page, source);
  await expect(page.getByRole("dialog")).toContainText(
    "Test Wallet connection was declined",
  );
  const connect = page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", {
      name: "Connect wallet",
      exact: true,
    });
  await expect(connect).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Select wallet", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Wallet & balance", exact: true }),
  ).not.toContainText("1111");
  await expect(
    page.getByLabel("2. Select an account", { exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).not.toContainText(
    "Check your balance",
  );
  await connect.click();
  await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
  await expect(
    page.getByRole("button", { name: "Wallet & balance", exact: true }),
  ).toHaveAttribute("title", /1111/);
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zkchat:test-connect-attempts"),
    ),
  ).toBe("2");
});

// The fixture returns the account chosen by the extension. The UI must use that
// exact account for SDK setup and must not introduce another account chooser.
function connectionFlowStub(
  options: {
    pending?: boolean;
    storageMissing?: boolean;
    sdkFailure?: boolean;
  } = {},
) {
  return (
    liveStub
      .replace(
        "const wallet = { name: 'Test Wallet' };",
        `
      const secondAccount = { address: '22222222222222222222222222222222' };
      const icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>';
      const wallet = { name: 'Test Wallet', icon, accounts: [account, secondAccount] };
      const secondWallet = { name: 'Second Wallet', icon, accounts: [secondAccount, account] };
      window.testWalletCalls = [];
      window.testSdkCalls = [];
    `,
      )
      .replace(
        "export const listWallets = () => [wallet];",
        "export const listWallets = () => [wallet, secondWallet];",
      )
      .replace(
        "export const connectWalletAccount = async () => account;",
        `
      export const connectWalletAccount = async selectedWallet => {
        window.testWalletCalls.push(selectedWallet.name);
        ${options.pending ? "await new Promise(resolve => { window.testApproveWallet = resolve; });" : ""}
        return selectedWallet.accounts[0];
      };
    `,
      )
      .replace("export const connectZkapi =", "const createHandle =") +
    `
      export const connectZkapi = async (_config, selectedWallet, selectedAccount, initialize) => {
        window.testSdkCalls.push({wallet: selectedWallet.name, address: selectedAccount.address, initialize});
        ${options.storageMissing ? "if (!initialize) throw new BrowserStorageMissing();" : ""}
        ${options.sdkFailure ? "if (window.testSdkCalls.length === 1) throw new Error('Temporary service failure');" : ""}
        return {...await createHandle(), wallet: selectedWallet, account: selectedAccount};
      };
    `
  );
}

const connectionCalls = (page: Page) =>
  page.evaluate(() => ({
    wallets: (window as unknown as { testWalletCalls: string[] })
      .testWalletCalls,
    sdk: (
      window as unknown as {
        testSdkCalls: {
          wallet: string;
          address: string;
          initialize: boolean;
        }[];
      }
    ).testSdkCalls,
  }));

for (const width of [375, 1280]) {
  test(`wallet dropdown uses the extension account and shows its address at ${width}px`, async ({
    page,
    context,
  }) => {
    await context.grantPermissions(["clipboard-read", "clipboard-write"]);
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/src/lib/zkapi.ts*", (route) =>
      route.fulfill({
        contentType: "application/javascript",
        body: connectionFlowStub(),
      }),
    );
    await page.goto("/");
    const topbar = page.getByRole("button", {
      name: "Wallet & balance",
      exact: true,
    });
    await expect(topbar).toContainText("Wallet & balance");
    await topbar.click();
    const dropdown = page.getByRole("button", {
      name: "Select wallet",
      exact: true,
    });
    await expect(dropdown).toContainText("Test Wallet");
    await expect(
      page.getByLabel("2. Select an account", { exact: true }),
    ).toHaveCount(0);
    await dropdown.focus();
    await page.keyboard.press("Enter");
    await expect(
      page
        .getByRole("listbox", { name: "Available wallets" })
        .getByRole("option"),
    ).toHaveCount(2);
    await page.keyboard.press("ArrowDown");
    await page.keyboard.press("Enter");
    await expect(dropdown).toContainText("Second Wallet");
    expect(await connectionCalls(page)).toEqual({ wallets: [], sdk: [] });
    await dropdown.click();
    await page.screenshot({
      path: test.info().outputPath(`wallet-picker-${width}.png`),
      fullPage: true,
    });
    await page.keyboard.press("Escape");
    await expect(dropdown).toHaveAttribute("aria-expanded", "false");
    await expect(
      page.getByRole("dialog", { name: "Wallet & balance" }),
    ).toBeVisible();
    await page
      .getByRole("dialog", { name: "Wallet & balance" })
      .getByRole("button", { name: "Connect wallet", exact: true })
      .click();
    await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
    expect(await connectionCalls(page)).toEqual({
      wallets: ["Second Wallet"],
      sdk: [
        {
          wallet: "Second Wallet",
          address: "22222222222222222222222222222222",
          initialize: false,
        },
      ],
    });
    const connected = page.getByRole("button", {
      name: "Wallet & balance",
      exact: true,
    });
    await expect(connected).toHaveAttribute("title", /Second Wallet: 2222/);
    await expect(page.locator(".connected-wallet-summary")).toContainText(
      "2222",
    );
    await expect(
      page.getByRole("button", { name: "Copy wallet address", exact: true }),
    ).toBeVisible();
    await page
      .getByRole("button", { name: "Copy wallet address", exact: true })
      .click();
    expect(await page.evaluate(() => navigator.clipboard.readText())).toBe(
      "22222222222222222222222222222222",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await expect(connected).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: test.info().outputPath(`wallet-connected-${width}.png`),
      fullPage: true,
    });
    await connected.click();
    await page.getByRole("button", { name: "Disconnect", exact: true }).click();
    await expect(topbar).toContainText("Wallet & balance");
    await expect(
      page.getByRole("button", { name: "Select wallet", exact: true }),
    ).toBeVisible();
  });
}

test("pending wallet approval prevents duplicate connects and only opens SDK after approval", async ({
  page,
}) => {
  await connectFixture(page, connectionFlowStub({ pending: true }));
  await expect(
    page.getByRole("button", { name: "Select wallet", exact: true }),
  ).toBeDisabled();
  await expect(
    page.getByRole("button", { name: "Connecting…", exact: true }),
  ).toBeDisabled();
  expect(await connectionCalls(page)).toEqual({
    wallets: ["Test Wallet"],
    sdk: [],
  });
  await page.evaluate(() =>
    (
      window as unknown as { testApproveWallet: () => void }
    ).testApproveWallet(),
  );
  await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
  await expect(
    page.getByRole("button", { name: "Wallet & balance", exact: true }),
  ).toHaveAttribute("title", /1111/);
  expect(await connectionCalls(page)).toEqual({
    wallets: ["Test Wallet"],
    sdk: [
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: false,
      },
    ],
  });
});

test("SDK setup retry keeps the approved wallet after closing and reopening settings", async ({
  page,
}) => {
  await connectFixture(page, connectionFlowStub({ sdkFailure: true }));
  await expect(page.getByRole("dialog")).toContainText(
    "Could not open your saved deposits",
  );
  const connected = page.getByRole("button", {
    name: "Wallet & balance",
    exact: true,
  });
  await expect(page.locator(".connected-wallet-summary")).toContainText("1111");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await connected.click();
  await page
    .getByRole("button", { name: "Continue to deposits", exact: true })
    .click();
  await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
  expect(await connectionCalls(page)).toEqual({
    wallets: ["Test Wallet"],
    sdk: [
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: false,
      },
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: false,
      },
    ],
  });
});

test("first-time browser storage setup keeps the approved address and requires explicit setup", async ({
  page,
}) => {
  await connectFixture(page, connectionFlowStub({ storageMissing: true }));
  const setup = page.getByRole("button", {
    name: "Set up this browser",
    exact: true,
  });
  await expect(setup).toBeEnabled();
  await expect(
    page.getByText(
      "Already deposited? Restore from your recovery file, or use the original browser and wallet.",
      {
        exact: true,
      },
    ),
  ).toBeVisible();
  await page.getByText("Older deposit data", { exact: true }).click();
  await expect(
    page.getByRole("link", {
      name: "Open October 8 deposit data",
      exact: true,
    }),
  ).toHaveAttribute("href", "/recovery-v12/");
  const connected = page.getByRole("button", {
    name: "Wallet & balance",
    exact: true,
  });
  await expect(connected).toHaveAttribute("title", /1111/);
  expect(await connectionCalls(page)).toEqual({
    wallets: ["Test Wallet"],
    sdk: [
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: false,
      },
    ],
  });
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await connected.click();
  await expect(setup).toBeEnabled();
  await setup.click();
  await expect(page.locator(".topbar-status")).toHaveText("ZKAPI");
  expect(await connectionCalls(page)).toEqual({
    wallets: ["Test Wallet"],
    sdk: [
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: false,
      },
      {
        wallet: "Test Wallet",
        address: "11111111111111111111111111111111",
        initialize: true,
      },
    ],
  });
  await expect(setup).toHaveCount(0);
});

test("expiry and emergency recovery remain visible without replaying inference", async ({
  page,
}) => {
  const source = liveStub
    .replace(
      "canRequest: true, wallet:",
      "canRequest: false, canPrepareEmergencyEscape: true, canReconcileChallengedEscape: true, emergencyEscape: { phase: 'challenged' }, expiry: { severity: 'one_day', message: 'This note expires within one day.' }, wallet:",
    )
    .replace(
      "status: async () => state,",
      "status: async () => state, prepareEmergencyEscape: async destination => { localStorage.setItem('zkchat:test-escape', destination); update({ canPrepareEmergencyEscape: false, walletOperation: { kind: 'initiate_escape', phase: 'ready', signature: null } }); }, reconcileChallengedEscape: async () => { localStorage.setItem('zkchat:test-challenge', '1'); },",
    );
  await connectFixture(page, source);
  await expect(
    page.getByText("This deposit expires within 24 hours"),
  ).toBeVisible();
  await page.getByText("Delayed withdrawal options", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check withdrawal dispute", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Start delayed withdrawal",
      exact: true,
    })
    .click();
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-escape")),
  ).toBe("11111111111111111111111111111111");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-challenge")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
  await page.getByText("Transaction details", { exact: true }).click();
  await expect(
    page.getByText("initiate_escape / ready", { exact: true }),
  ).toBeVisible();
});

test("unsent authorization cancellation is explicit and never offered for uncertain AUTH", async ({
  page,
}) => {
  const source = liveStub
    .replace(
      "session: null, walletOperation:",
      "session: {phase:'prepared', operations:[]}, walletOperation:",
    )
    .replace(
      "status: async () => state,",
      "status: async () => state, cancelUnsentAuthorization: async () => {localStorage.setItem('zkchat:test-cancel', '1'); update({session: {phase:'send_unknown', operations:[]}});},",
    );
  await connectFixture(page, source);
  await page.getByText("Payment details and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Cancel unused authorization", exact: true })
    .click();
  await expect(
    page.getByText("Authorization cancelled. No message was sent."),
  ).toBeVisible();
  await expect(
    page.getByRole("button", {
      name: "Cancel unused authorization",
      exact: true,
    }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-cancel")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
});

test("unsigned withdrawal fallback and signed setup recovery use separate explicit actions", async ({
  page,
}) => {
  const source = liveStub
    .replace(
      "walletOperation: null",
      "walletOperation: {kind:'mutual_close', phase:'proving', signature:null}",
    )
    .replace(
      "status: async () => state,",
      "status: async () => state, resumeWalletProof: async () => {throw new Error('proof unavailable')}, advanceWallet: async () => ({state:'expired_reconcile_required'}), fallbackToEscape: async () => {localStorage.setItem('zkchat:test-fallback','1'); update({walletOperation:{kind:'initiate_escape',phase:'ready',signature:'saved-create-signature'}});}, recoverExpiredWalletSetup: async () => {localStorage.setItem('zkchat:test-setup-check','1');},",
    );
  await connectFixture(page, source);
  await expect(
    page.getByText("Blocked withdrawal options", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Resume withdrawal preparation", exact: true })
    .click();
  await page.getByText("Blocked withdrawal options", { exact: true }).click();
  await page
    .getByRole("button", {
      name: "Use delayed withdrawal",
      exact: true,
    })
    .click();
  await expect(
    page.getByText("Blocked withdrawal options", { exact: true }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Expired setup recovery", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await page.getByText("Expired setup recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Check expired setup", exact: true })
    .click();
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-fallback")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-setup-check")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
});

test("standalone Wallet Standard diagnostic requires explicit choice and surfaces extension errors", async ({
  page,
}) => {
  await page.goto("/wallet-check.html");
  await page.evaluate(async () => {
    // @ts-expect-error Test-only Vite module.
    const { registerTestWallet } = await import("/tests/walletHarness.ts");
    registerTestWallet(-32603);
  });
  await expect(
    page.getByRole("button", { name: "Check Wallet Standard connection" }),
  ).toBeDisabled();
  await page
    .getByLabel("Wallet", { exact: true })
    .selectOption({ label: "Integration Test Wallet" });
  await page
    .getByRole("button", { name: "Check Wallet Standard connection" })
    .click();
  await expect(page.getByRole("status")).toContainText(
    "internal connection error (code -32603)",
  );
  await expect(page.getByRole("status")).toContainText(
    "did not use the Kit connector or ZKAPI",
  );
});

test("withdrawal explains its irreversible start and preserves explicit approvals", async ({
  page,
}) => {
  const source = liveStub.replace(
    "status: async () => state,",
    `status: async () => state,
    prepareWithdrawal: async () => { localStorage.setItem('zkchat:test-withdrawal-started','1'); update({walletOperation:{kind:'mutual_close',phase:'ready',signature:null},canRequest:false}); },
    advanceWallet: async () => {
      const n = Number(localStorage.getItem('zkchat:test-advances') || 0) + 1;
      localStorage.setItem('zkchat:test-advances',String(n));
      update(n === 4 ? {walletOperation:null,wallet:'closed'} : {walletOperation:{kind:'mutual_close',phase:'ready',signature:n % 2 ? 'saved-signature' : null}});
      return {state:n === 4 ? 'complete' : n % 2 ? 'pending' : 'ready'};
    },`,
  );
  await connectFixture(page, source);
  await page
    .getByRole("button", { name: "Return to chat", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Withdraw balance", exact: true })
    .click();
  await expect(
    page.getByText(/approve several transactions, each with a SOL fee/),
  ).toBeVisible();
  await expect(
    page.getByText(
      /Starting withdrawal stops this deposit from paying for chats/,
    ),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zkchat:test-withdrawal-started"),
    ),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Keep using this deposit", exact: true })
    .click();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zkchat:test-withdrawal-started"),
    ),
  ).toBeNull();
  await page
    .getByRole("button", { name: "Withdraw balance", exact: true })
    .click();
  await page
    .getByRole("button", {
      name: "Start withdrawal",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/Withdrawal sends a proof in several transactions/),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Withdrawal in progress", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("zkchat:test-withdrawal-started"),
    ),
  ).toBe("1");
  // Starting withdrawal changes admission before any wallet transaction is signed.
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-advances")),
  ).toBeNull();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await input(page).fill("Keep this draft while withdrawing");
  await expect(send(page)).toBeDisabled();
  await expect(
    page.getByText(
      "This deposit is being withdrawn and cannot pay for chats. Finish withdrawing, then use another saved deposit or add funds.",
    ),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await expect(page.getByRole("dialog")).toContainText(
    "Withdrawal in progress",
  );
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByText(/Finish the saved operation before switching deposits/),
  ).toBeVisible();
  await expect(page.getByLabel("Saved deposits")).toBeDisabled();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await expect(
    page.getByRole("dialog").getByRole("button", {
      name: "Continue withdrawal",
      exact: true,
    }),
  ).toHaveCount(1);
  await expect(
    page.getByRole("link", { name: "View latest transaction", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("Expired setup recovery", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  // A confirmed upload step keeps the withdrawal locked and needs another
  // explicit approval; it must not be presented as a completed withdrawal.
  await expect(
    page.getByRole("heading", { name: "Withdrawal in progress", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-advances")),
  ).toBe("2");
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await page
    .getByRole("dialog")
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  // The earlier Add funds request resumes only after the withdrawal completes.
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Withdrawal complete", exact: true }),
  ).toBeVisible();
  await expect(page.locator(".balance-panel strong")).toHaveText("0.00");
  await expect(page.locator(".credit-line strong")).toHaveText("0.00");
  await expect(
    page.getByRole("heading", { name: "Withdrawal in progress", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-advances")),
  ).toBe("4");
});

test("withdrawal confirmation is automatic, approvals stay explicit, and closing the panel does not stop it", async ({
  page,
}) => {
  const source = liveStub.replace(
    "status: async () => state,",
    `status: async () => state,
    prepareWithdrawal: async () => update({canRequest:false,walletOperation:{kind:'mutual_close',phase:'ready',signature:null}}),
    advanceWallet: async () => {
      const count=Number(localStorage.getItem('observation:approvals')||0)+1;
      localStorage.setItem('observation:approvals',String(count));
      update({walletOperation:{kind:'mutual_close',phase:'ready',signature:'signed-'+count}});
      return {state:'pending'};
    },
    observeWallet: async signature => {
      localStorage.setItem('observation:checks',String(Number(localStorage.getItem('observation:checks')||0)+1));
      if(signature!==state.walletOperation?.signature) throw new Error('stale signature');
      if(localStorage.getItem('observation:confirm')!==signature) return {state:'pending'};
      update(signature==='signed-2' ? {wallet:'closed',walletOperation:null} : {walletOperation:{kind:'mutual_close',phase:'ready',signature:null}});
      return {state:signature==='signed-2'?'complete':'ready'};
    },`,
  );
  await connectFixture(page, source);
  const dialog = page.getByRole("dialog");
  await dialog
    .getByRole("button", { name: "Withdraw balance", exact: true })
    .click();
  await dialog
    .getByRole("button", { name: "Start withdrawal", exact: true })
    .click();
  await expect(page.locator(".wallet-caption")).toContainText("Withdrawing");
  await expect(page.locator(".wallet-summary")).toContainText(
    "Last confirmed amount",
  );
  await dialog
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Confirming transaction…",
      exact: true,
    }),
  ).toBeDisabled();
  await expect
    .poll(() =>
      page.evaluate(() =>
        Number(localStorage.getItem("observation:checks") || 0),
      ),
    )
    .toBeGreaterThan(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await input(page).fill("Keep my draft while confirming");
  await page.evaluate(() =>
    localStorage.setItem("observation:confirm", "signed-1"),
  );
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", { name: "Continue withdrawal", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toContainText("Your next wallet approval is needed.");
  await dialog.screenshot({
    path: test.info().outputPath("withdrawal-next-approval.png"),
  });
  expect(
    await page.evaluate(() => localStorage.getItem("observation:approvals")),
  ).toBe("1");
  await expect(send(page)).toBeDisabled();
  await dialog
    .getByRole("button", { name: "Continue withdrawal", exact: true })
    .click();
  await expect(
    dialog.getByRole("button", {
      name: "Confirming transaction…",
      exact: true,
    }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page.evaluate(() =>
    localStorage.setItem("observation:confirm", "signed-2"),
  );
  await expect(page.locator(".credit-line strong")).toHaveText("0.00");
  await expect(input(page)).toHaveValue("Keep my draft while confirming");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Withdrawal complete", exact: true }),
  ).toBeVisible();
  await expect(dialog).toContainText("Your funds are back in your wallet.");
  await dialog.screenshot({
    path: test.info().outputPath("withdrawal-complete.png"),
  });
  await expect(dialog.getByLabel("Saved deposits")).toBeEnabled();
  expect(
    await page.evaluate(() => localStorage.getItem("observation:approvals")),
  ).toBe("2");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-calls")),
  ).toBeNull();
});

test("a saved signed withdrawal is checked on reconnect without advancing or guessing a zero balance", async ({
  page,
}) => {
  await page.clock.install();
  const source = liveStub
    .replace(
      "walletOperation: null,",
      "walletOperation: {kind:'mutual_close',phase:'ready',signature:'already-signed'},",
    )
    .replace("canRequest: true,", "canRequest: false,")
    .replace(
      "status: async () => state,",
      `status: async () => state,
      advanceWallet: async () => { localStorage.setItem('observation:unexpected-advance','1'); throw new Error('must stay explicit'); },
      observeWallet: async signature => {
        if(signature!=='already-signed') throw new Error('wrong signature');
        if(!localStorage.getItem('observation:available')) throw new Error('indexer unavailable');
        update({wallet:'closed',walletOperation:null});return {state:'complete'};
      },`,
    );
  await connectFixture(page, source);
  const dialog = page.getByRole("dialog");
  await expect(
    dialog.getByRole("heading", {
      name: "Withdrawal in progress",
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".credit-line strong")).toHaveText("2.00");
  await expect(page.locator(".wallet-summary")).toContainText(
    "unavailable for chats",
  );
  await dialog.screenshot({
    path: test.info().outputPath("withdrawal-confirming.png"),
  });
  await page.clock.runFor(95_000);
  await expect(
    dialog.getByRole("button", { name: "Check confirmation", exact: true }),
  ).toBeEnabled();
  await expect(dialog).toContainText(
    "Confirmation is taking longer. Your progress is saved.",
  );
  await expect(page.locator(".credit-line strong")).toHaveText("2.00");
  await page.evaluate(() => localStorage.setItem("observation:available", "1"));
  await dialog
    .getByRole("button", { name: "Check confirmation", exact: true })
    .click();
  await expect(
    dialog.getByRole("heading", { name: "Withdrawal complete", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() =>
      localStorage.getItem("observation:unexpected-advance"),
    ),
  ).toBeNull();
});
