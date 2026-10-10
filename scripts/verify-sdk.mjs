import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
for (const [version, expected] of Object.entries({
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
      `Published SDK ${version} archive SHA-256 mismatch. Refusing this artifact.`,
    );
  console.log(
    `Solana zkAPI ${version}: published GitHub release archive SHA-256 matches.`,
  );
}
