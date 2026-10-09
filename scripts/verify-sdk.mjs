import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";
const expected =
  "5dfa1d9edf58e6a8b3359cc16d29e55657b6c205e948b7ca1b7b40018e452887";
const url = new URL(
  "../vendor/zkapi-solana-sdk-0.2.0-devnet.3.tgz",
  import.meta.url,
);
const actual = createHash("sha256").update(readFileSync(url)).digest("hex");
if (actual !== expected)
  throw new Error(
    "Published SDK archive SHA-256 mismatch. Refusing this artifact.",
  );
console.log(
  "Solana zkAPI 0.2.0-devnet.3: published GitHub release archive SHA-256 matches.",
);
