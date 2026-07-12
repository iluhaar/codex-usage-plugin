import type { TuiPluginModule } from "@opencode-ai/plugin/tui";

import { getCodexUsage } from "./codex-usage-core.js";
import { scannerFrames, scannerIntervalMs } from "./scanner-animation.js";

const commandName = "codex-usage.show";
const shortcut = "<leader>i";

export default {
  id: "codex-usage-tui",
  tui: async (api) => {
    let loading = false;
    let disposed = false;
    let animation: ReturnType<typeof setInterval> | undefined;

    const stopAnimation = () => {
      if (!animation) return;
      clearInterval(animation);
      animation = undefined;
    };

    const showUsage = async () => {
      if (loading || disposed) return;
      loading = true;

      const animated = api.kv?.get("animations_enabled", true) ?? true;
      let frame = 0;
      const showLoading = () => {
        api.ui.toast({
          title: "Fetching Codex Usage",
          message: `${animated ? scannerFrames[frame] : "[⋯]"}`,
          variant: "info",
          duration: 1000,
        });
        frame = (frame + 1) % scannerFrames.length;
      };

      showLoading();
      if (animated) animation = setInterval(showLoading, scannerIntervalMs);

      try {
        const result = await getCodexUsage();
        if (disposed) return;
        stopAnimation();
        api.ui.toast({
          title: "Codex Usage",
          message: result.toast,
          variant: "success",
        });
      } catch (error) {
        if (disposed) return;
        stopAnimation();
        api.ui.toast({
          title: "Codex Usage Failed",
          message: error instanceof Error ? error.message : String(error),
          variant: "error",
        });
      } finally {
        loading = false;
        stopAnimation();
      }
    };

    api.lifecycle?.onDispose(() => {
      disposed = true;
      stopAnimation();
    });

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

    const dispose = api.command?.register(() => [
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
    if (dispose) api.lifecycle?.onDispose(dispose);
  },
} satisfies TuiPluginModule;
