import { test, expect, type Locator, type Page } from "@playwright/test";

// Offline UI lifecycle fixture. No real wallet, transactions or AI calls.
function depositStub(
  wallet: "empty" | "active" | "closed",
  options: {
    setup?: boolean;
    balance?: string;
    sessionAfterChat?: boolean;
    depositExpiryPolicy?: "none" | "fixed";
  } = {},
) {
  return `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateZkchatRecoveryFile() {}
export class RecoverySetupIncomplete extends RecoveryError {}
export const restoreZkchatDeposits = async () => { throw new Error('Unexpected recovery'); };
export const finishZkchatRecoverySetup = async () => { throw new Error('Unexpected recovery setup'); };
const options = ${JSON.stringify(options)};
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Deposit Test Wallet' };
export const configuredModels = c => c?.models ?? [];
export const configuredMode = () => 'direct_openrouter';
export const configuredStreaming = () => false;
export const loadConfig = async () => ({ schema:1, label:'Offline test', mode:'direct_openrouter', models:[{id:'test/model',apis:['chat']}] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
const count = key => localStorage.setItem('test:'+key,String(Number(localStorage.getItem('test:'+key)||'0')+1));
const balance=options.balance||'200000';
let data = JSON.parse(localStorage.getItem('test-deposits') || 'null') || { selected:'original', entries:[{id:'original',createdAt:1792800000000}], states: {original:{ noteId:'original',mode:'direct_openrouter',wallet:'${wallet}',busy:false,session:null,walletOperation:null,emergencyEscape:null,settledBalanceMicroUsdc:'${wallet === "empty" || wallet === "closed" ? "0" : "' + balance + '"}',authorizationCapMicroUsdc:'1000000',canRequest:${wallet === "active"}&&BigInt(balance)>=1000000n }} };
const listeners = new Set();
const state = () => data.states[data.selected];
if(options.depositExpiryPolicy) Object.assign(state(), {depositExpiryPolicy:options.depositExpiryPolicy,expiry:null});
const publish = () => {localStorage.setItem('test-deposits',JSON.stringify(data)); for (const fn of listeners) fn({...state()});};
export const connectZkapi = async (_config,_wallet,_account,initialize=false) => {
 count('opens');
 if(options.setup && !localStorage.getItem('test:initialized')) {
  if(!initialize) throw new BrowserStorageMissing();
  count('initializes');localStorage.setItem('test:initialized','1');
 }
 publish();
 return { account,wallet,recoveryEnabled:true,persistence:'persistent',publicAdmissionReady:true, deployment:{mint:'test-mint'},
  get deposits(){return data.entries},get selectedDepositId(){return data.selected},
  listDepositSummaries:async()=>data.entries.map(entry=>({...entry,status:data.states[entry.id],checkedAt:Date.now()})),
  addDeposit:async()=>{ count('adds'); if(state().session||state().walletOperation)throw new Error('Cannot replace pending work'); const id='deposit-'+data.entries.length; data.entries.push({id,createdAt:1792803600000});data.states[id]={...state(),noteId:id,wallet:'empty',canRequest:false,settledBalanceMicroUsdc:'0'};data.selected=id;publish(); },
  selectDeposit:async id=>{if(state().session||state().walletOperation)throw new Error('Cannot replace pending work');data.selected=id;publish();},
  async refreshPreflight(){count('refreshes')},dispose(){},client:{
    status:async()=>({...state()}),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    prepareDeposit:async amount=>{count('prepares');Object.assign(state(),{settledBalanceMicroUsdc:amount,wallet:'unfunded',canRequest:false,walletOperation:{kind:'deposit',phase:'ready',signature:null}});publish();},
    advanceWallet:async()=>{count('advances');const op=state().walletOperation; const finished=!!op.signature; Object.assign(state(),finished?{wallet:'active',canRequest:true,walletOperation:null}:{walletOperation:{...op,signature:'test-signature'}});publish();return{state:finished?'complete':'pending'};},
    chat:async request=>{count('chats');localStorage.setItem('test:last-chat',JSON.stringify(request));Object.assign(state(),options.sessionAfterChat?{session:{id:'test-session',phase:'authorized',operations:[{id:request.operationId,phase:'completed'}]}}:{settledBalanceMicroUsdc:'200000',canRequest:false,lastSettlement:{operationIds:[request.operationId],chargeMicroUsdc:'1800000'}});publish();return new Response(JSON.stringify({choices:[{message:{content:'Paid test reply'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});},
    settle:async()=>{count('settles');if(localStorage.getItem('test:hold-settlement')){Object.assign(state(),{canRequest:false,session:{...state().session,phase:'closing'}});}else{Object.assign(state(),{canRequest:true,session:null});}publish();},
    recover:async()=>{count('recoveries');return {state:'pending'};},
    prepareWithdrawal:async()=>{},
  }
 }};`;
}
const panel = (page: Page) =>
  page.getByRole("dialog", { name: "Wallet & balance" });
