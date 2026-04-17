import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    handler: "src/handler.ts",
  },
  outDir: "dist",
  format: ["cjs"],
  target: "node20",
  bundle: true,
  platform: "node",
  sourcemap: true,
  clean: true,
  dts: false,
  noExternal: [/.*/],
  external: ["@aws-sdk/client-secrets-manager"],
  outExtension: () => ({ js: ".js" }),
});
