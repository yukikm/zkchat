import { expect, test, type Page } from "@playwright/test";

// Offline fixtures model the SDK returning successfully with work still pending.
// No wallet, authorization, inference, or financial API is contacted.
async function openPayment(
  page: Page,
  outcome: "closing" | "send_unknown" | "cleared",
  recovery?: Record<string, unknown>,
) {
  const phase = outcome === "send_unknown" ? "send_unknown" : "closing";
  await page.route("**/zkapi-config.json", (route) =>
    route.fulfill({ json: null }),
  );
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateZkchatRecoveryFile() {}
export class RecoverySetupIncomplete extends RecoveryError {}
export const restoreZkchatDeposits = async () => { throw new Error('Unexpected recovery'); };
export const finishZkchatRecoverySetup = async () => { throw new Error('Unexpected recovery setup'); };
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Payment Recovery Test Wallet' };
const recovery = ${JSON.stringify(recovery ?? null)};
export const configuredModels = config => config?.models ?? [];
export const configuredMode = () => 'direct_openrouter';
export const configuredStreaming = () => true;
export const loadConfig = async () => ({ schema: 1, mode: 'direct_openrouter', models: [{ id: 'test/model', apis: ['chat'] }] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
let state = { noteId: 'saved-deposit', mode: 'direct_openrouter', wallet: 'active', busy: false,
  canRequest: false, session: { id: 'saved-payment', phase: '${phase}', operations: [],
    ...(recovery ? { serverState: recovery.serverState, recovery: recovery.recovery } : {}) },
  ...(recovery ? { recovery } : {}),
  walletOperation: null, emergencyEscape: null, canPrepareEmergencyEscape: true,
  settledBalanceMicroUsdc: '2000000', authorizationCapMicroUsdc: '1000000' };
const listeners = new Set();
const calls = [];
const record = name => { calls.push(name); localStorage.setItem('payment-recovery:calls', JSON.stringify(calls)); };
export const connectZkapi = async () => ({ account, wallet, recoveryEnabled: true, persistence: 'persistent', publicAdmissionReady: true,
  deposits: [{ id: 'saved-deposit' }, { id: 'retained-other-deposit' }], selectedDepositId: 'saved-deposit', deployment: { mint: 'fixture-mint' },
  async refreshPreflight() {}, dispose() {}, client: {
    status: async () => state,
    subscribe: listener => { listeners.add(listener); return () => listeners.delete(listener); },
    recover: async () => {
      record('recover');
      if ('${outcome}' === 'cleared') state = { ...state, session: null, canRequest: true, canPrepareEmergencyEscape: false };
      for (const listener of listeners) listener(state);
      return recovery ?? undefined;
    },
    chat: async () => { record('chat'); throw new Error('Unexpected inference'); },
    prepareEmergencyEscape: async () => { record('withdrawal'); throw new Error('Unexpected withdrawal'); },
    prepareWithdrawal: async () => { record('withdrawal'); throw new Error('Unexpected withdrawal'); },
    advanceWallet: async () => { record('wallet'); throw new Error('Unexpected wallet action'); },
  }
});`,
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  const panel = page.getByRole("dialog", { name: "Wallet & balance" });
  await panel
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(panel.getByLabel("Saved deposits")).toHaveValue("saved-deposit");
  return panel;
}

for (const phase of ["closing", "send_unknown"] as const) {
  test(`resolved recover call still warns when ${phase} remains, without replay or withdrawal`, async ({
    page,
  }) => {
    const panel = await openPayment(page, phase);
    const balance = await panel.locator(".balance-panel strong").innerText();
    await expect(
      panel.getByRole("heading", {
        name: "Payment needs attention",
        exact: true,
      }),
    ).toBeVisible();
    await panel
      .getByText("Delayed withdrawal options", { exact: true })
      .click();
    await expect(panel).toContainText("Optional withdrawal — not started.");
    await panel
      .getByRole("button", { name: "Resolve payment", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(
      phase === "closing"
        ? "Settlement is still pending."
        : "Payment is still unresolved.",
    );
    await expect(panel.getByRole("alert")).toContainText(
      "This check did not resend your message or start a withdrawal.",
    );
    await expect(panel).not.toContainText("This payment is no longer pending.");
    await expect(panel.getByLabel("Saved deposits")).toHaveValue(
      "saved-deposit",
    );
    await expect(panel.locator(".balance-panel strong")).toHaveText(balance);
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("payment-recovery:calls")!),
      ),
    ).toEqual(["recover"]);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Retained draft");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
  });
}

test("cleared payment reports resolution and permits a new message without sending it", async ({
  page,
}) => {
  const panel = await openPayment(page, "cleared");
  const balance = await panel.locator(".balance-panel strong").innerText();
  await panel
    .getByRole("button", { name: "Resolve payment", exact: true })
    .click();
  await expect(panel).toContainText(
    "This payment is no longer pending. No message was resent.",
  );
  await expect(panel.getByRole("alert")).toHaveCount(0);
  await expect(
    panel.getByRole("heading", {
      name: "Payment needs attention",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(
    panel.getByRole("button", {
      name: "Start delayed withdrawal",
      exact: true,
    }),
  ).toHaveCount(0);
  await expect(panel.getByLabel("Saved deposits")).toHaveValue("saved-deposit");
  await expect(panel.locator(".balance-panel strong")).toHaveText(balance);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("payment-recovery:calls")!),
    ),
  ).toEqual(["recover"]);
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("New draft");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});

for (const [reasonCode, explanation, operator] of [
  ["provider_key_absent", "No provider key was found.", true],
  ["provider_lookup_failed", "The provider key lookup failed.", false],
] as const) {
  test(`SDK .15 keeps ${reasonCode} distinct and preserves unknown issuance`, async ({
    page,
  }) => {
    const panel = await openPayment(page, "closing", {
      outcome: "pending",
      reasonCode,
      sessionId: "saved-payment",
      serverState: "ISSUANCE_UNKNOWN",
      recovery: {
        reason_code: reasonCode,
        requires_operator_action: operator,
        issuance: {
          stage: "response",
          reason_code: "http_rejected",
          http_status: 403,
          issuance_certainty: "unknown",
        },
        ...(operator
          ? {}
          : {
              lookup: {
                stage: "request",
                reason_code: "timeout",
                issuance_certainty: "unknown",
              },
            }),
      },
    });
    await panel
      .getByText("Payment details and recovery", { exact: true })
      .click();
    await expect(panel.getByText("Payment reference:")).toHaveText(
      "Payment reference: saved-payment",
    );
    await expect(panel).toContainText("Server state: ISSUANCE_UNKNOWN");
    await expect(panel).toContainText("Recovery: pending.");
    await expect(panel).toContainText(explanation);
    await expect(panel).toContainText(
      "Original issuance: The provider rejected the request. HTTP 403.",
    );
    if (operator)
      await expect(panel).toContainText(
        "The service operator needs to investigate this session.",
      );
    else
      await expect(panel).toContainText(
        "Latest lookup: The provider request timed out.",
      );
    await panel
      .getByRole("button", { name: "Resolve payment", exact: true })
      .click();
    await expect(panel.getByRole("alert")).toContainText(explanation);
    await expect(panel.getByRole("alert")).toContainText(
      "Sending remains paused.",
    );
    await expect(panel.getByLabel("Saved deposits")).toHaveValue(
      "saved-deposit",
    );
    await expect(panel.locator(".balance-panel strong")).toHaveText("2.00");
    expect(
      await page.evaluate(() =>
        JSON.parse(localStorage.getItem("payment-recovery:calls")!),
      ),
    ).toEqual(["recover"]);
    await panel.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Keep this draft");
    await expect(
      page.getByRole("button", { name: "Send message", exact: true }),
    ).toBeDisabled();
  });
}

test("SDK .15 failed recovery is not reported as a successful check", async ({
  page,
}) => {
  const panel = await openPayment(page, "closing", {
    outcome: "failed",
    reasonCode: "control_unavailable",
    httpStatus: 503,
    sessionId: "saved-payment",
    serverState: "ISSUANCE_UNKNOWN",
    recovery: null,
  });
  await panel
    .getByRole("button", { name: "Resolve payment", exact: true })
    .click();
  await expect(panel.getByRole("alert")).toContainText("Payment check failed.");
  await panel
    .getByText("Payment details and recovery", { exact: true })
    .click();
  await expect(panel).toContainText("Payment service: HTTP 503.");
  await expect(panel.getByRole("alert")).toContainText(
    "The payment service could not be reached reliably.",
  );
  await expect(panel).not.toContainText("This payment is no longer pending.");
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("payment-recovery:calls")!),
    ),
  ).toEqual(["recover"]);
});

test("SDK .15 completed recovery uses the cleared session without replay", async ({
  page,
}) => {
  const panel = await openPayment(page, "cleared", {
    outcome: "completed",
    reasonCode: null,
    sessionId: null,
    serverState: null,
    recovery: null,
  });
  await panel
    .getByRole("button", { name: "Resolve payment", exact: true })
    .click();
  await expect(panel).toContainText(
    "This payment is no longer pending. No message was resent.",
  );
  await expect(panel.getByRole("alert")).toHaveCount(0);
  expect(
    await page.evaluate(() =>
      JSON.parse(localStorage.getItem("payment-recovery:calls")!),
    ),
  ).toEqual(["recover"]);
});