const balanceButton = (page: Page) =>
  page.getByRole("button", { name: "Wallet & balance", exact: true });
const message = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
const send = (page: Page) =>
  page.getByRole("button", { name: "Send message", exact: true });
const saved = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("test-deposits") || "null"),
  );
const count = (page: Page, name: string) =>
  page.evaluate(
    (key) => Number(localStorage.getItem(`test:${key}`) || "0"),
    name,
  );
async function install(page: Page, source: string) {
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/src/lib/zkapi.ts*", (r) =>
    r.fulfill({ contentType: "application/javascript", body: source }),
  );
  await page.goto("/");
}
async function connect(page: Page) {
  await balanceButton(page).click();
  await panel(page)
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(panel(page).locator(".connected-wallet-summary")).toContainText(
    "Deposit Test Wallet",
  );
}
async function faucets(scope: Locator) {
  await expect(
    scope.getByRole("link", { name: "Get test USDC", exact: true }),
  ).toHaveAttribute("href", "https://faucet.circle.com/");
  await expect(
    scope.getByRole("link", { name: "Get test SOL", exact: true }),
  ).toHaveAttribute("href", "https://faucet.solana.com/");
  for (const name of ["Get test USDC", "Get test SOL"]) {
    await expect(scope.getByRole("link", { name, exact: true })).toBeVisible();
    await expect(
      scope.getByRole("link", { name, exact: true }),
    ).toHaveAttribute("target", "_blank");
  }
}
async function review(page: Page) {
  await panel(page)
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Approve deposit in wallet",
      exact: true,
    }),
  ).toBeVisible();
}

