import { readFile, writeFile } from "node:fs/promises";
import {
  loadPublicDeploymentProfile,
  preflightPublicDeployment,
} from "@zkapi/solana-sdk/public-profile";
import { checkServiceReadiness } from "../src/lib/readiness.ts";
const config = JSON.parse(
  await readFile(
    new URL("../public/zkapi-config.json", import.meta.url),
    "utf8",
  ),
);
const report = {
  startedAt: new Date().toISOString(),
  sdk: JSON.parse(
    await readFile(
      new URL(
        "../node_modules/@zkapi/solana-sdk/package.json",
        import.meta.url,
      ),
      "utf8",
    ),
  ).version,
  node: process.version,
  profileSha256: config.profileSha256,
  checks: [],
  scope:
    "Read-only public HTTP and SDK preflight. No custody, signatures, AUTH or inference.",
};
let stage = "profile";
try {
  const loaded = await loadPublicDeploymentProfile(config.profileUrl, {
    profileSha256: config.profileSha256,
  });
  report.checks.push({
    stage,
    passed: true,
    profileId: loaded.profile.id,
    models: loaded.profile.models.map((m) => m.id),
    wasmBytes: loaded.assets.wasm.byteLength,
  });
  stage = "preflight";
  const preflight = await preflightPublicDeployment(loaded);
  report.checks.push({ stage, passed: true, ...preflight });
  stage = "readiness";
  const manifest = loaded.assets.verifiedManifest;
  const readiness = await checkServiceReadiness({
    origin: manifest.control_api_origin,
    id: manifest.deployment_id,
    manifestHash: manifest.manifest_hash,
  });
  report.checks.push({ stage, passed: true, ...readiness });
} catch (error) {
  report.checks.push({
    stage,
    passed: false,
    component: error?.component ?? stage,
    error: "Public verification failed; no financial action was attempted.",
  });
  process.exitCode = 1;
}
report.completedAt = new Date().toISOString();
const json = JSON.stringify(report, null, 2) + "\n";
if (process.argv[2]) await writeFile(process.argv[2], json);
console.log(json);
