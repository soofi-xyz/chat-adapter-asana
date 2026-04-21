import { defineConfig } from "tsup";

export default defineConfig({
  entry: {
    "provider-handler": "src/provider-handler.ts",
  },
  outDir: "dist/provider",
  format: ["cjs"],
  target: "node24",
  bundle: true,
  platform: "node",
  sourcemap: false,
  dts: false,
  clean: false,
  noExternal: [/.*/],
  external: ["@aws-sdk/client-secrets-manager"],
  outExtension: () => ({ js: ".js" }),
});
