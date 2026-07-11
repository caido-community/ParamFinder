import type { RawConfigurationOrFn } from "knip/dist/types/config.js";

const config: RawConfigurationOrFn = {
  ignoreExportsUsedInFile: true,
  rules: {
    exports: "off",
    types: "off",
  },
  workspaces: {
    ".": {
      entry: ["caido.config.ts"],
    },
    "packages/backend": {
      project: ["src/**/*.ts"],
      ignoreDependencies: ["caido"],
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
