import { defineConfig } from "tsup";

export default defineConfig({
  clean: true,
  dts: false,
  entry: {
    bin: "src/bin.ts",
    index: "src/index.ts",
  },
  external: ["@paramfinder/engine"],
  format: ["esm"],
  outDir: "dist",
  sourcemap: true,
  splitting: false,
  target: "esnext",
  tsconfig: "tsconfig.build.json",
});
