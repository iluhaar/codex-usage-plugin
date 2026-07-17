# Codex Usage Plugin for OpenCode

OpenCode plugin that exposes a `/codex-usage` TUI command and `<leader>i` shortcut for viewing Codex ChatGPT usage limits and credits. It also keeps a `codex_usage` tool for manual/debug agent use.

## Usage

1. Install the package globally:

   ```sh
   npm install -g @illiadotdev/codex-usage-plugin
   ```

2. Register the plugin in OpenCode:

   ```sh
   codex-usage-plugin --install
   ```

   In an interactive terminal, the installer asks whether to enable the quota guard. It then registers the server plugin in `~/.config/opencode/opencode.jsonc` and the TUI plugin in `~/.config/opencode/tui.json`.
3. Restart OpenCode.
4. Run `/codex-usage` in the OpenCode TUI, or press the leader key then `i` (`ctrl+x` then `i` by default).

For a non-interactive installation with the guard enabled:

```sh
codex-usage-plugin --install --enable-guard --critical-percent 10 --check-interval 5
```

### Local Development Install

To test the current checkout without resolving the published npm package:

```sh
npm run build
node dist/bin/codex-usage-plugin.js --install-local
```

`--install-local` registers absolute paths to this checkout's `dist/index.js` and `dist/tui.js`. It supports the same interactive guard setup and non-interactive options:

```sh
node dist/bin/codex-usage-plugin.js \
  --install-local \
  --enable-guard \
  --critical-percent 10 \
  --check-interval 5
```

The command replaces an existing published registration so the plugin is not loaded twice. Rebuild after source changes and restart OpenCode. The existing uninstall command removes either local or published registrations:

```sh
node dist/bin/codex-usage-plugin.js --uninstall
```

After changing plugin configuration, quit and restart OpenCode.

## Quota Guard

The optional quota guard checks usage before Codex model requests. Successful results are cached for the configured interval, so an active autonomous tool loop refreshes usage periodically without calling the usage endpoint on every step.

When remaining quota reaches the critical percentage, the guard:

- blocks the next Codex model request
- asks OpenCode to create one session continuation summary
- records the goal, progress, changed files, verification, remaining work, and next action
- disables automatic continuation after that summary

The guard checks the first available valid limit in this order: daily, weekly, then monthly. Other windows and missing percentages do not block work. Usage API and auth failures are fail-open.

Example configuration:

```jsonc
{
  "plugin": [
    [
      "@illiadotdev/codex-usage-plugin@latest",
      {
        "guard": {
          "enabled": true,
          "criticalRemainingPercent": 10,
          "checkIntervalMinutes": 5
        }
      }
    ]
  ]
}
```

By default, the guard applies to OpenAI models whose ID or name begins with `GPT-` (case-insensitive). If your model uses another identifier, configure exact IDs with `guard.modelIDs`.

The guard does not interrupt an in-flight response and does not resume automatically after reset. Submit a continuation after quota recovers; the same guard check runs before work resumes. Checkpoint deduplication is maintained while the OpenCode process is running because the current SDK does not expose writable session metadata.

To remove the plugin registration:

```sh
codex-usage-plugin --uninstall
```

To remove the npm package too:

```sh
npm uninstall -g @illiadotdev/codex-usage-plugin
```

To upgrade the installed package:

```sh
codex-usage-plugin --upgrade
codex-usage-plugin --upgrade 0.2.9
```

This checks the resolved npm version first, then runs `npm install -g @illiadotdev/codex-usage-plugin@latest` by default, or installs the version you pass. Installation is skipped when that version is already installed.

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