for (const policy of ["none", "fixed"] as const) {
  test(`deposit review shows only needed expiry guidance for ${policy} before any wallet work`, async ({
    page,
  }) => {
    await install(page, depositStub("empty", { depositExpiryPolicy: policy }));
    await connect(page);
    await review(page);
    if (policy === "none") {
      await expect(
        panel(page).getByText(/No deposit expiry|Unused funds do not expire/),
      ).toHaveCount(0);
      await expect(
        panel(page).getByText(/Withdraw by|may lose|can be claimed/),
      ).toHaveCount(0);
    } else {
      await expect(
        panel(page).getByText("This deposit has an expiry", { exact: true }),
      ).toBeVisible();
      await expect(
        panel(page).getByText(
          /entire deposit, including unused funds, can be claimed/,
        ),
      ).toBeVisible();
    }
    expect(await count(page, "prepares")).toBe(0);
    expect(await count(page, "advances")).toBe(0);
  });
}
async function confirmDeposit(page: Page) {
  await panel(page)
    .getByRole("button", { name: "Approve deposit in wallet", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", {
      name: "Continue deposit confirmation",
      exact: true,
    }),
  ).toBeVisible();
  // Confirmation is explicitly advanced; observing the status must not sign again.
  expect(await count(page, "advances")).toBe(1);
  await panel(page)
    .getByRole("button", { name: "Continue deposit confirmation", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeEnabled();
}

test("first-time setup stays inline, explains proof, and keeps faucets available before funding", async ({
  page,
}) => {
  await install(page, depositStub("empty", { setup: true }));
  await expect(
    page.getByRole("button", { name: "Deposit", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByRole("dialog")).toHaveCount(0);
  await faucets(page.locator("main"));
  await expect(
    page
      .locator(".connection-step-heading")
      .getByText(/Zero-knowledge proofs show you have enough funds/),
  ).toBeVisible();
  await message(page).fill("Keep this first message");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  const setup = page.getByRole("button", {
    name: "Create new deposits",
    exact: true,
  });
  await expect(setup).toBeVisible();
  expect(await count(page, "initializes")).toBe(0);
  await expect(page.getByText(/original browser and wallet/)).toBeVisible();
  await setup.click();
  expect(await count(page, "initializes")).toBe(1);
  await expect(page.getByLabel("USDC to deposit")).toHaveValue("2");
  await expect(page.getByLabel("Saved deposits")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Add funds", exact: true }),
  ).toHaveCount(0);
  await faucets(page.locator("main"));
  await page
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve deposit in wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Continue deposit confirmation", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await expect(message(page)).toBeFocused();
  await expect(message(page)).toHaveValue("Keep this first message");
  expect(await count(page, "chats")).toBe(0);
  await expect(send(page)).toBeEnabled();
  await send(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Paid test reply",
  );
  expect(await count(page, "chats")).toBe(1);
});

test("opening and reviewing additional funding creates no note until confirmation and never aggregates balances", async ({
  page,
}) => {
  await install(page, depositStub("active", { balance: "2000000" }));
  await connect(page);
  await expect(panel(page).getByLabel("Saved deposits")).toHaveCount(0);
  await panel(page)
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await faucets(panel(page));
  await expect(panel(page)).toContainText("separate deposit");
  expect((await saved(page)).entries).toHaveLength(1);
  expect(await count(page, "adds")).toBe(0);
  await panel(page).getByRole("button", { name: "Close", exact: true }).click();
  await balanceButton(page).click();
  const add = panel(page).getByRole("button", {
    name: "Add funds",
    exact: true,
  });
  await add.click();
  expect((await saved(page)).entries).toHaveLength(1);
  await review(page);
  expect(await count(page, "adds")).toBe(0);
  expect(await count(page, "prepares")).toBe(0);
  expect((await saved(page)).states.original.settledBalanceMicroUsdc).toBe(
    "2000000",
  );
  await confirmDeposit(page);
  expect((await saved(page)).entries).toHaveLength(2);
  await expect(panel(page).locator(".balance-panel strong")).toHaveText("2.00");
  await expect(panel(page).locator(".balance-panel strong")).not.toHaveText(
    "4.00",
  );
});

test("deposit preparation explains an unavailable indexer without requesting a signature", async ({
  page,
}) => {
  await install(
    page,
    depositStub("closed").replace(
      "prepareDeposit:async amount=>{",
      "prepareDeposit:async amount=>{ throw new Error('finalized indexer unavailable');",
    ),
  );
  await connect(page);
  await panel(page)
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await panel(page)
    .getByRole("button", { name: "Approve deposit in wallet", exact: true })
    .click();
  await expect(panel(page).getByRole("alert")).toContainText(
    "chain indexer is unavailable",
  );
  await expect(panel(page).getByRole("alert")).toContainText(
    "No wallet signature was requested",
  );
  await expect(
    panel(page).getByRole("button", {
      name: "Approve deposit in wallet",
      exact: true,
    }),
  ).toBeEnabled();
  await expect(
    panel(page).getByRole("button", { name: "Edit amount", exact: true }),
  ).toBeEnabled();
  expect((await saved(page)).entries).toHaveLength(2);
  expect(await count(page, "advances")).toBe(0);
});

for (const signature of [null, "saved-test-signature"]) {
  test(`indexer error preserves the ${signature ? "signed" : "unsigned"} deposit without retrying`, async ({
    page,
  }) => {
    await install(
      page,
      depositStub("closed")
        .replace("signature:null", `signature:${JSON.stringify(signature)}`)
        .replace(
          "advanceWallet:async()=>{",
          "advanceWallet:async()=>{count('advances');throw new Error('finalized indexer unavailable');",
        ),
    );
    await connect(page);
    await panel(page)
      .getByRole("button", { name: "Add funds", exact: true })
      .click();
    await panel(page)
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    if (signature)
      await panel(page)
        .getByRole("button", { name: "Approve deposit in wallet", exact: true })
        .click();
    const next = panel(page).getByRole("button", {
      name: signature
        ? "Continue deposit confirmation"
        : "Approve deposit in wallet",
      exact: true,
    });
    expect(await count(page, "advances")).toBe(0);
    await next.click();
    await expect(panel(page).getByRole("alert")).toContainText("chain indexer");
    await expect(panel(page).getByRole("alert")).not.toContainText(
      "No wallet signature",
    );
    await expect(next).toBeEnabled();
    await expect(panel(page).getByLabel("Saved deposits")).toHaveCount(0);
    if (signature)
      await expect(
        panel(page).getByRole("link", { name: "View transaction" }),
      ).toHaveAttribute(
        "href",
        `https://explorer.solana.com/tx/${signature}?cluster=devnet`,
      );
    await panel(page)
      .getByRole("button", { name: "Close", exact: true })
      .click();
    await balanceButton(page).click();
    await expect(next).toBeEnabled();
    await expect(panel(page).getByLabel("Saved deposits")).toBeDisabled();
    expect(await count(page, "advances")).toBe(1);
    expect(await count(page, "adds")).toBe(1);
    expect((await saved(page)).entries).toHaveLength(2);
  });
}

for (const initial of ["closed", "active"] as const) {
  test(`deposit after ${initial}, resume after reload, chat and keep previous funds`, async ({
    page,
  }) => {
    await install(page, depositStub(initial));
    await connect(page);
    await panel(page)
      .getByRole("button", { name: "Add funds", exact: true })
      .click();
    expect((await saved(page)).selected).toBe("original");
    await panel(page).getByLabel("USDC to deposit").fill("0.2");
    await expect(
      panel(page).getByRole("button", { name: "Review deposit", exact: true }),
    ).toBeDisabled();
    await expect(panel(page)).toContainText("Deposit at least 1.00 USDC");
    expect(await count(page, "adds")).toBe(0);
    await panel(page).getByLabel("USDC to deposit").fill("2");
    await review(page);
    await expect(panel(page).getByLabel("Saved deposits")).toHaveCount(0);
    await panel(page)
      .getByRole("button", { name: "Approve deposit in wallet", exact: true })
      .click();
    await page.reload();
    await connect(page);
    await expect(panel(page).getByLabel("Saved deposits")).toHaveValue(
      "deposit-1",
    );
    await panel(page)
      .getByRole("button", {
        name: "Continue deposit confirmation",
        exact: true,
      })
      .click();
    await expect(
      panel(page).getByRole("button", { name: "Return to chat", exact: true }),
    ).toBeEnabled();
    await panel(page).getByLabel("Saved deposits").selectOption("original");
    await expect(panel(page).locator(".balance-panel strong")).toHaveText(
      initial === "closed" ? "0.00" : "0.2",
    );
    if (initial === "active")
      await expect(
        panel(page).getByRole("button", {
          name: "Withdraw balance",
          exact: true,
        }),
      ).toBeEnabled();
    await panel(page).getByLabel("Saved deposits").selectOption("deposit-1");
    await panel(page)
      .getByRole("button", { name: "Return to chat", exact: true })
      .click();
    await message(page).fill("Test funded chat");
    await send(page).click();
    await expect(page.locator(".message.assistant")).toContainText(
      "Paid test reply",
    );
    await page
      .locator(".composer-notice")
      .getByRole("button", { name: "Add funds", exact: true })
      .click();
    await expect(panel(page).getByLabel("USDC to deposit")).toBeVisible();
    await faucets(panel(page));
    expect((await saved(page)).entries).toHaveLength(2);
  });
}

for (const pending of [false, true]) {
  test(`additional funding ${pending ? "keeps pending settlement unresolved" : "settles explicitly and returns to the same chat and draft"}`, async ({
    page,
  }) => {
    await install(
      page,
      depositStub("active", { balance: "2000000", sessionAfterChat: true }),
    );
    await connect(page);
    await panel(page)
      .getByRole("button", { name: "Return to chat", exact: true })
      .click();
    await message(page).fill("First conversation");
    await send(page).click();
    await expect(page.locator(".message.assistant")).toContainText(
      "Paid test reply",
    );
    const transcript = await page.locator(".message").allTextContents();
    const originalChat = await page.evaluate(() =>
      JSON.parse(localStorage.getItem("test:last-chat")!),
    );
    await message(page).fill("Do not send this draft automatically");
    await balanceButton(page).click();
    await panel(page)
      .getByRole("button", { name: "Add funds", exact: true })
      .click();
    await expect(
      panel(page).getByRole("heading", {
        name: "Finish payment before adding funds",
        exact: true,
      }),
    ).toBeVisible();
    expect(await count(page, "settles")).toBe(0);
    expect(await count(page, "adds")).toBe(0);
    if (pending)
      await page.evaluate(() =>
        localStorage.setItem("test:hold-settlement", "1"),
      );
    await panel(page)
      .getByRole("button", { name: "Settle and continue", exact: true })
      .click();
    expect(await count(page, "settles")).toBe(1);
    expect(await count(page, "adds")).toBe(0);
    if (pending) {
      await expect(
        panel(page).getByRole("button", {
          name: "Review deposit",
          exact: true,
        }),
      ).toHaveCount(0);
      await expect(
        panel(page).getByRole("button", {
          name: "Resolve payment",
          exact: true,
        }),
      ).toBeVisible();
      expect(await count(page, "recoveries")).toBe(0);
    } else {
      await expect(panel(page).getByLabel("USDC to deposit")).toBeVisible();
      await review(page);
      await confirmDeposit(page);
      await panel(page)
        .getByRole("button", { name: "Return to chat", exact: true })
        .click();
      await expect(message(page)).toBeFocused();
      await expect(message(page)).toHaveValue(
        "Do not send this draft automatically",
      );
      expect(await page.locator(".message").allTextContents()).toEqual(
        transcript,
      );
      expect(await count(page, "chats")).toBe(1);
      await send(page).click();
      await expect(page.locator(".message.assistant")).toHaveCount(2);
      const next = await page.evaluate(() =>
        JSON.parse(localStorage.getItem("test:last-chat")!),
      );
      expect(next.sessionId).toBe(originalChat.sessionId);
      expect((await saved(page)).states.original.settledBalanceMicroUsdc).toBe(
        "2000000",
      );
    }
  });
}

for (const width of [320, 375, 768, 1280]) {
  test(`funding controls fit and work by keyboard at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await install(page, depositStub("closed"));
    await expect(balanceButton(page)).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await connect(page);
    await panel(page)
      .getByRole("button", { name: "Add funds", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(panel(page).getByLabel("USDC to deposit")).toHaveValue("2");
    await expect(panel(page).getByLabel("USDC to deposit")).toBeFocused();
    await faucets(panel(page));
    expect(
      await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`deposit-${width}.png`),
      fullPage: true,
    });
  });
}

test("signed initial and additional deposits confirm automatically without another approval", async ({
  page,
}) => {
  const source = depositStub("empty").replace(
    "status:async()=>({...state()}),",
    `
    observeWallet:async signature=>{
      count('observations');
      if(signature!==state().walletOperation?.signature) throw new Error('unexpected transaction');
      Object.assign(state(),{wallet:'active',canRequest:true,walletOperation:null});publish();return{state:'complete'};
    },status:async()=>({...state()}),`,
  );
  await install(page, source);
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Review deposit", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Approve deposit in wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start chatting", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "advances")).toBe(1);
  expect(await count(page, "observations")).toBe(1);
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await message(page).fill("My next chat");
  await page
    .locator(".wallet-summary")
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await faucets(panel(page));
  await review(page);
  await panel(page)
    .getByRole("button", { name: "Approve deposit in wallet", exact: true })
    .click();
  await expect(
    panel(page).getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "advances")).toBe(2);
  expect(await count(page, "observations")).toBe(2);
  expect((await saved(page)).entries).toHaveLength(2);
  await expect(panel(page).getByLabel("Saved deposits")).toBeEnabled();
  await expect(panel(page)).toContainText(
    "zkChat creates proofs for the deposit you select.",
  );
  await expect(panel(page).locator(".balance-panel strong")).toHaveText("2.00");
  await panel(page)
    .getByRole("button", { name: "Return to chat", exact: true })
    .click();
  await expect(message(page)).toHaveValue("My next chat");
  await expect(send(page)).toBeEnabled();
  expect(await count(page, "chats")).toBe(0);
});

test("the deposit review is editable without creating SDK work and confirms the edited amount once", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await install(page, depositStub("active", { balance: "2000000" }));
  await connect(page);
  await panel(page)
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await panel(page).getByLabel("USDC to deposit").fill("3");
  await review(page);
  await expect(panel(page).locator(".funding-summary strong")).toHaveText(
    "3.00 USDC",
  );
  expect(await count(page, "adds")).toBe(0);
  expect(await count(page, "prepares")).toBe(0);
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/editable-deposit-review-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await panel(page)
    .getByRole("button", { name: "Edit amount", exact: true })
    .click();
  await expect(panel(page).getByLabel("USDC to deposit")).toBeFocused();
  await panel(page).getByLabel("USDC to deposit").fill("4");
  await review(page);
  await panel(page)
    .getByRole("button", { name: "Back to balance", exact: true })
    .click();
  expect(await count(page, "adds")).toBe(0);
  await panel(page)
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await review(page);
  await confirmDeposit(page);
  expect(await count(page, "adds")).toBe(1);
  expect(await count(page, "prepares")).toBe(1);
  expect((await saved(page)).states["deposit-1"].settledBalanceMicroUsdc).toBe(
    "4000000",
  );
  await expect(
    panel(page).getByLabel("Saved deposits").locator("option").first(),
  ).toContainText("2.00 USDC · Available");
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/deposit-summaries-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1100 });
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/deposit-summaries-desktop.png",
    animations: "disabled",
    fullPage: true,
  });
  await panel(page).getByText("Backup and recovery", { exact: true }).click();
  await panel(page)
    .getByText("Lost your recovery file?", { exact: true })
    .click();
  await expect(
    panel(page).getByText(/original file cannot be downloaded again/),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/backup-lost-file-guidance.png",
    fullPage: true,
  });

  expect(
    await panel(page).evaluate((el) => el.scrollWidth <= el.clientWidth),
  ).toBe(true);
});
