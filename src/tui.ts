import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

import { getCodexUsage } from "./codex-usage-core.js";

const commandName = "codex-usage.show";
const shortcut = "<leader>i";

export default {
  id: "codex-usage-tui",
  tui: async (api) => {
    const showUsage = async () => {
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
    };

    const keymap = "keymap" in api ? api.keymap : undefined;
    if (keymap?.registerLayer) {
      const dispose = keymap.registerLayer({
        commands: [
          {
            name: commandName,
            namespace: "palette",
            title: "Codex Usage",
            desc: "Show Codex usage limits and credits",
            category: "System",
            slashName: "codex-usage",
            run: showUsage,
          },
        ],
        bindings: [
          {
            key: shortcut,
            cmd: commandName,
          },
        ],
      });
      api.lifecycle?.onDispose(dispose);
      return;
    }

    api.command?.register(() => [
      {
        title: "Codex Usage",
        value: commandName,
        description: "Show Codex usage limits and credits",
        keybind: shortcut,
        slash: {
          name: "codex-usage",
        },
        onSelect: showUsage,
      },
    ]);
  },
} satisfies TuiPluginModule;
