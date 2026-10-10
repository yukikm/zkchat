import { test, expect, type Page } from "@playwright/test";

// Offline UI lifecycle fixture. No real wallet, transactions or AI calls.
function depositStub(wallet: "active" | "closed") {
  return `
export class BrowserStorageMissing extends Error {}
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Deposit Test Wallet' };
export const configuredModels = c => c?.models ?? [];
export const configuredMode = () => 'direct_openrouter';
export const configuredStreaming = () => false;
export const loadConfig = async () => ({ schema:1, label:'Offline test', mode:'direct_openrouter', models:[{id:'test/model',apis:['chat']}] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
let data = JSON.parse(localStorage.getItem('test-deposits') || 'null') || { selected:'original', entries:[{id:'original'}], states: {original:{ noteId:'original',mode:'direct_openrouter',wallet:'${wallet}',busy:false,session:null,walletOperation:null,emergencyEscape:null,settledBalanceMicroUsdc:'200000',authorizationCapMicroUsdc:'1000000',canRequest:false }} };
const listeners = new Set();
const state = () => data.states[data.selected];
const publish = () => {localStorage.setItem('test-deposits',JSON.stringify(data)); for (const fn of listeners) fn(state());};
export const connectZkapi = async () => ({ account,wallet,persistence:'persistent',publicAdmissionReady:true, deployment:{mint:'test-mint'},
  get deposits(){return data.entries},get selectedDepositId(){return data.selected},
  addDeposit:async()=>{ const id='deposit-'+data.entries.length; data.entries.push({id});data.states[id]={...state(),noteId:id,wallet:'empty',settledBalanceMicroUsdc:'0'};data.selected=id;publish(); },
  selectDeposit:async id=>{data.selected=id;publish();},
  async refreshPreflight(){},dispose(){},client:{
    status:async()=>state(),subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
    prepareDeposit:async amount=>{Object.assign(state(),{settledBalanceMicroUsdc:amount,wallet:'unfunded',walletOperation:{kind:'deposit',phase:'ready',signature:null}});publish();},
    advanceWallet:async()=>{const op=state().walletOperation; const finished=!!op.signature; Object.assign(state(),finished?{wallet:'active',canRequest:true,walletOperation:null}:{walletOperation:{...op,signature:'test-signature'}});publish();return{state:finished?'complete':'pending'};},
    chat:async request=>{Object.assign(state(),{settledBalanceMicroUsdc:'200000',canRequest:false,lastSettlement:{operationIds:[request.operationId],chargeMicroUsdc:'1800000'}});publish();return new Response(JSON.stringify({choices:[{message:{content:'Paid test reply'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}});},
    prepareWithdrawal:async()=>{},
  }
});`;
}
async function connect(page: Page) {
  await page.getByRole("button", { name: "Deposit", exact: true }).click();
  await page
    .getByRole("dialog", { name: "Connection settings" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(page.getByLabel("Saved deposits")).toBeVisible();
}
for (const initial of ["closed", "active"] as const) {
  test(`deposit after ${initial}, resume after reload, chat and keep previous funds`, async ({
    page,
  }) => {
    await page.route("**/src/lib/zkapi.ts*", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: depositStub(initial),
      }),
    );
    await page.goto("/");
    await connect(page);
    await expect(
      page.getByRole("button", { name: "Add deposit", exact: true }),
    ).toBeEnabled();
    await page
      .getByRole("button", { name: "Add deposit", exact: true })
      .click();
    await expect(page.getByLabel("Saved deposits")).toHaveValue("deposit-1");
    await page.getByLabel("I will keep this browser’s data").check();
    await page.getByLabel("USDC to deposit").fill("0.2");
    await page
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await expect(page.getByRole("alert")).toContainText(
      "Deposit at least 1.00 USDC",
    );
    await page.getByLabel("USDC to deposit").fill("2");
    await page
      .getByRole("button", { name: "Review deposit", exact: true })
      .click();
    await expect(
      page.getByRole("button", {
        name: "Approve in wallet",
        exact: true,
      }),
    ).toBeVisible();
    await expect(page.getByLabel("Saved deposits")).toBeDisabled();
    await expect(
      page.getByRole("button", { name: "Add deposit", exact: true }),
    ).toBeDisabled();
    await page.reload();
    await connect(page);
    await expect(page.getByLabel("Saved deposits")).toHaveValue("deposit-1");
    await page
      .getByRole("button", {
        name: "Approve in wallet",
        exact: true,
      })
      .click();
    await expect(page.locator(".balance-panel strong")).toHaveText("0.00");
    await page
      .getByRole("button", { name: "Check transaction", exact: true })
      .click();
    await expect(page.locator(".balance-panel strong")).toHaveText("2.00");
    await page.getByLabel("Saved deposits").selectOption("original");
    await expect(page.locator(".balance-panel strong")).toHaveText(
      initial === "closed" ? "0.00" : "0.2",
    );
    if (initial === "active")
      await expect(
        page.getByRole("button", { name: "Withdraw balance", exact: true }),
      ).toBeEnabled();
    await page.getByLabel("Saved deposits").selectOption("deposit-1");
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill("Test funded chat");
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(page.locator(".message.assistant")).toContainText(
      "Paid test reply",
    );
    await expect(
      page.getByRole("button", { name: "Add funds", exact: true }),
    ).toBeVisible();
    await page.getByRole("button", { name: "Add funds", exact: true }).click();
    await expect(
      page.getByRole("button", { name: "Add deposit", exact: true }),
    ).toBeEnabled();
    await expect(
      page.getByLabel("Saved deposits").locator("option"),
    ).toHaveCount(2);
  });
}
for (const width of [375, 768, 1280]) {
  test(`Deposit controls fit and work by keyboard at ${width}px`, async ({
    page,
  }, info) => {
    await page.setViewportSize({ width, height: 900 });
    await page.route("**/src/lib/zkapi.ts*", (r) =>
      r.fulfill({
        contentType: "application/javascript",
        body: depositStub("closed"),
      }),
    );
    await page.goto("/");
    await expect(
      page.getByRole("button", { name: "Deposit", exact: true }),
    ).toBeVisible();
    expect(
      await page.evaluate(
        () => document.documentElement.scrollWidth <= innerWidth,
      ),
    ).toBe(true);
    await connect(page);
    await page
      .getByRole("button", { name: "Add deposit", exact: true })
      .focus();
    await page.keyboard.press("Enter");
    await expect(page.getByLabel("USDC to deposit")).toHaveValue("2");
    await expect(page.getByLabel("USDC to deposit")).toBeFocused();
    expect(
      await page
        .getByRole("dialog")
        .evaluate((el) => el.scrollWidth <= el.clientWidth),
    ).toBe(true);
    await page.screenshot({
      path: info.outputPath(`deposit-${width}.png`),
      fullPage: true,
    });
  });
}
