import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

import { getCodexUsage } from "./codex-usage-core.js";

export default {
  id: "codex-usage-tui",
  tui: async (api) => {
    api.command?.register(() => [
      {
        title: "Codex Usage",
        value: "codex-usage.show",
        description: "Show Codex usage limits and credits",
        slash: {
          name: "codex-usage",
        },
        onSelect: async () => {
          api.ui.toast({
            title: "Codex Usage",
            message: "Fetching usage limits...",
            variant: "info",
          });

          try {
            const result = await getCodexUsage();
            api.ui.toast({
              title: "Codex Usage",
              message: result.toast,
              variant: "success",
            });
          } catch (error) {
            api.ui.toast({
              title: "Codex Usage Failed",
              message: error instanceof Error ? error.message : String(error),
              variant: "error",
            });
          }
        },
      },
    ]);
  },
} satisfies TuiPluginModule;
