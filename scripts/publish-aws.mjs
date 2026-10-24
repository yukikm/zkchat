import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readdir, readFile, stat } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { resolve } from "node:path";
import { parseArgs } from "node:util";

const root = fileURLToPath(new URL("../", import.meta.url));
const dist = resolve(root, "dist");
const { values } = parseArgs({
  options: {
    stack: { type: "string", default: "zkchat-static" },
    profile: { type: "string" },
    account: { type: "string" },
    apply: { type: "boolean", default: false },
  },
});
const mutableCache = "public,max-age=0,s-maxage=60,must-revalidate";
const immutableCache = "public,max-age=31536000,immutable";

async function listFiles(directory, prefix = "") {
  const files = [];
  for (const entry of await readdir(directory, { withFileTypes: true })) {
    assert(!entry.isSymbolicLink(), "dist must not contain symlinks");
    const key = `${prefix}${entry.name}`;
    if (entry.isDirectory()) {
      files.push(
        ...(await listFiles(resolve(directory, entry.name), `${key}/`)),
      );
    } else {
      assert(entry.isFile(), `Unexpected build entry: ${key}`);
      // Vite copies the shared public notices into each build. Permit only the
      // reviewed provenance Markdown files, not arbitrary source documentation.
      const verifierNotice =
        /^(?:recovery-v(?:12|3)\/)?verifier-notices\/(?:BUNDLE-PROVENANCE|PROVENANCE|ethereum-VENDORED-045b444|mingyech-(?:setup-)?README-8b2d4e3)\.md$/.test(
          key,
        );
      assert(
        /\.(html|js|css|json|svg|txt|woff2|wasm)$/.test(key) || verifierNotice,
        `Unexpected build file: ${key}`,
      );
      files.push(key);
    }
  }
  return files;
}

function aws(args, json = false) {
  const result = spawnSync(
    "aws",
    [
      ...args,
      "--region",
      "us-east-1",
      ...(values.profile ? ["--profile", values.profile] : []),
      ...(json ? ["--output", "json"] : []),
    ],
    {
      cwd: root,
      env: { ...process.env, AWS_PAGER: "", AWS_CLI_AUTO_PROMPT: "off" },
      encoding: "utf8",
      stdio: json ? ["ignore", "pipe", "inherit"] : "inherit",
    },
  );
  if (result.error) throw result.error;
  assert.equal(
    result.status,
    0,
    `AWS command failed: ${args.slice(0, 2).join(" ")}`,
  );
  return json ? JSON.parse(result.stdout) : undefined;
}

const files = await listFiles(dist);
for (const [prefix, source] of [
  ["", "public/zkapi-config.json"],
  ["recovery-v12/", "config/zkapi-config.devnet.12.json"],
  ["recovery-v3/", "config/zkapi-config.devnet.3.json"],
]) {
  const html = await readFile(resolve(dist, `${prefix}index.html`), "utf8");
  assert(
    html.includes(`/${prefix}assets/`),
    "Rebuild with the default root base path",
  );
  assert.deepEqual(
    JSON.parse(
      await readFile(resolve(dist, `${prefix}zkapi-config.json`), "utf8"),
    ),
    JSON.parse(await readFile(resolve(root, source), "utf8")),
    `The ${prefix || "current"} build has an outdated profile; rebuild first`,
  );
  assert(
    files.some((key) => key.startsWith(`${prefix}assets/prover.worker-`)),
    "Missing prover worker",
  );
}
const sizes = await Promise.all(
  files.map(async (key) => (await stat(resolve(dist, key))).size),
);
console.log(
  JSON.stringify(
    {
      mode: values.apply ? "publish" : "local plan (no AWS calls)",
      stack: values.stack,
      region: "us-east-1",
      files: files.length,
      bytes: sizes.reduce((sum, size) => sum + size, 0),
      assetsCacheControl: immutableCache,
      otherCacheControl: mutableCache,
      oldAssets: "retained for open tabs and recovery",
    },
    null,
    2,
  ),
);

