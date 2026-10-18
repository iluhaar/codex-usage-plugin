import { Rpc } from "@opencode/plugin/rpc";

export const CODEX_USAGE_OUTPUT_SCHEMA = {
  type: "object",
  properties: {
    markdown: { type: "string" },
    toast: { type: "string" },
    toastV2: { type: "string" },
  },
  required: ["markdown", "toast", "toastV2"],
  additionalProperties: false,
} as const;

export const CodexUsageRpc = Rpc.define({
  id: "codex-usage",
  methods: {
    get: {
      input: {
        type: "object",
        properties: {},
        additionalProperties: false,
      },
      output: CODEX_USAGE_OUTPUT_SCHEMA,
    },
  },
  events: {},
} as const);
