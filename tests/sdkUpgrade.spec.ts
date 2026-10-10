import { expect, test, type Page } from "@playwright/test";

const fixture = `
export class BrowserStorageMissing extends Error {}
const account={address:'11111111111111111111111111111111'};
const wallet={name:'SDK Upgrade Test Wallet'};
export const configuredModels=c=>c?.models??[];
export const configuredMode=()=> 'direct_openrouter';
export const configuredStreaming=()=>false;
export const loadConfig=async()=>({schema:1,mode:'direct_openrouter',models:[{id:'test/model',apis:['chat']}]});
export const listWallets=()=>[wallet];
export const watchWallets=()=>()=>{};
export const connectWallet=async()=>[account];
let state={noteId:'fixture',mode:'direct_openrouter',wallet:'active',canRequest:true,busy:false,session:null,walletOperation:null,emergencyEscape:null,settledBalanceMicroUsdc:'2000000',authorizationCapMicroUsdc:'1000000'};
const listeners=new Set();
const update=value=>{state={...state,...value};for(const fn of listeners)fn(state)};
const calls=[];
let activeConversation=null;
let authorizationSequence=0;
export const connectZkapi=async()=>({account,wallet,persistence:'persistent',publicAdmissionReady:true,deposits:[{id:'fixture'}],selectedDepositId:'fixture',deployment:{mint:'fixture-mint'},dispose(){},client:{
 status:async()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
 chat:async request=>{
   calls.push(request); localStorage.setItem('fixture:calls',JSON.stringify(calls));
   if(activeConversation!==null && activeConversation!==request.sessionId) {
     throw new Error('Settle the active conversation before switching scope');
   }
   if(activeConversation===null) {
     activeConversation=request.sessionId;
     update({session:{id:'AUTH-'+(++authorizationSequence),phase:'authorized',operations:[]}});
   }
   const session={...state.session,operations:[...state.session.operations,{id:request.operationId,phase:'completed'}]};
   if(request.messages.at(-1).content==='provider failure') {
     update({canRequest:false,session:{...session,phase:'settlement_pending'}});
     return new Response('private provider message', {status:402,headers:{'Content-Type':'application/json','X-Zkapi-Error-Code':'provider_budget_unavailable'}});
   }
   update({session});
   return Response.json({choices:[{message:{content:'Fixture reply'},finish_reason:'stop'}]});
 },
 settle:async()=>{
   localStorage.setItem('fixture:settled','1');
   const operationIds=state.session.operations.map(operation=>operation.id);
   activeConversation=null;
   update({canRequest:true,lastSettlement:{operationIds,chargeMicroUsdc:'10000'},session:null});
 },
 recover:async()=>{throw new Error('Recovery must not be triggered automatically')},
}});`;

const message = (page: Page) =>
  page.getByRole("textbox", { name: "Message", exact: true });
const sendButton = (page: Page) =>
  page.getByRole("button", { name: "Send message", exact: true });
const callAttempts = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture:calls") || "[]"),
  );

async function connectAccount(page: Page) {
  await page
    .getByRole("button", { name: "SDK Upgrade Test Wallet", exact: true })
    .click();
  await page
    .getByLabel("2. Select an account")
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Connect account", exact: true })
    .click();
  await expect(page.getByLabel("Saved deposits")).toBeVisible();
}

async function sendMessage(page: Page, text: string) {
  await message(page).fill(text);
  await sendButton(page).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Fixture reply",
  );
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toHaveCount(0);
}

async function settleSession(page: Page) {
  await page
    .getByRole("button", { name: "Settle charges", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Active session", exact: true }),
  ).toHaveCount(0);
  await page.getByRole("button", { name: "Close", exact: true }).click();
}

test.beforeEach(async ({ page }) => {
  await page.route("**/src/lib/zkapi.ts*", (r) =>
    r.fulfill({ contentType: "application/javascript", body: fixture }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await connectAccount(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
});

test("reuses one conversation scope, separates a new chat, and explicitly settles without replay", async ({
  page,
}) => {
  for (const text of ["first message", "second message"]) {
    await page
      .getByRole("textbox", { name: "Message", exact: true })
      .fill(text);
    await page
      .getByRole("button", { name: "Send message", exact: true })
      .click();
    await expect(
      page.getByRole("button", { name: "Manage session", exact: true }),
    ).toBeVisible();
  }
  const calls = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture:calls")!),
  );
  expect(calls).toHaveLength(2);
  expect(calls[0].sessionId).toBeTruthy();
  expect(calls[0].sessionId).toBe(calls[1].sessionId);
  expect(calls[0].operationId).not.toBe(calls[1].operationId);
  await page
    .getByRole("button", { name: "Manage session", exact: true })
    .click();
  await page
    .getByRole("button", { name: "Settle charges", exact: true })
    .click();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(page.locator(".billing-note")).toHaveText([
    "Session settled · 0.01 USDC total",
    "Session settled · 0.01 USDC total",
  ]);
  await page
    .getByRole("button", { name: /^New chat/ })
    .first()
    .click();
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("different conversation");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Manage session", exact: true }),
  ).toBeVisible();
  await expect
    .poll(async () =>
      page.evaluate(
        () => JSON.parse(localStorage.getItem("fixture:calls")!).length,
      ),
    )
    .toBe(3);
  const finalCalls = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture:calls")!),
  );
  expect(finalCalls[2].sessionId).not.toBe(calls[0].sessionId);
  await page
    .getByRole("button", { name: "Manage session", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Active session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Settle charges", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Active session", exact: true }),
  ).toHaveCount(0);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:settled")),
  ).toBe("1");
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture:calls")!).length,
    ),
  ).toBe(3);
});

