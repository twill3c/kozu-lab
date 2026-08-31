import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";

export default defineConfig({
  resolve: {
    alias: { "@": fileURLToPath(new URL("./src", import.meta.url)) },
  },
  test: {
    include: ["tests/**/*.test.ts"],
    environment: "node",
    // z 正規化はランダム格子 1,000 枚を回す(SPEC §5.1)ので既定の 5 秒では足りない
    testTimeout: 120_000,
  },
});
