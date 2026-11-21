/** @jsxImportSource @opentui/solid */
import { Plugin } from "@opencode/plugin/tui";
import { createSignal, For, Show } from "solid-js";

import { CodexUsageRpc } from "./rpc.js";
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
  theme: Plugin.Context["theme"],
) => {
  if (indicator === "🔴") return theme.text.feedback.error.base;
  if (indicator === "🟡") return theme.text.feedback.warning.base;
  return theme.text.feedback.success.base;
};

function errorMessage(error: unknown, seen = new WeakSet<object>()): string | undefined {
  if (typeof error === "string") return error.trim() || undefined;
  if (!error || typeof error !== "object" || seen.has(error)) return undefined;

  seen.add(error);
  if (error instanceof Error) return error.message || errorMessage(error.cause, seen);

  const value = error as Record<string, unknown>;
  if (typeof value.message === "string" && value.message.trim()) {
    return value.message;
  }

  for (const key of ["error", "cause", "reason", "failure", "data"]) {
    const message = errorMessage(value[key], seen);
    if (message) return message;
  }
  return undefined;
}

export default Plugin.define({
  id: "codex-usage-tui",
  async setup(context) {
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

    const disposeSlot = context.ui.slot({
      append: "app",
      render: () => (
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
              backgroundColor={context.theme.background.raised.base}
              borderColor={context.theme.text.feedback.success.base}
              border={["left", "right"]}
              zIndex={2000}
            >
              <text fg={context.theme.text.base} marginBottom={1}>
                <b>Codex Usage</b>
              </text>
              <text fg={context.theme.text.base} wrapMode="word" width="100%">
                <For each={message.split(/(🔴|🟡|🟢)/u)}>
                  {(part) =>
                    /^(🔴|🟡|🟢)$/u.test(part) ? (
                      <span style={{ fg: indicatorColor(part, context.theme) }}>●</span>
                    ) : (
                      part
                    )
                  }
                </For>
              </text>
            </box>
          )}
        </Show>
      ),
    });

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
        const animated = true;
        const frames =
          settings.usageDialogDesign === "v2"
            ? progressScannerFrames
            : scannerFrames;
        let frame = 0;
        const showLoading = () => {
          context.ui.toast.show({
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

        const fetchUsage = async () => {
          for (let attempt = 0; ; attempt += 1) {
            if (disposed) return;
            try {
              // Retries must be sequential so a successful call is never repeated.
              // eslint-disable-next-line no-await-in-loop
              return await context.client.rpc(CodexUsageRpc).get({});
            } catch (error) {
              // The TUI can become ready before the server registers its RPC.
              if (
                attempt >= 4 ||
                errorMessage(error)?.trim() !== "RPC is unavailable: codex-usage"
              ) {
                throw error;
              }
              // eslint-disable-next-line no-await-in-loop
              await new Promise((resolve) => setTimeout(resolve, 250 * 2 ** attempt));
            }
          }
        };
        const result = (await fetchUsage()) as {
          markdown: string;
          toast: string;
          toastV2: string;
        } | undefined;
        if (disposed || !result) return;
        stopAnimation();
        if (settings.usageDialogDesign === "v1") {
          // Replace the loading toast, then let the themed slot render each status.
          context.ui.toast.show({ message: " ", variant: "success", duration: 1 });
          setCompactMessage(result.toast);
          compactTimeout = setTimeout(() => {
            clearCompactMessage();
          }, 5000);
          compactTimeout.unref();
        } else {
          context.ui.toast.show({
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
        context.ui.toast.show({
          title: "Codex Usage Failed",
          message: errorMessage(error) ?? "An unknown error occurred.",
          variant: "error",
        });
      } finally {
        loading = false;
        stopAnimation();
      }
    };

    context.keymap.layer(() => ({
      mode: "global",
      commands: [
        {
          id: commandName,
          title: "Codex Usage",
          description: "Show Codex usage limits and credits",
          group: "System",
          bind: shortcut,
          palette: true,
          slash: { name: "codex-usage" },
          run: showUsage,
        },
      ],
      bindings: [commandName],
    }));

    return () => {
      disposed = true;
      stopAnimation();
      clearCompactMessage();
      disposeSlot();
    };
  },
});
