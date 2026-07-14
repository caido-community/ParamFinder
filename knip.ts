import type { RawConfigurationOrFn } from "knip/dist/types/config.js";

const config: RawConfigurationOrFn = {
  ignoreExportsUsedInFile: true,
  rules: {
    exports: "error",
    types: "error",
  },
  workspaces: {
    ".": {
      entry: ["caido.config.ts"],
    },
    "packages/backend": {
      project: ["src/**/*.ts"],
      ignoreDependencies: ["caido", "sqlite"],
    },
    "packages/shared": {
      project: ["src/**/*.ts"],
    },
    "packages/engine": {
      project: ["src/**/*.ts"],
    },
    "packages/cli": {
      project: ["src/**/*.ts"],
    },
    "packages/frontend": {
      entry: ["src/index.ts"],
      project: ["src/**/*.{ts,tsx,vue}"],
    },
  },
};

export default config;
