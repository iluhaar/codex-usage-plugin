import { Plugin } from "@opencode-ai/plugin-next";
import type { Info, ToolContext } from "@opencode-ai/plugin-next/promise/tool";

import { getCodexUsage, type CodexUsageCredentials } from "./codex-usage-core.js";

type CredentialValue = Awaited<ReturnType<Plugin.Context["integration"]["connection"]["resolve"]>>;

const INPUT_SCHEMA = {
  type: "object",
  properties: {},
  additionalProperties: false,
} as const;

const OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    toast: { type: "string" },
    toastV2: { type: "string" },
  },
  required: ["markdown", "toast", "toastV2"],
  additionalProperties: false,
} as const;

function stringMetadata(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "string" && value.trim()) return value;
  }
  return undefined;
}

function booleanMetadata(metadata: Record<string, unknown> | undefined, keys: string[]) {
  for (const key of keys) {
    const value = metadata?.[key];
    if (typeof value === "boolean") return value;
  }
  return undefined;
}

function resolveCredentials(value: CredentialValue): CodexUsageCredentials {
  if (!value) {
    throw new Error(
      "OpenAI connection could not be resolved. Please reconnect OpenAI with ChatGPT/Codex OAuth in OpenCode.",
    );
  }

  if (value.type !== "oauth") {
    throw new Error(
      "OpenAI is connected with an API key. ChatGPT/Codex OAuth auth is required to read usage limits.",
    );
  }

  if (!value.access.trim()) {
    throw new Error(
      "OpenAI OAuth connection did not provide an access token. Please reconnect OpenAI in OpenCode.",
    );
  }

  return {
    accessToken: value.access,
    accountId: stringMetadata(value.metadata, [
      "accountId",
      "account_id",
      "chatgpt_account_id",
    ]),
    idToken: stringMetadata(value.metadata, ["idToken", "id_token"]),
    isFedramp: booleanMetadata(value.metadata, [
      "isFedramp",
      "is_fedramp",
      "chatgpt_account_is_fedramp",
    ]),
  };
}

function signalFromContext(context: ToolContext) {
  const candidate = context as ToolContext & {
    signal?: AbortSignal;
    abortSignal?: AbortSignal;
    cancellationSignal?: AbortSignal;
  };
  return candidate.signal ?? candidate.abortSignal ?? candidate.cancellationSignal;
}

function codexUsageTool(ctx: Plugin.Context): Info<typeof INPUT_SCHEMA, typeof OUTPUT_SCHEMA> {
  return {
    name: "codex_usage",
    description:
      "Show Codex ChatGPT usage limits, credits, and token profile from the active OpenAI OAuth connection.",
    input: INPUT_SCHEMA,
    output: OUTPUT_SCHEMA,
    options: { codemode: false },
    async execute(_input, toolContext) {
      const connection = await ctx.integration.connection.active("openai");
      if (!connection) {
        throw new Error(
          "No active OpenAI connection found. Connect OpenAI with ChatGPT/Codex OAuth in OpenCode to read usage limits.",
        );
      }

      if (connection.type !== "credential") {
        throw new Error(
          "OpenAI is connected through environment variables. ChatGPT/Codex OAuth auth is required to read usage limits.",
        );
      }

      const credentials = resolveCredentials(
        await ctx.integration.connection.resolve(connection),
      );
      const usage = await getCodexUsage({
        credentials,
        signal: signalFromContext(toolContext),
      });

      return {
        output: usage,
        content: usage.markdown,
        metadata: {
          toast: usage.toast,
          toastV2: usage.toastV2,
        },
      };
    },
  };
}

const plugin = Plugin.define({
  id: "codex-usage-server-v2",
  async setup(ctx) {
    await ctx.tool.transform((draft) => {
      draft.add(codexUsageTool(ctx));
    });
  },
});

export default plugin;
