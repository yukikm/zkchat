import { expect, test, type Page } from "@playwright/test";

// Synthetic state only. All external requests, signatures and transfers are blocked.
function fixture(waiting = false, readyOnCheck = false) {
  return `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export class RecoverySetupIncomplete extends RecoveryError {}
export async function validateZkchatRecoveryFile() {}
export async function restoreZkchatDeposits() { throw new Error('Unexpected restore'); }
export async function finishZkchatRecoverySetup() { throw new Error('Unexpected setup'); }
const account = {address:'11111111111111111111111111111111'};
const wallet = {name:'Withdrawal Test Wallet'};
export const configuredMode = () => 'direct_openrouter';
export const configuredModels = c => c?.models ?? [];
export const configuredStreaming = () => false;
export const loadConfig = async () => ({schema:1,mode:'direct_openrouter',models:[{id:'test/model',apis:['chat']}]});
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
const count = key => localStorage.setItem('withdrawal:'+key,String(Number(localStorage.getItem('withdrawal:'+key)||'0')+1));
const listeners = new Set();
let state = {noteId:'test-deposit',wallet:${JSON.stringify(waiting ? "pending_escape" : "active")},mode:'direct_openrouter',busy:false,session:null,settledBalanceMicroUsdc:'2000000',authorizationCapMicroUsdc:'1000000',canRequest:false,
 walletOperation:${waiting ? "null" : "{kind:'mutual_close',phase:'ready',signature:null,progress:{stage:'uploading_proof',nextAction:'approve_transaction',proofUpload:{confirmedChunks:2,totalChunks:5}}}"},
 escapeWithdrawal:${waiting ? "{availability:'unknown',executableAt:null,observedChainTime:null,observedSlot:null}" : "null"}};
const publish = () => {for(const listener of listeners)listener({...state});};
export const connectZkapi = async () => ({account,wallet,recoveryEnabled:true,publicAdmissionReady:true,persistence:'persistent',deployment:{id:'test',pool:'test',mint:'test'},deposits:[{id:'test-deposit',createdAt:1792886400000}],selectedDepositId:'test-deposit',dispose(){},async refreshPreflight(){},async listDepositSummaries(){return []},
 client:{subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},status:async()=>({...state}),
 checkEscapeWithdrawal:async()=>{count('checks'); if(localStorage.getItem('withdrawal:fail-check'))throw new Error('Synthetic offline'); const ready=${readyOnCheck} && Number(localStorage.getItem('withdrawal:checks'))>1;state={...state,escapeWithdrawal:{availability:ready?'ready':'waiting',executableAt:'1792886400',observedChainTime:ready?'1792886401':'1792800000',observedSlot:2}};publish();return state.escapeWithdrawal;},
 prepareFinalizeEscape:async()=>{count('finalizes');state={...state,walletOperation:{kind:'finalize_escape',phase:'ready',signature:null,progress:{stage:'finalizing_withdrawal',nextAction:'approve_transaction',proofUpload:null}}};publish()},
 advanceWallet:async()=>{count('advances');state={...state,walletOperation:{...state.walletOperation,signature:'synthetic-signature',progress:{...state.walletOperation.progress,nextAction:'wait_for_confirmation'}}};publish();return{state:'pending'}}
 }});`;
}
async function open(page: Page, waiting = false, readyOnCheck = false) {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fixture(waiting, readyOnCheck),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
}
const count = (page: Page, key: string) =>
  page.evaluate(
    (key) => Number(localStorage.getItem("withdrawal:" + key) || "0"),
    key,
  );

test("withdrawal explains proof progress and offers only the possible next action", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page);
  await expect(
    page.getByText("Uploading your withdrawal proof", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByText("2 of 5 proof parts confirmed.", { exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Add funds", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Approve in wallet", exact: true })
    .click();
  expect(await count(page, "advances")).toBe(1);
  await expect(
    page.getByRole("button", { name: "Check confirmation", exact: true }),
  ).toBeEnabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/withdrawal-proof-mobile.png",
    fullPage: true,
  });
});

test("delayed withdrawal checks its deadline and only enables finalization after verified readiness", async ({
  page,
}) => {
  await open(page, true, true);
  await expect(page.getByText(/You can finish withdrawing from/)).toBeVisible();
  await expect(
    page.getByText(/You can finish withdrawing from/),
  ).not.toContainText("1792886400");
  await expect(
    page.getByRole("button", { name: "Finish withdrawal", exact: true }),
  ).toBeDisabled();
  expect(await count(page, "checks")).toBe(1);
  expect(await count(page, "finalizes")).toBe(0);
  await expect(
    page.getByRole("button", { name: "Add funds", exact: true }),
  ).toHaveCount(0);
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/withdrawal-waiting-desktop.png",
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Check waiting period", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish withdrawal", exact: true }),
  ).toBeEnabled();
  await page.evaluate(() =>
    localStorage.setItem("withdrawal:fail-check", "yes"),
  );
  await page
    .getByRole("button", { name: "Check waiting period", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "Could not check the waiting period",
  );
  await expect(
    page.getByRole("button", { name: "Finish withdrawal", exact: true }),
  ).toBeDisabled();
  expect(await count(page, "finalizes")).toBe(0);
  await page.evaluate(() => localStorage.removeItem("withdrawal:fail-check"));
  await page
    .getByRole("button", { name: "Check waiting period", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Finish withdrawal", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Finish withdrawal", exact: true })
    .click();
  expect(await count(page, "finalizes")).toBe(1);
  expect(await count(page, "advances")).toBe(0);
  await expect(
    page.getByText("Returning your USDC", { exact: true }),
  ).toBeVisible();
});
