import { fileURLToPath, URL } from "node:url";

import vue from "@vitejs/plugin-vue";
import { defineConfig } from "vitest/config";

export default defineConfig({
  plugins: [vue()],
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./packages/frontend/src", import.meta.url)),
      vue: fileURLToPath(
        new URL("./packages/frontend/node_modules/vue", import.meta.url),
      ),
    },
  },
  test: {
    include: ["packages/*/src/**/*.spec.ts"],
  },
});
