import type * as NextOpenCodeTui from "@opencode-ai/plugin-next/tui";

const plugin = {
  id: "codex-usage-tui-v2",
  async setup() {
    // Native v2 TUI behavior is intentionally implemented in ILL-7.
  },
} satisfies NextOpenCodeTui.Plugin.Definition;

export default plugin;
