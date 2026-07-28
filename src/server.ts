import type { Plugin as StableV2Plugin } from "@opencode-ai/plugin/v2/promise";
import type * as NextOpenCodePlugin from "@opencode-ai/plugin-next";

type NextV2Plugin = NextOpenCodePlugin.Plugin.Plugin;

const plugin = {
  id: "codex-usage-server-v2",
  async setup() {
    // Native v2 server behavior is intentionally implemented in ILL-5.
  },
} satisfies StableV2Plugin & NextV2Plugin;

export default plugin;
