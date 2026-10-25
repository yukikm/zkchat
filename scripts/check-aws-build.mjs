import assert from "node:assert/strict";
import { readFile, readdir } from "node:fs/promises";
import { createServer } from "node:http";
import { extname, resolve, sep } from "node:path";
import { runInNewContext } from "node:vm";
import { chromium } from "@playwright/test";

const template = JSON.parse(
  await readFile("infra/aws/static-site.json", "utf8"),
);
const functions = Object.values(template.Resources).filter(
  (resource) => resource.Type === "AWS::CloudFront::Function",
);
assert.equal(functions.length, 1);
const code = functions[0].Properties.FunctionCode;
assert.equal(typeof code, "string");
assert.equal(code, await readFile("infra/aws/viewer-request.js", "utf8"));
const handler = runInNewContext(`${code}\nhandler`, {}, { timeout: 1000 });
const root = resolve("dist");
const types = {
  ".html": "text/html; charset=utf-8",
  ".js": "application/javascript; charset=utf-8",
  ".json": "application/json; charset=utf-8",
  ".css": "text/css; charset=utf-8",
  ".woff2": "font/woff2",
  ".wasm": "application/wasm",
  ".svg": "image/svg+xml",
  ".txt": "text/plain; charset=utf-8",
};

// CloudFront exposes encoded query components, including repeated parameters.
function querystring(search) {
  const result = Object.create(null);
  for (const part of search.slice(1).split("&").filter(Boolean)) {
    const split = part.indexOf("=");
    const name = split < 0 ? part : part.slice(0, split);
    const item = { value: split < 0 ? "" : part.slice(split + 1) };
    if (result[name]) {
      result[name].multiValue ??= [{ value: result[name].value }];
      result[name].multiValue.push(item);
    } else result[name] = item;
  }
  return result;
}

const serverErrors = [];
const server = createServer((request, response) => {
  serve(request, response).catch((error) => {
    serverErrors.push(error.message);
    response.writeHead(500).end();
  });
});
async function serve(request, response) {
  const url = new URL(request.url, "http://localhost");
  const result = handler({
    request: {
      uri: url.pathname,
      method: request.method,
      querystring: querystring(url.search),
      headers: { host: { value: request.headers.host } },
      cookies: {},
    },
  });
  if (result.statusCode) {
    response
      .writeHead(
        Number(result.statusCode),
        Object.fromEntries(
          Object.entries(result.headers ?? {}).map(([name, item]) => [
            name,
            item.value,
          ]),
        ),
      )
      .end();
    return;
  }
  const path = resolve(root, `.${decodeURIComponent(result.uri)}`);
  if (!path.startsWith(`${root}${sep}`)) {
    response.writeHead(403).end();
    return;
  }
  let bytes;
  try {
    bytes = await readFile(path);
  } catch (error) {
    if (!["ENOENT", "ENOTDIR", "EISDIR"].includes(error.code)) throw error;
    // S3 REST origins do not provide directory indexes or SPA fallbacks.
    response.writeHead(404, { "Content-Type": "text/plain" }).end("Not found");
    return;
  }
  response.writeHead(200, {
    "Content-Type": types[extname(path)] ?? "application/octet-stream",
    "Content-Length": bytes.length,
  });
  response.end(request.method === "HEAD" ? undefined : bytes);
}

