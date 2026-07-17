import type { Hooks, PluginInput, PluginOptions } from "@opencode-ai/plugin";

import {
  fetchCodexUsageSnapshot,
  type NormalizedQuotaWindow,
  selectGuardWindow,
} from "./codex-usage-core.js";

type GuardOptions = {
  enabled: boolean;
  checkIntervalMs: number;
  criticalRemainingPercent: number;
  modelIDs?: Set<string>;
};

type BlockedSession = {
  phase: "blocked" | "checkpointing" | "checkpointed";
  providerID: string;
  modelID: string;
  window: NormalizedQuotaWindow;
};

const internalAgents = new Set(["title", "summary", "compaction"]);

function finiteOption(value: unknown, fallback: number, label: string) {
  if (value === undefined) return fallback;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) {
    throw new Error(`codex-usage guard ${label} must be a positive number`);
  }
  return value;
}

export function parseGuardOptions(options?: PluginOptions): GuardOptions {
  const raw = options?.guard;
  if (!raw || typeof raw !== "object") {
    return {
      enabled: false,
      checkIntervalMs: 5 * 60_000,
      criticalRemainingPercent: 10,
    };
  }

  const guard = raw as Record<string, unknown>;
  const criticalRemainingPercent = finiteOption(
    guard.criticalRemainingPercent,
    10,
    "criticalRemainingPercent",
  );
  if (criticalRemainingPercent >= 100) {
    throw new Error(
      "codex-usage guard criticalRemainingPercent must be less than 100",
    );
  }

  const checkIntervalMinutes = finiteOption(
    guard.checkIntervalMinutes,
    5,
    "checkIntervalMinutes",
  );
  const modelIDs = guard.modelIDs;
  if (
    modelIDs !== undefined &&
    (!Array.isArray(modelIDs) || modelIDs.some((value) => typeof value !== "string"))
  ) {
    throw new Error("codex-usage guard modelIDs must be an array of strings");
  }

  return {
    enabled: guard.enabled === true,
    checkIntervalMs: checkIntervalMinutes * 60_000,
    criticalRemainingPercent,
    modelIDs: modelIDs ? new Set(modelIDs as string[]) : undefined,
  };
}

function isEligibleModel(
  options: GuardOptions,
  providerID: string,
  modelID: string,
  modelName: string,
) {
  if (providerID !== "openai") return false;
  if (options.modelIDs) return options.modelIDs.has(modelID);
  return /^gpt-/i.test(modelID) || /^gpt-/i.test(modelName);
}

function resetDescription(resetAt: number | undefined) {
  if (!resetAt) return "at an unknown time";
  return `at ${new Date(resetAt * 1000).toLocaleString()}`;
}

function guardError(window: NormalizedQuotaWindow) {
  return new Error(
    `Codex quota guard paused work: ${window.name} has ${window.remainingPercent?.toFixed(0)}% remaining and resets ${resetDescription(window.resetAt)}. A continuation checkpoint will be created in this session.`,
  );
}

export function createQuotaGuard(
  input: Pick<PluginInput, "client" | "directory">,
  options: GuardOptions,
): Hooks {
  if (!options.enabled) return {};

  const blocked = new Map<string, BlockedSession>();
  const bypass = new Set<string>();
  let disposed = false;
  let cached:
    | { fetchedAt: number; window: NormalizedQuotaWindow | undefined }
    | undefined;
  let refresh: Promise<NormalizedQuotaWindow | undefined> | undefined;

  const selectedWindow = async () => {
    const now = Date.now();
    if (cached && now - cached.fetchedAt < options.checkIntervalMs) {
      return cached.window;
    }
    if (refresh) return refresh;

    refresh = fetchCodexUsageSnapshot({ includeProfile: false })
      .then((snapshot) => {
        const window = selectGuardWindow(snapshot.windows);
        cached = { fetchedAt: snapshot.fetchedAt, window };
        return window;
      })
      .catch(() => undefined)
      .finally(() => {
        refresh = undefined;
      });
    return refresh;
  };

  const checkpoint = async (sessionID: string) => {
    const state = blocked.get(sessionID);
    if (!state || state.phase !== "blocked" || disposed) return;

    state.phase = "checkpointing";
    bypass.add(sessionID);
    try {
      const result = await input.client.session.summarize({
        path: { id: sessionID },
        query: { directory: input.directory },
        body: {
          providerID: state.providerID,
          modelID: state.modelID,
        },
      });
      if (result.error) {
        throw new Error(JSON.stringify(result.error));
      }
      state.phase = "checkpointed";
    } catch (error) {
      state.phase = "blocked";
      console.error(
        `Codex quota guard could not create a checkpoint for ${sessionID}:`,
        error,
      );
    } finally {
      bypass.delete(sessionID);
    }
  };

  return {
    "chat.params": async (hookInput) => {
      if (
        disposed ||
        bypass.has(hookInput.sessionID) ||
        internalAgents.has(hookInput.agent) ||
        !isEligibleModel(
          options,
          hookInput.model.providerID,
          hookInput.model.id,
          hookInput.model.name,
        )
      ) {
        return;
      }

      const window = await selectedWindow();
      if (
        !window ||
        window.remainingPercent === undefined ||
        window.remainingPercent > options.criticalRemainingPercent
      ) {
        blocked.delete(hookInput.sessionID);
        return;
      }

      const current = blocked.get(hookInput.sessionID);
      if (!current) {
        blocked.set(hookInput.sessionID, {
          phase: "blocked",
          providerID: hookInput.model.providerID,
          modelID: hookInput.model.id,
          window,
        });
      }
      throw guardError(window);
    },
    event: async ({ event }) => {
      if (event.type === "session.idle") {
        await checkpoint(event.properties.sessionID);
      }
      if (event.type === "session.error" && event.properties.sessionID) {
        await checkpoint(event.properties.sessionID);
      }
      if (event.type === "session.deleted") {
        blocked.delete(event.properties.info.id);
        bypass.delete(event.properties.info.id);
      }
    },
    "experimental.session.compacting": async ({ sessionID }, output) => {
      const state = blocked.get(sessionID);
      if (!state || state.phase !== "checkpointing") return;
      output.context.push(
        `Work was paused by the Codex quota guard because ${state.window.name} had ${state.window.remainingPercent?.toFixed(0)}% remaining. Preserve the user's goal, completed work, changed files, verification results, remaining tasks, blockers, and the exact next action. The quota resets ${resetDescription(state.window.resetAt)}. Do not continue work after producing this summary.`,
      );
    },
    "experimental.compaction.autocontinue": async ({ sessionID }, output) => {
      if (blocked.has(sessionID)) output.enabled = false;
    },
    dispose: async () => {
      disposed = true;
      blocked.clear();
      bypass.clear();
      cached = undefined;
    },
  };
}
