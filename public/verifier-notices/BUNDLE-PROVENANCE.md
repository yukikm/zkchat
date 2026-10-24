# Fresh Public Devnet bundle provenance

This document was added by Solana zkAPI for a new experimental Devnet deployment. It preserves the separately reviewed upstream notices and original-author Apache-2.0 license choice for the four exact request/withdrawal setup files. Root MIT applies only to newly authored Solana zkAPI code and documentation; Solana-zkAPI-LICENSE.txt retains that notice.

The tree setup and four service-role keys were freshly generated with OS randomness. The new program, Pool seed, compiler-generated IDL and SBF build are separate from all earlier deployments. No old funded Pool, journal, budget or immutable release is migrated. Setup is single-party/test-only; erasure of setup entropy is not independently attested and no mainnet, multiparty ceremony or audit claim follows.

Fresh public setup descriptor SHA-256: d1a6cdcd0a6d8b5690081ef15a976716bba1b2e7673b56f4e31ecb080ff9ed89.
Fresh circuit profile hash: bd23d163a2c13ddcc56da54312d3768cdd6e1bdcabe99d83d3e0f10ce48d8e33.
Program address: 2sXbYtY2NbyGm1GeCETkkjAa5LxWCA8v8aj2ePW3yVDH.
Pool address: Cx8DbA49UCuASoc3goLCU9ro25eWVtcGMbvfPPJsSQzV.
Fresh SBF ELF SHA-256: 80013c3556378a7513f080dcee6134e1296d9db4a67f2053f49b27f0f97fcd25.
Fresh compiler IDL SHA-256: f389d0d7e530359137da9e9a597abf7e667cf927a4ba295e3f90a42175a87ce9.
WASM prover SHA-256: c06a247e1ff88f1ac415ea127bcf49d486b5b4954715cdf00f133b5ac71c1f30.

Rust-dependencies.json maps the current binary hashes to a conservative normal/build dependency closure. Fresh offline Cargo metadata for the WASM target and devnet SBF configuration retains the same 161/220 selected package IDs as the prior reviewed closure; exact Cargo locks and all 301 package declarations were rechecked. The existing WASM bytes and supplied Rust notice texts are unchanged. Rust-notices-*.json retain exact UTF-8 notice/declaration texts keyed by SHA-256; decoding each text reconstructs its original bytes. Declaration-only crates remain explicit. This does not assert that every normal/build package is linked in either binary. The available SBF standard-library source notices and core/alloc license declarations are preserved; no unavailable full copyright catalog is invented.

The complete bundle descriptor authenticates each file and notice. Service availability, actual funded lifecycles, public downloads and operator recovery require their own receipts; this provenance does not establish those outcomes.
