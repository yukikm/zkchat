import { expect, test } from "@playwright/test";

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
export const connectZkapi=async()=>({account,wallet,persistence:'persistent',publicAdmissionReady:true,deposits:[{id:'fixture'}],selectedDepositId:'fixture',deployment:{mint:'fixture-mint'},dispose(){},client:{
 status:async()=>state,subscribe:fn=>{listeners.add(fn);return()=>listeners.delete(fn)},
 chat:async request=>{
   calls.push(request); localStorage.setItem('fixture:calls',JSON.stringify(calls));
   if(request.messages.at(-1).content==='provider failure') {
     update({canRequest:false,session:{phase:'settlement_pending',operations:[]}});
     return new Response('private provider message', {status:402,headers:{'Content-Type':'application/json','X-Zkapi-Error-Code':'provider_budget_unavailable'}});
   }
   update({session:{id:request.sessionId,phase:'authorized',operations:[]}});
   return Response.json({choices:[{message:{content:'Fixture reply'},finish_reason:'stop'}]});
 },
 settle:async()=>{localStorage.setItem('fixture:settled','1');update({lastSettlement:{operationIds:calls.filter(c=>c.sessionId===state.session.id).map(c=>c.operationId),chargeMicroUsdc:'10000'},session:null});},
 recover:async()=>{throw new Error('Recovery must not be triggered automatically')},
}});`;

test.beforeEach(async ({ page }) => {
  await page.route("**/src/lib/zkapi.ts*", (r) =>
    r.fulfill({ contentType: "application/javascript", body: fixture }),
  );
  await page.goto("/");
  await page
    .getByRole("button", { name: "Connection settings", exact: true })
    .click();
  await page
    .getByRole("button", { name: "SDK Upgrade Test Wallet", exact: true })
    .click();
  await page
    .getByLabel("2. Select an account")
    .selectOption("11111111111111111111111111111111");
  await page
    .getByRole("button", { name: "Verify connection", exact: true })
    .click();
  await expect(page.getByLabel("Saved deposits")).toBeVisible();
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
    .getByRole("button", { name: "Close session / Settle", exact: true })
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
    page.getByRole("heading", { name: "Reusable session", exact: true }),
  ).toBeVisible();
  await page
    .getByRole("button", { name: "Close session / Settle", exact: true })
    .click();
  await expect(
    page.getByRole("heading", { name: "Reusable session", exact: true }),
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
    page.getByRole("button", { name: "Check recovery", exact: true }),
  ).toBeVisible();
  expect(
    await page.evaluate(
      () => JSON.parse(localStorage.getItem("fixture:calls")!).length,
    ),
  ).toBe(1);
});
