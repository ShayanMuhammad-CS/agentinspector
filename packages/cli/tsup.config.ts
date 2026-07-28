import { defineConfig } from "tsup";

export default defineConfig([
  {
    entry: { cli: "src/cli.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    clean: true,
    banner: { js: "#!/usr/bin/env node" },
    external: ["next", "open", "commander", "@kashifmuhammad/agent-inspector-core"],
  },
  {
    entry: { bus: "src/bus.ts" },
    format: ["esm"],
    platform: "node",
    target: "node18",
    clean: false,
    external: ["@kashifmuhammad/agent-inspector-core"],
  },
]);

