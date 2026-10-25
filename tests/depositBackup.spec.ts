import { expect, test, type Page } from "@playwright/test";
import { readFile } from "node:fs/promises";

// All state and recovery files in these tests are synthetic. No financial API is called.
const recoveryFile = JSON.stringify({
  schema: 1,
  fixture: "synthetic-recovery-key-do-not-use",
});
function fixture(
  options: {
    funded?: boolean;
    missing?: boolean;
    interrupted?: boolean;
    pendingSetup?: boolean;
    networkFailure?: boolean;
    moved?: boolean;
    restoreFailure?: boolean;
  } = {},
) {
  return `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateZkchatRecoveryFile(_c,_w,_a,text) { count("validate"); if(text!==kit) throw new RecoveryError("This recovery file belongs to another wallet or deployment."); }
export class RecoverySetupIncomplete extends RecoveryError {}
const options = ${JSON.stringify(options)};
const kit = ${JSON.stringify(recoveryFile)};
const account = { address: '11111111111111111111111111111111' };
const wallet = { name: 'Recovery Test Wallet' };
export const configuredModels = c => c?.models ?? [];
export const configuredMode = () => 'direct_openrouter';
export const configuredStreaming = () => false;
export const loadConfig = async () => ({ schema: 1, label: 'Offline recovery test', mode: 'direct_openrouter', models: [{id:'test/model',apis:['chat']}] });
export const listWallets = () => [wallet];
export const watchWallets = () => () => {};
export const connectWalletAccount = async () => account;
const count = key => localStorage.setItem('fixture:'+key,String(Number(localStorage.getItem('fixture:'+key)||'0')+1));
let protectedStorage = false;
let missing = !!options.missing;
let interrupted = !!options.interrupted;
let pendingSetup = !!options.pendingSetup;
let data = { selected:'first', entries:[{id:'first'}] };
let state = { noteId:'first', mode:'direct_openrouter', wallet:options.funded?'active':'empty', busy:false, session:null, walletOperation:null, emergencyEscape:null, settledBalanceMicroUsdc:options.funded?'2000000':'0', authorizationCapMicroUsdc:'1000000', canRequest:!!options.funded };
const listeners = new Set();
const publish = () => { for(const f of listeners) f({...state}); };
function makeHandle() {
 let disposed = false;
 return { account, wallet, recoveryEnabled:protectedStorage, persistence:'persistent', publicAdmissionReady:true, deployment:{id:'fixture-deployment',pool:'fixture-pool',mint:'fixture-mint'},
 get invalidated(){return disposed}, get deposits(){return data.entries}, get selectedDepositId(){return data.selected},
 createRecoveryFile(){count('createFile');return kit},
 async enableRecovery(text){count('enable'); if(text!==kit) throw new RecoveryError('Choose the recovery file for this wallet.'); disposed=true; if(interrupted){interrupted=false;pendingSetup=true;if(options.networkFailure)throw new Error('Network unavailable');throw new RecoverySetupIncomplete('Recovery setup was interrupted. Keep your saved file.')} protectedStorage=true;return makeHandle()},
 dispose(){disposed=true;count('dispose')}, async refreshPreflight(){},
 async addDeposit(){count('add');data.selected='second';data.entries.push({id:'second'});state={...state,noteId:'second',wallet:'empty',canRequest:false,settledBalanceMicroUsdc:'0'};publish()},
 async selectDeposit(id){data.selected=id;publish()},
 client:{
 async status(){if(disposed) throw new Error('disposed');return {...state}},subscribe:f=>{listeners.add(f);return()=>listeners.delete(f)},
 async prepareDeposit(amount){count('deposit');state={...state,wallet:'unfunded',canRequest:false,settledBalanceMicroUsdc:amount,walletOperation:{kind:'deposit',phase:'ready',signature:null}};publish()},
 async advanceWallet(){const done=!!state.walletOperation.signature;state={...state,wallet:done?'active':'unfunded',canRequest:done,walletOperation:done?null:{...state.walletOperation,signature:'fixture-signature'}};publish();return{state:done?'complete':'pending'}},
 async prepareWithdrawal(){count('withdraw')},
 async chat(){count('chat');return new Response(JSON.stringify({choices:[{message:{content:'Restored chat reply'},finish_reason:'stop'}]}),{headers:{'Content-Type':'application/json'}})}
 }};
}
export const connectZkapi = async (_c,_w,_a,initialize=false) => {
 if(options.moved && !protectedStorage) throw new RecoveryAccessMoved('Access to these deposits moved to another browser. Restore with your recovery file to use them here.');
 if(pendingSetup) throw new RecoverySetupIncomplete('Finish recovery setup with your saved file.');
 if(missing && !initialize) throw new BrowserStorageMissing();
 if(initialize){count('initialize');missing=false}
 return makeHandle();
};
export const restoreZkchatDeposits = async (_c,_w,_a,text) => {
 count('restore');
 if(options.restoreFailure && localStorage.getItem('fixture:restore')==='1') throw new Error('Synthetic network interruption');
 if(text!==kit) throw new RecoveryError('This recovery file belongs to another wallet or deployment.');
 protectedStorage=true;missing=false;state={...state,wallet:'active',settledBalanceMicroUsdc:'2000000',canRequest:true};return makeHandle();
};
export const finishZkchatRecoverySetup = async (_c,_w,_a,text) => {
 count('finish');if(text!==kit) throw new RecoveryError('Use the original recovery file.');
 pendingSetup=false;protectedStorage=true;return makeHandle();
};`;
}
async function open(page: Page, options: Parameters<typeof fixture>[0] = {}) {
  await page.route("**/*", (route) =>
    ["localhost", "127.0.0.1"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fixture(options),
    }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
}
const count = (page: Page, key: string) =>
  page.evaluate(
    (key) => Number(localStorage.getItem("fixture:" + key) || "0"),
    key,
  );
async function saveBackup(page: Page) {
  const download = page.waitForEvent("download");
  await page
    .getByRole("button", { name: "Download recovery file", exact: true })
    .click();
  const downloaded = await download;
  expect(downloaded.suggestedFilename()).toBe("zkchat-deposit-recovery.json");
  expect(await readFile((await downloaded.path())!, "utf8")).toBe(recoveryFile);
  await page.getByLabel("I saved this file somewhere I can find later").check();
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
}
async function upload(page: Page, text = recoveryFile) {
  await page.getByLabel("Recovery file", { exact: true }).setInputFiles({
    name: "zkchat-deposit-recovery.json",
    mimeType: "application/json",
    buffer: Buffer.from(text),
  });
}

test("first deposit requires a downloaded backup; further deposits use the same protection", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await open(page);
  await expect(page.getByLabel("USDC to deposit")).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Continue to deposit" }),
  ).toHaveCount(0);
  await expect(
    page.getByRole("link", { name: "Get test USDC", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("link", { name: "Get test SOL", exact: true }),
  ).toBeVisible();
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/backup-initial-desktop.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.setViewportSize({ width: 375, height: 812 });
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/backup-initial-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await saveBackup(page);
  await page.screenshot({
    path: "docs/evidence/ux-improvements-20261025/backup-saved-mobile.png",
    animations: "disabled",
    fullPage: true,
  });
  await page.setViewportSize({ width: 1280, height: 1100 });
  expect(await count(page, "enable")).toBe(0);
  await page.getByRole("button", { name: "Continue to deposit" }).click();
  await expect(page.getByLabel("USDC to deposit")).toHaveValue("2");
  await expect(page.getByText("I will keep this browser’s data")).toHaveCount(
    0,
  );
  await expect(page.getByRole("alert")).toHaveCount(0);
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
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeDisabled(); // empty message
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Hello after backup");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Restored chat reply",
  );
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Add funds", exact: true })
    .click();
  await expect(page.getByLabel("USDC to deposit")).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download recovery file", exact: true }),
  ).toHaveCount(0);
  expect(await count(page, "createFile")).toBe(1);
  expect(await count(page, "enable")).toBe(1);
  expect(
    await page.evaluate(() => JSON.stringify({ ...localStorage })),
  ).not.toContain("synthetic-recovery-key");
});

