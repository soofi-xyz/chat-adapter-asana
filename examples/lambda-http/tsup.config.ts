import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    handler: "src/handler.ts",
  },
  outDir: "dist",
  format: ["esm"],
  target: "node24",
  bundle: true,
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: [/.*/],
  external: ["@aws-sdk/client-secrets-manager"],
  // Lambda Node.js 24 runtime auto-detects *.mjs files as ESM, so we can
  // use top-level await in the handler without shipping a package.json shim.
  outExtension: () => ({ js: ".mjs" }),
});
