# Codex Usage Plugin for OpenCode

Local OpenCode plugin that exposes a zero-token `/codex-usage` TUI command for viewing Codex ChatGPT usage limits and credits. It also keeps a `codex_usage` tool for manual/debug agent use.

## Usage

1. Make sure Codex CLI is logged in with ChatGPT auth.
2. Restart OpenCode from this project so it loads `.opencode/plugins/codex-usage.ts`.
3. Run `/codex-usage` in the OpenCode TUI.

The `/codex-usage` slash command is registered by the TUI plugin through `.opencode/tui.json` and shows an OpenCode toast directly. It does not send a prompt to the LLM and does not spend model tokens.

## What It Reads

The plugin reads Codex CLI auth from:

- `$CODEX_HOME/auth.json`, when `CODEX_HOME` is set
- `~/.codex/auth.json`, otherwise

It calls the same ChatGPT backend usage surfaces Codex uses:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/profiles/me`

## Limitations

This MVP supports file-backed Codex auth only. If your Codex CLI stores tokens in the OS keyring, the plugin will report that `auth.json` is unavailable. Keyring support can be added later.

The plugin never prints access tokens, refresh tokens, or ID tokens.
