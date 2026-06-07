# Codex Usage Plugin for OpenCode

OpenCode plugin that exposes a `/codex-usage` TUI command for viewing Codex ChatGPT usage limits and credits. It also keeps a `codex_usage` tool for manual/debug agent use.

## Usage

1. Make sure OpenCode is connected to your ChatGPT Plus/Pro plan.
2. Install the plugin into global OpenCode config:

   ```sh
   npm run install-plugin
   ```

   This builds `dist/` and registers the generated plugin path in `~/.config/opencode/opencode.jsonc`.
3. Restart OpenCode so it loads `dist/index.js`.
4. Run `/codex-usage` in the OpenCode TUI.

To remove the global registration:

```sh
npm run uninstall-plugin
```

The `/codex-usage` slash command is registered and handled by the plugin through OpenCode's server plugin hooks. It shows an OpenCode toast.

## What It Reads

The plugin reads auth from:

- `OPENCODE_AUTH_PATH`, when set
- `~/.local/share/opencode/auth.json`
- `~/Library/Application Support/opencode/auth.json` on macOS
- `~/.opencode/auth.json`
- `%LOCALAPPDATA%\\OpenCode\\auth.json` as a fallback
- `$CODEX_HOME/auth.json`, when `CODEX_HOME` is set
- `~/.codex/auth.json`, otherwise

It calls the same ChatGPT backend usage surfaces Codex uses:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/profiles/me`

## Limitations

Plugin supports file-backed OpenCode/Codex auth only. If your client stores tokens in the OS keyring, the plugin will report that `auth.json` is unavailable. Keyring support can be added later.

The plugin never prints access tokens, refresh tokens, or ID tokens.
