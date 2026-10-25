import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
import { readFile, writeFile } from "node:fs/promises";
import { resolve } from "node:path";
export default defineConfig(({ mode }) => {
  const recoveryVersion =
    mode === "recovery" ? "3" : mode === "recovery-v12" ? "12" : null;
  const recoveryPackage =
    recoveryVersion === "3"
      ? "@zkapi/solana-sdk-legacy"
      : "@zkapi/solana-sdk-previous";
  const recoveryConfig = `config/zkapi-config.devnet.${recoveryVersion}.json`;
  return {
    cacheDir:
      loadEnv(mode, ".", "ZKCHAT_").ZKCHAT_VITE_CACHE_DIR ??
      `node_modules/.vite-${mode}`,
    define: {
      "import.meta.env.VITE_ZKCHAT_SDK_VERSION": JSON.stringify(
        `0.2.0-devnet.${recoveryVersion ?? "19"}`,
      ),
    },
    resolve: {
      alias: recoveryVersion
        ? [
            {
              find: /^@zkapi\/solana-sdk(?=\/|$)/,
              replacement: recoveryPackage,
            },
            {
              find: /^\.\/currentVerifier$/,
              replacement: resolve("src/lib/originalVerifier.ts"),
            },
            {
              find: /^\.\/currentRecovery$/,
              replacement: resolve("src/lib/originalRecovery.ts"),
            },
          ]
        : [],
    },
    plugins: [
      react(),
      ...(recoveryVersion
        ? [
            {
              name: "original-recovery-profile",
              configureServer(server: import("vite").ViteDevServer) {
                server.middlewares.use(async (request, response, next) => {
                  if (request.url?.split("?")[0] !== "/zkapi-config.json")
                    return next();
                  try {
                    response.setHeader("Content-Type", "application/json");
                    response.setHeader("Cache-Control", "no-store");
                    response.end(await readFile(recoveryConfig));
                  } catch (error) {
                    next(error);
                  }
                });
              },
              async writeBundle(options: { dir?: string }) {
                await writeFile(
                  resolve(options.dir!, "zkapi-config.json"),
                  await readFile(recoveryConfig),
                );
              },
            },
          ]
        : []),
    ],
    worker: { format: "es" },
    // The prover is first imported when custody opens. Optimize it before that
    // action so Vite does not reload a page holding an in-progress operation.
    optimizeDeps: { include: ["@zkapi/solana-sdk/prover-worker"] },
    server: { port: 5173, strictPort: true },
    preview: { port: 4173, strictPort: true },
    build: {
      target: "es2022",
      rollupOptions: {
        output: {
          manualChunks: {
            "zkapi-sdk": [
              "@zkapi/solana-sdk/browser",
              "@zkapi/solana-sdk/deployment",
              "@solana/kit",
            ],
            markdown: ["react-markdown", "remark-gfm"],
          },
        },
      },
    },
  };
});