test("existing deposits can chat and withdraw before optional recovery setup", async ({
  page,
}) => {
  await open(page, { funded: true });
  await expect(
    page.getByRole("button", { name: "Start chatting", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Withdraw balance", exact: true }),
  ).toBeEnabled();
  await page.getByText("Backup and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Set up recovery", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Download recovery file", exact: true }),
  ).toBeVisible();
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Withdraw balance", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "enable")).toBe(0);
  expect(await count(page, "withdraw")).toBe(0);
});

test("a missing browser restores its deposits without initializing new storage", async ({
  page,
}) => {
  await page.setViewportSize({ width: 1280, height: 1100 });
  await open(page, { missing: true });
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page);
  await expect(
    page.getByRole("button", { name: "Restore deposits", exact: true }),
  ).toBeDisabled();
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page.screenshot({
    path: test.info().outputPath("restore-deposits.png"),
    fullPage: true,
  });
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start chatting", exact: true }),
  ).toBeEnabled();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await count(page, "restore")).toBe(1);
  expect(await count(page, "initialize")).toBe(0);
  expect(await count(page, "deposit")).toBe(0);
});

test("a wrong recovery file gives a useful error and does not fund a new note", async ({
  page,
}) => {
  await open(page, { missing: true });
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page, '{"schema":1,"wrong":"file"}');
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "another wallet or deployment",
  );
  await expect(page.getByLabel("USDC to deposit")).toHaveCount(0);
  expect(await count(page, "initialize")).toBe(0);
  expect(await count(page, "deposit")).toBe(0);
});

