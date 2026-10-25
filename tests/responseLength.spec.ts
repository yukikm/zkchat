import { expect, test, type Page } from "@playwright/test";

const partialReply = "証明の手順\n\n1. 友人は入口の";
const longReply = [
  "## ゼロ知識証明の説明",
  ...Array.from(
    { length: 24 },
    (_, index) =>
      `${index + 1}. 合言葉を明かさずに、それを知っていることを友人に証明します。友人は左右どちらかの道を選び、あなたは秘密の扉を通って指定された入口に戻ります。同じ確認を何度も繰り返すことで、偶然に成功した可能性を小さくできます。`,
  ),
  "最後まで表示されました。秘密そのものを渡さずに、知っていることを確かめられます。",
].join("\n\n");
const lengthNotice = "Response reached the length limit. Ask to continue.";
const filterNotice =
  "The provider stopped this response because of its content filter.";

// Replace only the wallet/provider boundary. The app still reads these JSON and
// SSE responses through its real response reader and the installed SDK.
const fixture = `
export class BrowserStorageMissing extends Error {}
export class RecoveryError extends Error {}
export class RecoveryAccessMoved extends RecoveryError {}
export async function validateZkchatRecoveryFile() {}
export class RecoverySetupIncomplete extends RecoveryError {}
export const restoreZkchatDeposits = async () => { throw new Error('Unexpected recovery'); };
export const finishZkchatRecoverySetup = async () => { throw new Error('Unexpected recovery setup'); };
const account={address:'11111111111111111111111111111111'};
const wallet={name:'Response Length Test Wallet'};
export const configuredModels=()=>[{id:'test/model',apis:['chat']}];
export const configuredMode=()=> 'direct_openrouter';
export const configuredStreaming=()=>localStorage.getItem('fixture:streaming')==='1';
export const loadConfig=async()=>({schema:2});
export const listWallets=()=>[wallet];
export const watchWallets=()=>()=>{};
export const connectWalletAccount=async()=>account;
const state={noteId:'fixture',mode:'direct_openrouter',wallet:'active',canRequest:true,busy:false,session:null,walletOperation:null,emergencyEscape:null,settledBalanceMicroUsdc:'2000000',authorizationCapMicroUsdc:'1000000'};
export const connectZkapi=async()=>({account,wallet,recoveryEnabled:true,persistence:'persistent',publicAdmissionReady:true,deposits:[{id:'fixture'}],selectedDepositId:'fixture',deployment:{mint:'fixture-mint'},dispose(){},refreshPreflight:async()=>{},client:{
 status:async()=>state,subscribe:()=>()=>{},
 chat:async request=>{
   const calls=JSON.parse(localStorage.getItem('fixture:calls')||'[]');
   calls.push(request);
   localStorage.setItem('fixture:calls',JSON.stringify(calls));
   const prompt=request.messages.at(-1).content;
   const finishReason=prompt==='limited reply'?'length':prompt==='filtered reply'?'content_filter':'stop';
   const content=finishReason==='stop'?${JSON.stringify(longReply)}:${JSON.stringify(partialReply)};
   if(!request.stream) return Response.json({choices:[{index:0,message:{role:'assistant',content},finish_reason:finishReason}]});
   const body=new ReadableStream({start(controller){
     const encode=value=>new TextEncoder().encode('data: '+JSON.stringify(value)+'\\n\\n');
     for(let start=0;start<content.length;start+=47) controller.enqueue(encode({choices:[{index:0,delta:{content:content.slice(start,start+47)},finish_reason:null}]}));
     controller.enqueue(encode({choices:[{index:0,delta:{},finish_reason:finishReason}]}));
     controller.enqueue(new TextEncoder().encode('data: [DONE]\\n\\n'));
     controller.close();
   }});
   return new Response(body,{headers:{'Content-Type':'text/event-stream'}});
 },
}});`;

async function connectAccount(page: Page) {
  await page
    .getByRole("button", { name: "Wallet & balance", exact: true })
    .click();
  await page
    .getByRole("dialog", { name: "Wallet & balance" })
    .getByRole("button", { name: "Connect wallet", exact: true })
    .click();
  await expect(
    page.getByRole("button", { name: "Return to chat", exact: true }),
  ).toBeEnabled();
  await page.getByRole("button", { name: "Close", exact: true }).click();
}

async function sendMessage(page: Page, prompt: string) {
  await page
    .getByRole("textbox", { name: "Message", exact: true })
    .fill(prompt);
  await page.getByRole("button", { name: "Send message", exact: true }).click();
  await expect(
    page.locator(".message.assistant").last().locator(".markdown"),
  ).not.toBeEmpty();
  await expect(
    page.getByRole("button", { name: "Stop generation", exact: true }),
  ).toHaveCount(0);
}

async function reopenHistory(page: Page, title: string) {
  await page.reload();
  await page.getByRole("button", { name: title, exact: true }).click();
}

