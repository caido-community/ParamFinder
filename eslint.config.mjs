import { defaultConfig } from "@caido/eslint-config";

/** @type {import('eslint').Linter.Config } */
export default [
  ...defaultConfig(),
  {
    ignores: [
      "dist/**",
      "packages/*/dist/**",
      "packages/*/node_modules/**",
    ],
  },
  {
    files: ["packages/**/*.{ts,vue}"],
    rules: {
      "@typescript-eslint/no-empty-object-type": "off",
      "@typescript-eslint/no-explicit-any": "off",
      "@typescript-eslint/no-restricted-types": "off",
      "@typescript-eslint/require-await": "off",
      "@typescript-eslint/strict-boolean-expressions": "off",
      "@typescript-eslint/switch-exhaustiveness-check": "off",
      "compat/compat": "off",
    },
  },
]
