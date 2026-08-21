import { defineWorkersConfig } from "@cloudflare/vitest-pool-workers/config";

export default defineWorkersConfig({
  test: {
    poolOptions: {
      workers: {
        wrangler: { configPath: "./wrangler.toml" },
        miniflare: {
          // Allow tests to read/write the worker entrypoint and D1 binding.
          // Auto-apply the schema migration on startup.
          scriptPath: "./src/index.ts",
          modules: true,
        },
      },
    },
    setupFiles: ["./test/setup.ts"],
  },
});
