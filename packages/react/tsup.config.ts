import { defineConfig } from "tsup";

export default defineConfig({
  entry: ["src/index.ts"],
  format: ["esm"],
  dts: true,
  clean: true,
  external: ["react", "react-dom", "@agent-inspector/core", "zustand"],
  esbuildOptions(options) {
    options.banner = {
      js: '"use client";',
    };
  },
});
