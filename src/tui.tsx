/** @jsxImportSource @opentui/solid */
import type { TuiPluginModule, TuiThemeCurrent } from "@opencode-ai/plugin/tui";
import { createSignal, For, Show } from "solid-js";

import { getCodexUsage } from "./codex-usage-core.js";
import {
  progressScannerFrames,
  scannerFrames,
  scannerIntervalMs,
} from "./scanner-animation.js";
import { readSettings } from "./settings.js";

const commandName = "codex-usage.show";
const shortcut = "<leader>i";

const indicatorColor = (
  indicator: string,
  theme: TuiThemeCurrent,
) => {
  if (indicator === "🔴") return theme.error;
  if (indicator === "🟡") return theme.warning;
  return theme.success;
};

export default {
  id: "codex-usage-tui",
  tui: async (api) => {
    let loading = false;
    let disposed = false;
    let animation: ReturnType<typeof setInterval> | undefined;
    let compactTimeout: ReturnType<typeof setTimeout> | undefined;
    const [compactMessage, setCompactMessage] = createSignal<string>();
    const clearCompactMessage = () => {
      if (compactTimeout) clearTimeout(compactTimeout);
      compactTimeout = undefined;
      setCompactMessage(undefined);
    };

    if (api.slots && api.theme) {
      api.slots.register({
        slots: {
          app({ theme }) {
            return (
              <Show when={compactMessage()} keyed>
                {(message) => (
                  <box
                    position="absolute"
                    top={2}
                    right={2}
                    maxWidth={60}
                    paddingLeft={2}
                    paddingRight={2}
                    paddingTop={1}
                    paddingBottom={1}
                    backgroundColor={theme.current.backgroundPanel}
                    borderColor={theme.current.success}
                    border={["left", "right"]}
                    zIndex={2000}
                  >
                    <text fg={theme.current.text} marginBottom={1}>
                      <b>Codex Usage</b>
                    </text>
                    <text fg={theme.current.text} wrapMode="word" width="100%">
                      <For each={message.split(/(🔴|🟡|🟢)/u)}>
                        {(part) =>
                          /^(🔴|🟡|🟢)$/u.test(part) ? (
                            <span style={{ fg: indicatorColor(part, theme.current) }}>●</span>
                          ) : (
                            part
                          )
                        }
                      </For>
                    </text>
                  </box>
                )}
              </Show>
            );
          },
        },
      });
      api.lifecycle?.onDispose(clearCompactMessage);
    }

    const stopAnimation = () => {
      if (!animation) return;
      clearInterval(animation);
      animation = undefined;
    };

    const showUsage = async () => {
      if (loading || disposed) return;
      loading = true;
      clearCompactMessage();

      try {
        const settings = await readSettings();
        const animated = api.kv?.get("animations_enabled", true) ?? true;
        const frames =
          settings.usageDialogDesign === "v2"
            ? progressScannerFrames
            : scannerFrames;
        let frame = 0;
        const showLoading = () => {
          api.ui.toast({
            title: "Fetching Codex Usage",
            message: animated
              ? frames[frame]
              : settings.usageDialogDesign === "v2"
                ? "[░░░░░░░░░░░░░░░░░░░░]"
                : "[⋯]",
            variant: "info",
            duration: 1000,
          });
          frame = (frame + 1) % frames.length;
        };

        showLoading();
        if (animated) animation = setInterval(showLoading, scannerIntervalMs);

        const result = await getCodexUsage();
        if (disposed) return;
        stopAnimation();
        if (settings.usageDialogDesign === "v1" && api.slots && api.theme) {
          // Replace the loading toast, then let the themed slot render each status.
          api.ui.toast({ message: " ", variant: "success", duration: 1 });
          setCompactMessage(result.toast);
          compactTimeout = setTimeout(() => {
            clearCompactMessage();
          }, 5000);
          compactTimeout.unref();
        } else {
          api.ui.toast({
            title:
              settings.usageDialogDesign === "v2"
                ? "Codex Usage Status"
                : "Codex Usage",
            message:
              settings.usageDialogDesign === "v2" ? result.toastV2 : result.toast,
            variant: "success",
          });
        }
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
