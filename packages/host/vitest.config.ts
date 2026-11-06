import { fileURLToPath } from "node:url";

import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Tests run against workspace sources, so they do not require a prior
      // build of the sibling packages.
      "@questbridge/protocol": fileURLToPath(
        new URL("../protocol/src/index.ts", import.meta.url),
      ),
      "@questbridge/mock-publisher/scenarios": fileURLToPath(
        new URL("../mock-publisher/src/scenarios.ts", import.meta.url),
      ),
      "@questbridge/mock-publisher/client": fileURLToPath(
        new URL("../mock-publisher/src/client.ts", import.meta.url),
      ),
      "@questbridge/mock-publisher": fileURLToPath(
        new URL("../mock-publisher/src/index.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["tests/**/*.test.ts"],
  },
});
