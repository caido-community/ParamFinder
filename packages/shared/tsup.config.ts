import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: ["src/index.ts"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "esnext",
  tsconfig: "tsconfig.build.json",
});
