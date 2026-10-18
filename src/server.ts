import { Plugin } from "@opencode/plugin";
import type { Info } from "@opencode/plugin/promise/tool";

import { getCodexUsage, type CodexUsageCredentials } from "./codex-usage-core.js";
import { CODEX_USAGE_OUTPUT_SCHEMA, CodexUsageRpc } from "./rpc.js";

type CredentialValue = Awaited<ReturnType<Plugin.Context["integration"]["connection"]["resolve"]>>;

const INPUT_SCHEMA = {
  type: "object",
  properties: {},
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

async function loadCodexUsage(ctx: Plugin.Context, signal?: AbortSignal) {
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
  return getCodexUsage({ credentials, signal });
}

function codexUsageTool(
  ctx: Plugin.Context,
): Info<typeof INPUT_SCHEMA, typeof CODEX_USAGE_OUTPUT_SCHEMA> {
  return {
    name: "codex_usage",
    description:
      "Show Codex ChatGPT usage limits, credits, and token profile from the active OpenAI OAuth connection.",
    input: INPUT_SCHEMA,
    output: CODEX_USAGE_OUTPUT_SCHEMA,
    options: { codemode: false },
    async execute(_input, toolContext) {
      const usage = await loadCodexUsage(ctx, toolContext.signal);

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
  id: "codex-usage",
  async setup(ctx) {
    await ctx.rpc.register(CodexUsageRpc, {
      get: (_input, rpcContext) => loadCodexUsage(ctx, rpcContext.signal),
    });
    await ctx.tool.transform((draft) => {
      draft.add(codexUsageTool(ctx));
    });
  },
});

export default plugin;
