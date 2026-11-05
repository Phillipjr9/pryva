import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // `server-only` is a Next.js build-time guard with no runtime package
      // installed; stub it so server libraries can be imported under vitest.
      "server-only": fileURLToPath(new URL("./src/test/stubs/server-only.ts", import.meta.url)),
    },
  },
  test: {
    // Keep the default test environment as Node. Browser-like tests can opt into
    // jsdom explicitly at the file level when they need DOM globals.
    environment: "node",
    setupFiles: ["./src/test/setup.ts"],
    clearMocks: true,
  },
});
