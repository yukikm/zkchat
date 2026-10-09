import { defineConfig, loadEnv } from "vite";
import react from "@vitejs/plugin-react";
export default defineConfig(({ mode }) => ({
  cacheDir: loadEnv(mode, ".", "ZKCHAT_").ZKCHAT_VITE_CACHE_DIR,
  plugins: [react()],
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
}));
