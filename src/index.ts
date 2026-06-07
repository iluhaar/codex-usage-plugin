import { type Plugin, tool } from "@opencode-ai/plugin";

import { getCodexUsage } from "./codex-usage-core.js";

export default {
  id: "codex-usage-server",
  server: (async ({ client }) => {
    async function showCodexUsageToast() {
      await client.tui.showToast({
        body: {
          title: "Codex Usage",
          message: "Fetching usage limits...",
          variant: "info",
          duration: 1_000,
        },
      });

      const result = await getCodexUsage();
      await client.tui.showToast({
        body: {
          title: "Codex Usage",
          message: result.toast,
          variant: "success",
          duration: 10_000,
        },
      });
    }

    return {
      config: async (config) => {
        config.command ??= {};
        config.command["codex-usage"] = {
          description: "Show Codex usage limits and credits",
          template: "",
        };
      },
      "command.execute.before": async (input) => {
        if (input.command !== "codex-usage" && input.command !== "/codex-usage")
          return;
        try {
          await showCodexUsageToast();
        } catch (error) {
          await client.tui.showToast({
            body: {
              title: "Codex Usage Failed",
              message: error instanceof Error ? error.message : String(error),
              variant: "error",
              duration: 10_000,
            },
          });
          throw error;
        }
        throw new Error("codex-usage:handled");
      },
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