if (!values.apply) {
  console.log(
    "Run the build checks, create the disabled stack, then use --apply --account YOUR_ACCOUNT_ID. See docs/AWS-DEPLOY.md.",
  );
} else {
  assert(
    /^\d{12}$/.test(values.account ?? ""),
    "--apply requires --account with the intended 12-digit AWS account ID",
  );
  const identity = aws(["sts", "get-caller-identity"], true);
  assert.equal(
    identity.Account,
    values.account,
    "The active credentials belong to a different AWS account",
  );
  const {
    Stacks: [stack],
  } = aws(
    ["cloudformation", "describe-stacks", "--stack-name", values.stack],
    true,
  );
  assert(
    ["CREATE_COMPLETE", "UPDATE_COMPLETE"].includes(stack.StackStatus),
    "The stack must have completed successfully",
  );
  const output = Object.fromEntries(
    (stack.Outputs ?? []).map(({ OutputKey, OutputValue }) => [
      OutputKey,
      OutputValue,
    ]),
  );
  for (const key of [
    "BucketName",
    "DistributionId",
    "DistributionArn",
    "WebAclArn",
    "SiteUrl",
    "SubscriptionArn",
  ]) {
    assert(output[key], `Missing ${key}; use the zkchat static-site template`);
  }
  // Read the live resource through Cloud Control, not potentially stale stack outputs.
  // This also works with AWS CLI versions that predate pricing-plan-manager.
  const subscriptionResult = aws(
    [
      "cloudcontrol",
      "get-resource",
      "--type-name",
      "AWS::PricingPlanManager::Subscription",
      "--identifier",
      output.SubscriptionArn,
    ],
    true,
  );
  const subscription = JSON.parse(
    subscriptionResult.ResourceDescription.Properties,
  );
  assert.equal(
    subscription.Status,
    "ACTIVE",
    "The FREE subscription is not active; publication stopped",
  );
  assert.equal(
    subscription.CurrentPlanTier,
    "FREE",
    "The live subscription must use the FREE tier",
  );
  assert.equal(subscription.PlanFamily, "CloudFront");
  for (const arn of [output.DistributionArn, output.WebAclArn]) {
    assert(
      subscription.ResourceArns.includes(arn),
      "The subscription does not cover this distribution and WAF",
    );
  }
  const destination = `s3://${output.BucketName}/`;
  // Upload dependencies first. Never --delete: open pages can still need old chunks.
  for (const prefix of [
    "assets",
    "recovery-v12/assets",
    "recovery-v3/assets",
  ]) {
    aws([
      "s3",
      "sync",
      resolve(dist, prefix),
      `${destination}${prefix}/`,
      "--cache-control",
      immutableCache,
      "--only-show-errors",
    ]);
  }
  aws([
    "s3",
    "cp",
    dist,
    destination,
    "--recursive",
    "--exclude",
    "assets/*",
    "--exclude",
    "recovery-v12/assets/*",
    "--exclude",
    "recovery-v3/assets/*",
    "--exclude",
    "index.html",
    "--exclude",
    "recovery-v12/index.html",
    "--exclude",
    "recovery-v3/index.html",
    "--cache-control",
    mutableCache,
    "--only-show-errors",
  ]);
  for (const key of [
    "recovery-v12/index.html",
    "recovery-v3/index.html",
    "index.html",
  ]) {
    aws([
      "s3",
      "cp",
      resolve(dist, key),
      `${destination}${key}`,
      "--content-type",
      "text/html; charset=utf-8",
      "--cache-control",
      mutableCache,
      "--only-show-errors",
    ]);
  }
  const invalidation = aws(
    [
      "cloudfront",
      "create-invalidation",
      "--distribution-id",
      output.DistributionId,
      "--paths",
      "/",
      "/index.html",
      "/zkapi-config.json",
      "/recovery-v12",
      "/recovery-v12/",
      "/recovery-v12/index.html",
      "/recovery-v12/zkapi-config.json",
      "/recovery-v3",
      "/recovery-v3/",
      "/recovery-v3/index.html",
      "/recovery-v3/zkapi-config.json",
    ],
    true,
  );
  console.log(
    JSON.stringify(
      {
        uploaded: true,
        siteUrl: output.SiteUrl,
        distributionId: output.DistributionId,
        invalidationId: invalidation.Invalidation.Id,
        note: "This command does not enable the distribution. For initial publication, follow docs/AWS-DEPLOY.md.",
      },
      null,
      2,
    ),
  );
}