const savedReply = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(
      localStorage.getItem("zkchat:conversations:v1") || "[]",
    )[0]?.messages.at(-1),
  );

const requests = (page: Page) =>
  page.evaluate(() =>
    JSON.parse(localStorage.getItem("fixture:calls") || "[]"),
  );

test.beforeEach(async ({ page }) => {
  await page.route("**/*", (route) =>
    ["127.0.0.1", "localhost"].includes(new URL(route.request().url()).hostname)
      ? route.continue()
      : route.abort(),
  );
  await page.route("**/src/lib/zkapi.ts*", (route) =>
    route.fulfill({ contentType: "application/javascript", body: fixture }),
  );
});

for (const streaming of [false, true]) {
  test.describe(streaming ? "streamed replies" : "JSON replies", () => {
    test.beforeEach(async ({ page }) => {
      await page.addInitScript((value) => {
        localStorage.setItem("fixture:streaming", value ? "1" : "0");
      }, streaming);
      await page.goto("/");
      await connectAccount(page);
    });

    for (const scenario of [
      { prompt: "limited reply", finishReason: "length", notice: lengthNotice },
      {
        prompt: "filtered reply",
        finishReason: "content_filter",
        notice: filterNotice,
      },
    ]) {
      test(`${scenario.finishReason} preserves the partial answer and explains why it ended`, async ({
        page,
      }) => {
        await sendMessage(page, scenario.prompt);
        const assistant = page.locator(".message.assistant");
        await expect(assistant.locator(".markdown")).toContainText(
          "友人は入口の",
        );
        await expect(assistant.locator(".message-feedback")).toHaveText(
          scenario.notice,
        );
        await expect
          .poll(() => savedReply(page))
          .toMatchObject({
            content: partialReply,
            state: "complete",
            finishReason: scenario.finishReason,
          });
        expect(await requests(page)).toMatchObject([{ stream: streaming }]);

        await reopenHistory(page, scenario.prompt);
        await expect(assistant.locator(".markdown")).toContainText(
          "友人は入口の",
        );
        await expect(assistant.locator(".message-feedback")).toHaveText(
          scenario.notice,
        );
        expect(await requests(page)).toHaveLength(1);
      });
    }

    test("renders and saves a long Japanese answer through its final paragraph and copies the whole reply", async ({
      page,
      context,
    }) => {
      await context.grantPermissions(["clipboard-read", "clipboard-write"]);
      await sendMessage(page, "complete reply");
      const assistant = page.locator(".message.assistant");
      const tail = assistant.locator(".markdown p").last();
      await tail.scrollIntoViewIfNeeded();
      await expect(tail).toHaveText(longReply.split("\n\n").at(-1)!);
      await expect(tail).toBeInViewport();
      await expect(assistant.locator(".message-feedback")).toHaveCount(0);
      await expect
        .poll(() => savedReply(page))
        .toMatchObject({
          content: longReply,
          state: "complete",
        });

      await reopenHistory(page, "complete reply");
      await tail.scrollIntoViewIfNeeded();
      await expect(tail).toBeInViewport();
      await expect(tail).toHaveText(longReply.split("\n\n").at(-1)!);
      await expect(assistant.locator(".message-feedback")).toHaveCount(0);
      await assistant
        .getByRole("button", { name: "Copy response", exact: true })
        .click();
      await expect
        .poll(() => page.evaluate(() => navigator.clipboard.readText()))
        .toBe(longReply);
      expect(await requests(page)).toMatchObject([{ stream: streaming }]);
    });
  });
}

test("the public profile uses the full default response length and retains a lower chosen limit", async ({
  page,
}) => {
  await page.goto("/");
  await connectAccount(page);
  await sendMessage(page, "default response length");
  expect(await requests(page)).toMatchObject([{ maxOutputTokens: 4096 }]);

  await page
    .getByRole("button", { name: "Appearance and chat", exact: true })
    .click();
  const slider = page.getByRole("slider", { name: /Response length/ });
  await expect(slider).toHaveAttribute("max", "4096");
  await expect(slider).toHaveValue("4096");
  await slider.fill("2048");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await sendMessage(page, "chosen response length");
  expect(await requests(page)).toMatchObject([
    { maxOutputTokens: 4096 },
    { maxOutputTokens: 2048 },
  ]);

  await page.reload();
  await page
    .getByRole("button", { name: "Appearance and chat", exact: true })
    .click();
  await expect(slider).toHaveValue("2048");
  await page.getByRole("button", { name: "Close", exact: true }).click();
  await connectAccount(page);
  await sendMessage(page, "restored response length");
  expect(await requests(page)).toMatchObject([
    { maxOutputTokens: 4096 },
    { maxOutputTokens: 2048 },
    { maxOutputTokens: 2048 },
  ]);
});
