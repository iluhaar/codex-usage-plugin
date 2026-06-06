import { type Plugin, tool } from "@opencode-ai/plugin";

import { getCodexUsage } from "../codex-usage-core";

export default {
  id: "codex-usage-server",
  server: (async () => {
    return {
      tool: {
        codex_usage: tool({
          description:
            "Show Codex ChatGPT usage limits, credits, and token profile from the local Codex CLI login.",
          args: {},
          async execute() {
            return (await getCodexUsage()).markdown;
          },
        }),
      },
    };
  }) satisfies Plugin,
};