test("an interrupted enrollment finishes with the same saved file", async ({
  page,
}) => {
  await open(page, { interrupted: true });
  await saveBackup(page);
  await page.getByRole("button", { name: "Continue to deposit" }).click();
  await expect(
    page.getByRole("button", { name: "Finish recovery setup", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Finish recovery setup", exact: true })
    .click();
  await expect(page.getByLabel("USDC to deposit")).toBeVisible();
  await expect(page.getByRole("alert")).toHaveCount(0);
  expect(await count(page, "createFile")).toBe(1);
  expect(await count(page, "finish")).toBe(1);
});

test("reopening interrupted setup asks for its saved file", async ({
  page,
}) => {
  await open(page, { pendingSetup: true });
  await expect(page.getByLabel("Recovery file", { exact: true })).toBeVisible();
  await upload(page);
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Finish recovery setup", exact: true })
    .click();
  await expect(page.getByLabel("USDC to deposit")).toBeVisible();
  expect(await count(page, "finish")).toBe(1);
  expect(await count(page, "restore")).toBe(0);
});

test("network interruption can finish after reopening the panel with the same file", async ({
  page,
}) => {
  await open(page, { funded: true, interrupted: true, networkFailure: true });
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page.getByText("Backup and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Set up recovery", exact: true })
    .click();
  await saveBackup(page);
  await page.getByRole("button", { name: "Continue to deposit" }).click();
  await expect(
    page.getByRole("button", { name: "Finish recovery setup", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await expect(page.getByLabel("Recovery file", { exact: true })).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Download recovery file", exact: true }),
  ).toHaveCount(0);
  await upload(page);
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Finish recovery setup", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "finish")).toBe(1);
  expect(await count(page, "createFile")).toBe(1);
});

test("recovery forms fit a small screen and reject malformed files locally", async ({
  page,
}) => {
  await page.setViewportSize({ width: 375, height: 812 });
  await open(page, { missing: true });
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page, "not JSON");
  await expect(page.getByRole("alert")).toContainText(
    "Could not read this file",
  );
  await expect(
    page.getByRole("button", { name: "Restore deposits", exact: true }),
  ).toBeDisabled();
  expect(
    await page.evaluate(
      () => document.documentElement.scrollWidth <= innerWidth,
    ),
  ).toBe(true);
  expect(await count(page, "restore")).toBe(0);
});

test("the previous browser explains moved access and can restore without deleting data", async ({
  page,
}) => {
  await open(page, { moved: true });
  await expect(page.getByRole("alert")).toContainText(
    "moved to another browser",
  );
  await expect(
    page.getByRole("button", { name: "Continue to deposits", exact: true }),
  ).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page);
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Start chatting", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "initialize")).toBe(0);
});

test("a wrong recovery file keeps the current funded deposit and draft usable", async ({
  page,
}) => {
  await open(page, { funded: true });
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("Keep my draft");
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page.getByText("Backup and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page, '{"schema":1,"wrong":"wallet"}');
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(page.getByRole("alert")).toContainText(
    "another wallet or deployment",
  );
  expect(await count(page, "dispose")).toBe(0);
  expect(await count(page, "restore")).toBe(0);
  await page.getByRole("button", { name: "Back", exact: true }).click();
  await expect(page.getByText(/Wallet changed/)).toHaveCount(0);
  await expect(
    page.getByRole("button", { name: "Withdraw balance", exact: true }),
  ).toBeEnabled();
  await page
    .getByRole("button", { name: "Return to chat", exact: true })
    .click();
  await expect(
    page.getByRole("textbox", { name: "Message", exact: true }),
  ).toHaveValue("Keep my draft");
  await expect(
    page.getByRole("button", { name: "Send message", exact: true }),
  ).toBeEnabled();
});

test("an interrupted restore retains its file and offers retry without claiming the wallet changed", async ({
  page,
}) => {
  await open(page, { funded: true, restoreFailure: true });
  await page
    .getByRole("button", { name: "Start chatting", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page.getByText("Backup and recovery", { exact: true }).click();
  await page
    .getByRole("button", { name: "Restore from recovery file", exact: true })
    .click();
  await upload(page);
  await page.getByLabel("I closed zkChat on my other tabs and devices").check();
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(page.getByText(/Restoration was interrupted/)).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Back", exact: true }),
  ).toHaveCount(0);
  await expect(page.getByText(/Wallet changed/)).toHaveCount(0);
  await page
    .getByRole("button", { name: "Restore deposits", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeEnabled();
  expect(await count(page, "restore")).toBe(2);
});
