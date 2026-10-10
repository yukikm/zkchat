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
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(
    page.getByRole("dialog", { name: "Connection settings" }),
  ).toContainText("Live chat is not set up");
  await expect(
    page.getByRole("button", { name: "Review deposit", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("dialog", { name: "Connection settings" })
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
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Test Wallet' };
export const configuredModels = config => config?.models ?? [];
export const configuredMode = config => config.mode;
export const configuredStreaming = () => true;
export const loadConfig = async () => ({ label: 'Test Operator', mode: 'proxy', models: [{ id: 'test/model', label: 'Test Model', apis: ['chat'] }] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWallet = async () => [account];
let state = { mode: 'proxy', canRequest: true, wallet: 'active', busy: false, session: null, walletOperation: null, settledBalanceMicroUsdc: '2000000', authorizationCapMicroUsdc: '100000' };
const listeners = new Set();
const update = patch => { state = { ...state, ...patch }; for (const fn of listeners) fn(state); };
const calls = []; let recoveries = 0;
const frame = value => 'data: ' + JSON.stringify(value) + '\\n\\n';
export const connectZkapi = async () => ({ account, persistence: 'persistent', publicAdmissionReady: true, deployment: { mint: 'fixture-mint' }, async refreshPreflight() {}, dispose() {}, client: {
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
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Test Wallet", exact: true }).click();
  await page
    .getByLabel("2. Select an account", { exact: true })
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(page.getByText("Ready to chat.")).toBeVisible();
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
    .getByRole("button", { name: "Review payment", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Check payment", exact: true })
    .click();
  await expect(
    page.getByText("Payment checked. Follow the status below."),
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
      name: "Connection settings",
      exact: true,
    });
    await settings.focus();
    await page.keyboard.press("Enter");
    await expect(
      page.getByRole("dialog", { name: "Connection settings" }),
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
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Test Wallet", exact: true }).click();
  await page
    .getByLabel("2. Select an account", { exact: true })
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
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
  await page.getByRole("button", { name: "Connected", exact: true }).click();
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

test("public onboarding invitation stays in memory and clears after disconnect", async ({
  page,
}) => {
  const invitation = "A".repeat(43);
  const publicStub = liveStub
    .replace(
      "label: 'Test Operator', mode:",
      "schema: 2, label: 'Test Operator', mode:",
    )
    .replace(
      "async () => ({ account, persistence:",
      "async (_config, _wallet, _account, _initialize, token) => { window.testInvitationWasPassed = token === '" +
        invitation +
        "'; return ({ account, persistence:",
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
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page.getByText("Have an invitation?", { exact: true }).click();
  await page.getByLabel("Invitation code").fill(invitation);
  await page.getByRole("button", { name: "Test Wallet", exact: true }).click();
  await page
    .getByLabel("2. Select an account", { exact: true })
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(
    page.getByText("Wallet connected.", { exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(() => (window as any).testInvitationWasPassed),
  ).toBe(true);
  expect(
    await page.evaluate(() =>
      JSON.stringify({
        local: { ...localStorage },
        session: { ...sessionStorage },
      }),
    ),
  ).not.toContain(invitation);
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.getByLabel("Invitation code")).toHaveValue("");
  await page.reload();
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await expect(page.getByLabel("Invitation code")).toHaveValue("");
});

test("Kit wallet connector discovers, connects, selects and disconnects the exact Wallet Standard account", async ({
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

test("wallet rejection shows actionable diagnostics and allows a deliberate retry", async ({
  page,
}) => {
  const source =
    'import { walletConnectionError } from "/src/lib/walletErrors.ts";\n' +
    liveStub.replace(
      "export const connectWallet = async () => [account];",
      'export const connectWallet = async () => { throw walletConnectionError("Phantom", {code: -32603}); };',
    );
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: source }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page.getByRole("button", { name: "Test Wallet", exact: true }).click();
  await expect(page.getByRole("dialog")).toContainText(
    "Phantom returned an internal connection error (code -32603)",
  );
  await expect(
    page.getByRole("button", { name: "Test Wallet", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Connect account", exact: true }),
  ).toBeDisabled();
  await expect(page.getByRole("dialog")).not.toContainText(
    "Check your balance",
  );
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
    page.getByText("This note expires within one day."),
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
    .getByRole("button", { name: "Resume preparation", exact: true })
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
    .getByRole("button", { name: "Check transaction", exact: true })
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

test("withdrawal explains multiple approvals and separates signing from saved transaction checks", async ({
  page,
}) => {
  const source = liveStub.replace(
    "status: async () => state,",
    `status: async () => state,
    prepareWithdrawal: async () => update({walletOperation:{kind:'mutual_close',phase:'ready',signature:null},canRequest:false}),
    advanceWallet: async () => {
      const n = Number(localStorage.getItem('zkchat:test-advances') || 0) + 1;
      localStorage.setItem('zkchat:test-advances',String(n));
      update(n === 1 ? {walletOperation:{kind:'mutual_close',phase:'ready',signature:'saved-signature'}} : {walletOperation:null,wallet:'closed'});
      return {state:n === 1 ? 'pending' : 'complete'};
    },`,
  );
  await connectFixture(page, source);
  await page
    .getByRole("button", { name: "Withdraw balance", exact: true })
    .click();
  await expect(
    page.getByText(/approve several transactions, each with a SOL fee/),
  ).toBeVisible();
  await page
    .getByRole("button", {
      name: "Review withdrawal",
      exact: true,
    })
    .click();
  await expect(
    page.getByText(/Withdrawal needs several wallet approvals/),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Approve in wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", {
      name: "Approve in wallet",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    page.getByText("Expired setup recovery", { exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Check transaction", exact: true })
    .click();
  await expect(
    page.getByText("Withdrawal complete. Your funds are back in your wallet.", {
      exact: true,
    }),
  ).toBeVisible();
  await expect(page.locator(".balance-panel strong")).toHaveText("0.00");
  await expect(page.locator(".credit-line strong")).toHaveText("0.00");
  expect(
    await page.evaluate(() => localStorage.getItem("zkchat:test-advances")),
  ).toBe("2");
});
