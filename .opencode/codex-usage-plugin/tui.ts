import type { TuiPlugin } from "@opencode-ai/plugin/tui";

import { getCodexUsage } from "../codex-usage-core";

async function showCodexUsageToast(api: Parameters<TuiPlugin>[0]) {
  api.ui.toast({
    title: "Codex Usage",
    message: "Fetching usage limits...",
    variant: "info",
    duration: 1_000,
  });

  try {
    const result = await getCodexUsage();
    api.ui.toast({
      title: "Codex Usage",
      message: result.toast,
      variant: "success",
      duration: 10_000,
    });
  } catch (error) {
    api.ui.toast({
      title: "Codex Usage Failed",
      message: error instanceof Error ? error.message : String(error),
      variant: "error",
      duration: 10_000,
    });
  }
}

export default {
  id: "codex-usage-tui",
  tui: (async (api) => {
    const unregister = api.keymap.registerLayer({
      commands: [
        {
          namespace: "codex",
          name: "codex-usage.show",
          title: "Codex Usage",
          desc: "Show Codex usage limits and credits without using the LLM",
          category: "Codex",
          slashName: "codex-usage",
          run: () => showCodexUsageToast(api),
        },
      ],
    });

    api.lifecycle.onDispose(unregister);
  }) satisfies TuiPlugin,
};