await new Promise((resolve, reject) => {
  server.once("error", reject);
  server.listen(0, "127.0.0.1", resolve);
});
const origin = `http://127.0.0.1:${server.address().port}`;
let browser;
try {
  for (const directory of ["recovery-v12", "recovery-v3"]) {
    const redirect = await fetch(
      `${origin}/${directory}?source=old%20deposit&source=second`,
      { redirect: "manual" },
    );
    assert.equal(redirect.status, 301);
    assert.equal(
      redirect.headers.get("location"),
      `/${directory}/?source=old%20deposit&source=second`,
    );
  }
  for (const [base, pin] of [
    ["/", "5e15d66c6f45265951cf1f8dd6cc0dae6574c4b8dd6756f828f7543ecaa97b9a"],
    [
      "/recovery-v12/",
      "ec10c1ab41bb5105222d3e25c7e1eba6b96b1b397abd0f854657030269992a77",
    ],
    [
      "/recovery-v3/",
      "449657cc3fe90f12878236b83d68ada8077e3c56e67ccb8268c5f301e69e02e5",
    ],
  ]) {
    const config = await fetch(`${origin}${base}zkapi-config.json`);
    assert.equal(config.status, 200);
    assert.match(config.headers.get("content-type"), /^application\/json/);
    assert.equal((await config.json()).profileSha256, pin);
    const assets = await readdir(resolve(root, `.${base}assets`));
    const worker = assets.find((name) => /^prover\.worker-.*\.js$/.test(name));
    assert.ok(worker, `Missing module worker at ${base}`);
    const response = await fetch(`${origin}${base}assets/${worker}`);
    assert.equal(response.status, 200);
    assert.match(
      response.headers.get("content-type"),
      /^application\/javascript/,
    );
    for (const missing of [
      "assets/missing.js",
      "missing-config.json",
      "missing/",
    ]) {
      const response = await fetch(`${origin}${base}${missing}`);
      assert.equal(
        response.status,
        404,
        `Unexpected fallback for ${base}${missing}`,
      );
      assert.doesNotMatch(response.headers.get("content-type"), /text\/html/);
    }
  }

  browser = await chromium.launch();
  const context = await browser.newContext({ serviceWorkers: "block" });
  await context.route("**/*", (route) => {
    const url = new URL(route.request().url());
    if (url.origin !== origin) return route.abort();
    // Pins were checked above; keep browser checks fully offline and unsigned.
    if (url.pathname.endsWith("/zkapi-config.json"))
      return route.fulfill({ json: null });
    return route.continue();
  });
  const page = await context.newPage();
  const errors = [];
  page.on("pageerror", (error) => errors.push(error.message));
  assert.equal((await page.goto(origin)).status(), 200);
  await page.evaluate(() =>
    localStorage.setItem("aws-recovery-sentinel", "preserved"),
  );
  for (const [directory, label, version] of [
    ["recovery-v12", "Open October 8 deposit data", "12"],
    ["recovery-v3", "Open original deposit data", "3"],
  ]) {
    await page
      .getByRole("button", { name: "Wallet & balance", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("Connection details", { exact: true })
      .click();
    assert.match(
      await page.getByRole("dialog").textContent(),
      /SDK 0\.2\.0-devnet\.19/,
    );
    await page.getByText("Older deposit data", { exact: true }).click();
    await page.getByRole("link", { name: label, exact: true }).click();
    await page.waitForURL(`${origin}/${directory}/`);
    await page
      .getByRole("button", { name: "Wallet & balance", exact: true })
      .click();
    await page
      .getByRole("dialog")
      .getByText("Connection details", { exact: true })
      .click();
    assert.ok(
      (await page.getByRole("dialog").textContent()).includes(
        `SDK 0.2.0-devnet.${version}`,
      ),
    );
    assert.equal(
      await page.evaluate(() => localStorage.getItem("aws-recovery-sentinel")),
      "preserved",
    );
    await page.getByRole("button", { name: "Close", exact: true }).click();
    await page
      .getByRole("link", { name: "Return to the current app", exact: true })
      .click();
    await page.waitForURL(`${origin}/`);
  }
  assert.deepEqual(errors, []);
  assert.deepEqual(serverErrors, []);
  console.log(
    "AWS build passed locally: CloudFront routing emulation, recovery redirect, separate SDK/profile pins, JavaScript MIME, missing-file errors and same-origin storage. No public API or wallet operations.",
  );
} finally {
  await browser?.close();
  await new Promise((resolve) => server.close(resolve));
}
