import { expect, test, type Page } from "@playwright/test";

const fixture = `
export class BrowserStorageMissing extends Error {}
const account={address:'11111111111111111111111111111111'};
const wallet={name:'SDK Upgrade Test Wallet'};
export const configuredModels=c=>c?.models??[];
export const configuredMode=()=> 'direct_openrouter';
export const configuredStreaming=()=>localStorage.getItem('fixture:streaming')==='1';
export const loadConfig=async()=>({schema:1,mode:'direct_openrouter',models:[{id:'test/model',apis:['chat']}]});
export const listWallets=()=>[wallet];
export const watchWallets=()=>()=>{};
export const connectWalletAccount=async()=>account;
let state={noteId:'fixture',mode:'direct_openrouter',wallet:'active',canRequest:true,busy:false,session:null,walletOperation:null,emergencyEscape:null,settledBalanceMicroUsdc:'2000000',authorizationCapMicroUsdc:'1000000'};
const listeners=new Set();
const update=value=>{state={...state,...value};for(const fn of listeners)fn(state)};
const calls=[];
let activeConversation=null;
let authorizationSequence=0;
const count=name=>localStorage.setItem(name,String(Number(localStorage.getItem(name)||'0')+1));
export const connectZkapi=async()=>({account,wallet,persistence:'persistent',publicAdmissionReady:true,deposits:[{id:'fixture'}],selectedDepositId:'fixture',deployment:{mint:'fixture-mint'},dispose(){},
 refreshPreflight:async()=>{
   count('fixture:preflightCalls');
   if(localStorage.getItem('fixture:holdRefresh')==='1') await new Promise(resolve=>{globalThis.__sdkUpgradeReleaseRefresh=()=>{localStorage.removeItem('fixture:holdRefresh');resolve()}});
 },client:{
 status:async()=>{
   count('fixture:statusCalls');
   if(localStorage.getItem('fixture:holdStatus')==='1') await new Promise(resolve=>{globalThis.__sdkUpgradeReleaseStatus=()=>{localStorage.removeItem('fixture:holdStatus');resolve()}});
   return state;
 },subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
 chat:async request=>{
   calls.push(request); localStorage.setItem('fixture:calls',JSON.stringify(calls));
   const prompt=request.messages.at(-1).content;
   if(prompt==='failure before session') throw new Error('private pre-session failure');
   if(prompt==='indexer failure before session') throw new Error('finalized indexer unavailable');
   if(prompt==='payment HTTP 400 before session') throw new globalThis.__sdkUpgradeControlHttpError(400);
   if(prompt==='uncertain authorization') {
     update({canRequest:false,canReconcileUnacceptedAuthorization:true,session:{id:'AUTH-uncertain',phase:'send_unknown',operations:[]}});
     throw new globalThis.__sdkUpgradeControlHttpError(503);
   }
   if(activeConversation!==null && activeConversation!==request.sessionId) {
     throw new Error('Settle the active conversation before switching scope');
   }
   if(activeConversation===null) {
     activeConversation=request.sessionId;
     update({session:{id:'AUTH-'+(++authorizationSequence),phase:'authorized',operations:[]}});
   }
   const session={...state.session,operations:[...state.session.operations,{id:request.operationId,phase:'completed'}]};
   if(prompt==='provider failure') {
     update({canRequest:false,session:{...session,phase:'settlement_pending'}});
     return new Response('private provider message', {status:402,headers:{'Content-Type':'application/json','X-Zkapi-Error-Code':'provider_budget_unavailable'}});
   }
   update({session});
   if(prompt==='stream completion' || prompt==='stream abort') {
     update({canRequest:false,busy:true,session});
     const body=new ReadableStream({start(controller){
       controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Terminal reply'},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n'));
       globalThis.__sdkUpgradeCompleteStream=()=>{
         count('fixture:eofCalls');
         update({canRequest:true,busy:false,session});
         controller.close();
       };
       request.signal.addEventListener('abort',()=>{
         count('fixture:abortCalls');
         update({canRequest:false,busy:false,session:{...session,phase:'settlement_pending'}});
         controller.error(new DOMException('Aborted','AbortError'));
       },{once:true});
     }});
     return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
   }
   if(prompt==='stream failure') {
     const body=new ReadableStream({start(controller){
       controller.enqueue(new TextEncoder().encode('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Partial reply'},finish_reason:null}]})+'\\n\\n'));
       globalThis.__sdkUpgradeFailStream=()=>{
         update({canRequest:false,session:{...session,phase:'settlement_pending'}});
         controller.error(new Error('private streamed provider failure'));
       };
       request.signal.addEventListener('abort',()=>controller.error(new DOMException('Aborted','AbortError')),{once:true});
     }});
     return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
   }
   if(request.stream) return new Response('data: '+JSON.stringify({choices:[{index:0,delta:{content:'Fixture reply'},finish_reason:'stop'}]})+'\\n\\ndata: [DONE]\\n\\n',{headers:{'Content-Type':'text/event-stream'}});
   return Response.json({choices:[{message:{content:'Fixture reply'},finish_reason:'stop'}]});
 },
 settle:async()=>{
   localStorage.setItem('fixture:settled','1');
   const operationIds=state.session.operations.map(operation=>operation.id);
   activeConversation=null;
   update({canRequest:true,lastSettlement:{operationIds,chargeMicroUsdc:'10000'},session:null});
 },
 reconcileUnacceptedAuthorization:async()=>{
   count('fixture:clearanceCalls');
   update({canRequest:false,canReconcileUnacceptedAuthorization:false,session:null});
 },
 recover:async()=>{
   count('fixture:recoverCalls');
   if(localStorage.getItem('fixture:allowRelease')==='1' && state.canReconcileUnacceptedAuthorization) {
     activeConversation=null;
     update({canRequest:true,canReconcileUnacceptedAuthorization:false,session:null});
     return;
   }
   throw new Error('Recovery must not be triggered automatically');
 },
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
    .getByRole("dialog", { name: "Connection settings" })
    .getByRole("button", { name: "Connect wallet", exact: true })
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
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  // Reuse the app's imported SDK constructor to exercise its instanceof guard.
  await page.route("**/src/lib/sdkStatus.ts*", async (route) => {
    const response = await route.fetch();
    await route.fulfill({
      response,
      body: `${await response.text()}\nglobalThis.__sdkUpgradeControlHttpError = ControlHttpError;`,
    });
  });
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
  await expect(page.locator(".message.assistant")).toContainText(
    "Check status",
  );
  await expect(
    page.getByRole("button", { name: "Check status", exact: true }),
  ).toBeEnabled();
  await expect(
    page.getByRole("button", { name: "Review payment", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture:calls")!).length,
    ),
  ).toBe(1);
});

for (const scenario of [
  {
    prompt: "failure before session",
    error:
      "Reply interrupted. Choose Check status before sending again. Nothing is resent automatically.",
    hidden: "private pre-session failure",
  },
  {
    prompt: "indexer failure before session",
    error:
      "Could not verify chain data because the indexer is unavailable. Choose Check status before sending again. Nothing is resent automatically.",
    hidden: "finalized indexer unavailable",
  },
  {
    prompt: "payment HTTP 400 before session",
    error:
      "The payment service returned HTTP 400. Choose Check status before sending again. Nothing is resent automatically.",
    hidden: "ControlHttpError",
  },
]) {
  test(`${scenario.prompt} offers a status check without session recovery or replay`, async ({
    page,
  }) => {
    await message(page).fill(scenario.prompt);
    await sendButton(page).click();
    const assistant = page.locator(".message.assistant");
    await expect(assistant).toContainText(scenario.error);
    await expect(assistant).not.toContainText(scenario.hidden);
    await expect(
      page.getByRole("button", { name: "Review payment", exact: true }),
    ).toHaveCount(0);
    const checkStatus = page.getByRole("button", {
      name: "Check status",
      exact: true,
    });
    await expect(checkStatus).toBeEnabled();
    const originalCalls = await callAttempts(page);
    expect(originalCalls).toHaveLength(1);
    await checkStatus.click();
    await expect(
      page.getByRole("dialog", { name: "Connection settings", exact: true }),
    ).toBeVisible();
    await expect(
      page.getByRole("heading", { name: "Active session", exact: true }),
    ).toHaveCount(0);
    const beforeRefresh = await page.evaluate(() => {
      localStorage.setItem("fixture:holdRefresh", "1");
      return Number(localStorage.getItem("fixture:statusCalls") || "0");
    });
    const refresh = page.getByRole("button", {
      name: "Refresh status",
      exact: true,
    });
    await refresh.click();
    await expect(refresh).toBeDisabled();
    await expect(checkStatus).toBeDisabled();
    await page.evaluate(() =>
      (
        globalThis as unknown as { __sdkUpgradeReleaseRefresh(): void }
      ).__sdkUpgradeReleaseRefresh(),
    );
    await expect(refresh).toBeEnabled();
    await expect(checkStatus).toBeEnabled();
    expect(
      await page.evaluate(() =>
        Number(localStorage.getItem("fixture:statusCalls") || "0"),
      ),
    ).toBeGreaterThan(beforeRefresh);
    expect(
      await page.evaluate(() => localStorage.getItem("fixture:preflightCalls")),
    ).toBe("1");
    expect(await callAttempts(page)).toEqual(originalCalls);
    expect(
      await page.evaluate(() => localStorage.getItem("fixture:recoverCalls")),
    ).toBeNull();
    expect(
      await page.evaluate(() => localStorage.getItem("fixture:settled")),
    ).toBeNull();
  });
}

test("a failed response stream preserves its partial reply and checks status without replay", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("fixture:streaming", "1"));
  await message(page).fill("stream failure");
  await sendButton(page).click();
  const assistant = page.locator(".message.assistant");
  await expect(assistant).toContainText("Partial reply");
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toBeVisible();
  const originalCalls = await callAttempts(page);
  expect(originalCalls).toHaveLength(1);
  expect(originalCalls[0].stream).toBe(true);
  await page.evaluate(() => {
    localStorage.setItem("fixture:holdStatus", "1");
    (
      globalThis as unknown as { __sdkUpgradeFailStream(): void }
    ).__sdkUpgradeFailStream();
  });
  await expect(assistant).toContainText(
    "The response could not be validated. Choose Check status before sending again. Nothing is resent automatically.",
  );
  await expect(assistant).toContainText("Partial reply");
  await expect(assistant).not.toContainText(
    "private streamed provider failure",
  );
  const checkStatus = page.getByRole("button", {
    name: "Check status",
    exact: true,
  });
  await expect(checkStatus).toBeDisabled();
  await page.evaluate(() =>
    (
      globalThis as unknown as { __sdkUpgradeReleaseStatus(): void }
    ).__sdkUpgradeReleaseStatus(),
  );
  await expect(checkStatus).toBeEnabled();
  await checkStatus.click();
  await expect(
    page.getByRole("dialog", { name: "Connection settings", exact: true }),
  ).toBeVisible();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  const refresh = page.getByRole("button", {
    name: "Refresh status",
    exact: true,
  });
  await refresh.click();
  await expect(refresh).toBeEnabled();
  expect(await callAttempts(page)).toEqual(originalCalls);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:preflightCalls")),
  ).toBe("1");
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:recoverCalls")),
  ).toBeNull();
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:settled")),
  ).toBeNull();
});

test("terminal SSE waits for EOF, then enables the next explicit send without a payment check", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("fixture:streaming", "1"));
  await message(page).fill("stream completion");
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Terminal reply",
  );
  const stop = page.getByRole("button", {
    name: "Stop generation",
    exact: true,
  });
  await expect(stop).toBeVisible();
  await message(page).fill("next explicit message");
  await expect(sendButton(page)).toHaveCount(0);
  await message(page).press("Enter");
  const firstCalls = await callAttempts(page);
  expect(firstCalls).toHaveLength(1);
  expect(firstCalls[0].stream).toBe(true);
  await page.evaluate(() =>
    (
      globalThis as unknown as { __sdkUpgradeCompleteStream(): void }
    ).__sdkUpgradeCompleteStream(),
  );
  await expect(stop).toHaveCount(0);
  await expect(sendButton(page)).toBeEnabled();
  await expect(page.locator(".message-feedback")).toHaveCount(0);
  await expect(message(page)).toHaveValue("next explicit message");
  expect(await callAttempts(page)).toEqual(firstCalls);
  await sendButton(page).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Fixture reply",
  );
  await expect(stop).toHaveCount(0);
  const finalCalls = await callAttempts(page);
  expect(finalCalls).toHaveLength(2);
  expect(finalCalls[1].sessionId).toBe(firstCalls[0].sessionId);
  expect(finalCalls[1].operationId).not.toBe(firstCalls[0].operationId);
  expect(
    await page.evaluate(() => ({
      recover: localStorage.getItem("fixture:recoverCalls"),
      settled: localStorage.getItem("fixture:settled"),
      eof: localStorage.getItem("fixture:eofCalls"),
    })),
  ).toEqual({ recover: null, settled: null, eof: "1" });
});

test("Stop reaches the original request after terminal SSE and preserves recovery without replay", async ({
  page,
}) => {
  await page.evaluate(() => localStorage.setItem("fixture:streaming", "1"));
  await message(page).fill("stream abort");
  await sendButton(page).click();
  const assistant = page.locator(".message.assistant");
  await expect(assistant).toContainText("Terminal reply");
  await page
    .getByRole("button", { name: "Stop generation", exact: true })
    .click();
  await expect(assistant).toContainText(
    "Stopped. Charges may still apply. Choose Check status.",
  );
  await expect(assistant).toContainText("Terminal reply");
  await expect(
    page.getByRole("button", { name: "Send again", exact: true }),
  ).toBeDisabled();
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  await expect(
    page.getByRole("heading", { name: "Payment pending", exact: true }),
  ).toBeVisible();
  expect(await callAttempts(page)).toHaveLength(1);
  expect(
    await page.evaluate(() => ({
      abort: localStorage.getItem("fixture:abortCalls"),
      recover: localStorage.getItem("fixture:recoverCalls"),
      settled: localStorage.getItem("fixture:settled"),
      eof: localStorage.getItem("fixture:eofCalls"),
    })),
  ).toEqual({ abort: "1", recover: null, settled: null, eof: null });
});

test("new chats prefer the configured GPT model while saved and explicit model choices stay unchanged", async ({
  page,
}) => {
  const preferred = "openai/gpt-6.1-sol";
  const previous = "anthropic/claude-fable-5";
  const modelPicker = page.getByRole("combobox", {
    name: "Select model",
    exact: true,
  });
  // Independent configurations retain their existing first-model default.
  await expect(modelPicker).toHaveValue("test/model");
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({
      contentType: "application/javascript",
      body: fixture.replace(
        "models:[{id:'test/model',apis:['chat']}]",
        `models:[{id:'${previous}',apis:['chat']},{id:'${preferred}',apis:['chat']}]`,
      ),
    }),
  );
  await page.reload();
  await expect(modelPicker).toHaveValue(preferred);
  await expect(modelPicker).toBeEnabled();
  // An explicit choice remains available even before connecting a wallet.
  await modelPicker.selectOption(previous);
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await connectAccount(page);
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await expect(modelPicker).toHaveValue(previous);
  await message(page).fill("failure before session");
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "Reply interrupted. Choose Check status",
  );
  const originalCalls = await callAttempts(page);
  expect(originalCalls).toHaveLength(1);
  expect(originalCalls[0].model).toBe(previous);
  const transcript = await page.locator(".message").allTextContents();
  await page
    .getByRole("button", { name: /^New chat/ })
    .first()
    .click();
  await expect(modelPicker).toHaveValue(preferred);
  await expect(page.locator(".message")).toHaveCount(0);
  await page
    .getByRole("button", { name: "failure before session", exact: true })
    .click();
  await expect(modelPicker).toHaveValue(previous);
  await expect(modelPicker).toBeDisabled();
  expect(await page.locator(".message").allTextContents()).toEqual(transcript);
  await page
    .getByRole("button", { name: /^New chat/ })
    .first()
    .click();
  await expect(modelPicker).toHaveValue(preferred);
  await modelPicker.selectOption(previous);
  await message(page).fill("unsent draft");
  await expect(modelPicker).toHaveValue(previous);
  await page.keyboard.press("Control+Shift+O");
  await expect(modelPicker).toHaveValue(preferred);
  await expect(message(page)).toHaveValue("");
  await expect(page.locator(".message")).toHaveCount(0);
  expect(await callAttempts(page)).toEqual(originalCalls);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          JSON.parse(localStorage.getItem("zkchat:conversations:v1") || "[]")
            .length,
      ),
    )
    .toBe(1);
  const saved = await page.evaluate(() =>
    JSON.parse(localStorage.getItem("zkchat:conversations:v1") || "[]"),
  );
  expect(saved).toHaveLength(1);
  expect(saved[0].model).toBe(previous);
  expect(saved[0].messages).toHaveLength(2);
});

test("explicit Check payment releases an unaccepted authorization without changing the deposit or replaying", async ({
  page,
}) => {
  await message(page).fill("uncertain authorization");
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "The payment service returned HTTP 503.",
  );
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Connection settings" });
  await expect(panel).toContainText(
    "Check payment can release it so this deposit can be used again.",
  );
  await expect(panel).toContainText(
    "Your balance stays saved and no message is resent.",
  );
  const deposits = panel.getByLabel("Saved deposits");
  await expect(deposits).toHaveValue("fixture");
  const depositOptions = await deposits.locator("option").allTextContents();
  const balance = await panel.locator(".balance-panel strong").innerText();
  const attempts = await callAttempts(page);
  expect(attempts).toHaveLength(1);
  expect(
    await page.evaluate(() => localStorage.getItem("fixture:recoverCalls")),
  ).toBeNull();

  await page.evaluate(() => localStorage.setItem("fixture:allowRelease", "1"));
  await panel
    .getByRole("button", { name: "Check payment", exact: true })
    .click();
  await expect(panel).toContainText("Ready to chat.");
  await expect(
    panel.getByRole("heading", { name: "Payment pending" }),
  ).toHaveCount(0);
  await expect(deposits).toHaveValue("fixture");
  expect(await deposits.locator("option").allTextContents()).toEqual(
    depositOptions,
  );
  await expect(panel.locator(".balance-panel strong")).toHaveText(balance);
  expect(await callAttempts(page)).toEqual(attempts);
  expect(
    await page.evaluate(() => ({
      recover: localStorage.getItem("fixture:recoverCalls"),
      clearance: localStorage.getItem("fixture:clearanceCalls"),
      settled: localStorage.getItem("fixture:settled"),
    })),
  ).toEqual({ recover: "1", clearance: null, settled: null });

  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await message(page).fill("a new explicit message");
  await expect(sendButton(page)).toBeEnabled();
  expect(await callAttempts(page)).toEqual(attempts);
  await sendButton(page).click();
  await expect(page.locator(".message.assistant").last()).toContainText(
    "Fixture reply",
  );
  const finalAttempts = await callAttempts(page);
  expect(finalAttempts).toHaveLength(2);
  expect(finalAttempts[1].operationId).not.toBe(attempts[0].operationId);
  expect(finalAttempts[1].messages.at(-1).content).toBe(
    "a new explicit message",
  );
});

test("uncertain authorization explains permanent withdrawal-only recovery without replay", async ({
  page,
}) => {
  await message(page).fill("uncertain authorization");
  await sendButton(page).click();
  await expect(page.locator(".message.assistant")).toContainText(
    "The payment service returned HTTP 503.",
  );
  await page.getByRole("button", { name: "Check status", exact: true }).click();
  const panel = page.getByRole("dialog", { name: "Connection settings" });
  await expect(panel).toContainText("This permanently prevents new messages");
  await panel
    .getByRole("button", {
      name: "Disable authorization for withdrawal",
      exact: true,
    })
    .click();
  await expect(panel).toContainText(
    "Authorization disabled. Withdraw this deposit",
  );
  await panel
    .getByRole("button", { name: "Refresh status", exact: true })
    .click();
  await expect(panel).toContainText(
    "Refresh status cannot undo that permanent protection.",
  );
  await expect(
    panel.getByRole("button", { name: "Withdraw balance", exact: true }),
  ).toBeEnabled();
  await panel.getByRole("button", { name: "Close", exact: true }).click();
  await expect(
    page.getByRole("button", { name: "Send again", exact: true }),
  ).toBeDisabled();
  expect(await callAttempts(page)).toHaveLength(1);
  expect(
    await page.evaluate(() => ({
      clearance: localStorage.getItem("fixture:clearanceCalls"),
      recover: localStorage.getItem("fixture:recoverCalls"),
    })),
  ).toEqual({ clearance: "1", recover: null });
});