test("a new chat preserves its draft and transcript until explicit settlement, including Enter", async ({
  page,
}) => {
  await sendMessage(page, "first conversation");
  const firstCalls = await callAttempts(page);
  const draft = "  draft for the next conversation\nkeep this line too  ";
  await page
    .getByRole("button", { name: /^New chat/ })
    .first()
    .click();
  await message(page).fill(draft);
  await expect(page.locator(".settlement-banner")).toContainText(
    "Settle the previous chat before sending here.",
  );
  await expect(sendButton(page)).toBeDisabled();
  await message(page).press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Connection settings", exact: true }),
  ).toBeVisible();
  await expect(message(page)).toHaveValue(draft);
  await expect(page.locator(".message")).toHaveCount(0);
  await expect(page.locator(".history-item")).toHaveCount(1);
  expect(await callAttempts(page)).toEqual(firstCalls);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:settled")),
  ).toBeNull();
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(sendButton(page)).toBeDisabled();
  await page
    .getByRole("button", { name: "Review settlement", exact: true })
    .click();
  await settleSession(page);
  await expect(message(page)).toHaveValue(draft);
  await expect(sendButton(page)).toBeEnabled();
  await expect(page.locator(".message")).toHaveCount(0);
  expect(await callAttempts(page)).toEqual(firstCalls);
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Fixture reply",
  );
  const finalCalls = await callAttempts(page);
  expect(finalCalls).toHaveLength(2);
  expect(finalCalls[1].sessionId).not.toBe(firstCalls[0].sessionId);
});

test("a saved chat cannot take another chat's session, and returning to its owner allows reuse", async ({
  page,
}) => {
  await sendMessage(page, "conversation A");
  await page
    .getByRole("button", { name: "Manage session", exact: true })
    .click();
  await settleSession(page);
  await page
    .getByRole("button", { name: /^New chat/ })
    .first()
    .click();
  await sendMessage(page, "conversation B");
  const originalCalls = await callAttempts(page);
  await page
    .getByRole("button", { name: "conversation A", exact: true })
    .click();
  const transcript = await page.locator(".message").allTextContents();
  await message(page).fill("continue A");
  await expect(page.locator(".settlement-banner")).toContainText(
    "Settle the previous chat before sending here.",
  );
  await expect(sendButton(page)).toBeDisabled();
  await message(page).press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Connection settings", exact: true }),
  ).toBeVisible();
  await expect(message(page)).toHaveValue("continue A");
  expect(await page.locator(".message").allTextContents()).toEqual(transcript);
  expect(await callAttempts(page)).toEqual(originalCalls);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "conversation B", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Manage session", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("button", { name: "Review settlement", exact: true }),
  ).toHaveCount(0);
  await sendMessage(page, "continue B");
  const finalCalls = await callAttempts(page);
  expect(finalCalls).toHaveLength(3);
  expect(finalCalls[2].sessionId).toBe(originalCalls[1].sessionId);
  expect(finalCalls[2].sessionId).not.toBe(originalCalls[0].sessionId);
});

test("reconnecting retains the session guard while demo replies remain available", async ({
  page,
}) => {
  await sendMessage(page, "unsettled conversation");
  const originalCalls = await callAttempts(page);
  await page
    .getByRole("button", { name: "Manage session", exact: true })
    .click();
  await page.getByRole("button", { name: "Disconnect", exact: true }).click();
  await expect(page.locator(".topbar-status")).toHaveText("Disconnected");
  await connectAccount(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await message(page).fill("draft after reconnect");
  await expect(page.locator(".settlement-banner")).toContainText(
    "Settle the previous chat before sending here.",
  );
  await expect(sendButton(page)).toBeDisabled();
  await message(page).press("Enter");
  await expect(
    page.getByRole("dialog", { name: "Connection settings", exact: true }),
  ).toBeVisible();
  expect(await callAttempts(page)).toEqual(originalCalls);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await page
    .getByRole("button", { name: "Appearance and chat", exact: true })
    .click();
  await page.getByRole("button", { name: "Demo", exact: true }).click();
  await expect(message(page)).toHaveValue("draft after reconnect");
  await expect(page.locator(".settlement-banner")).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Demo reply · No AI request or payment",
  );
  expect(await callAttempts(page)).toEqual(originalCalls);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:settled")),
  ).toBeNull();
});

test("provider budget errors stay redacted and do not invite more deposits or retries", async ({
  page,
}) => {
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill("provider failure");
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Adding a deposit will not resolve",
  );
  await expect(page.locator(".message.assistant")).not.toContainText(
    "private provider message",
  );
  await expect(
    page.getByRole("button", { name: "Review payment", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture:calls")!).length,
    ),
  ).toBe(1);
});
