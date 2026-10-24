import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
for (const [version, expected] of Object.entries({
  "0.2.0-devnet.16":
    "29b8f521a95e99d2fd7aae11d6abdb728229a712d5cd4b967e857daaa1449d07",
  "0.2.0-devnet.15":
    "976fd54b7fdcbafea75870728c018d50d821bdc5e5137e4a8b8e7b3c77f15f98",
  "0.2.0-devnet.13":
    "e6e7668e1d37938f67f8865673aba1a11f27b975d3715a376ac24a6dcfa8a8a9",
  "0.2.0-devnet.12":
    "cf6deabf4e929deff9e9c5239144fc5ac6e64e6db7612af6c28a6bebd62bd129",
  "0.2.0-devnet.10":
    "087e5dd6da712710509a5320f93e4426687382a7f976e8ce522e83b2318a08a2",
  "0.2.0-devnet.8":
    "cd9226f4526c0b3561a557e4c7beb4f495dcbad6c995c624f4c442b6621414da",
  "0.2.0-devnet.3":
    "5dfa1d9edf58e6a8b3359cc16d29e55657b6c205e948b7ca1b7b40018e452887",
})) {
  const url = new URL(
    `../vendor/zkapi-solana-sdk-${version}.tgz`,
    import.meta.url,
  );
  const actual = createHash("sha256").update(readFileSync(url)).digest("hex");
  if (actual !== expected)
    throw new Error(
      `SDK ${version} archive SHA-256 mismatch. Refusing this artifact.`,
    );
  console.log(
    `Solana zkAPI ${version}: ${version === "0.2.0-devnet.16" ? "local patch" : "published GitHub release"} archive SHA-256 matches.`,
  );
}

const verifier = readFileSync(
  new URL(
    "../src/assets/zkapi-client-prover-0.2.0-devnet.16-395465e39aef68ff.wasm",
    import.meta.url,
  ),
);
if (
  createHash("sha256").update(verifier).digest("hex") !==
  "395465e39aef68ff1e9fd3167cb80d03a653bab09a54c83c18cbf8df06c60d84"
)
  throw new Error("Local verifier patch SHA-256 mismatch.");
console.log(
  "Local verifier patch SHA-256 matches; original profile remains pinned.",
);
