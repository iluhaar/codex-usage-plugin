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

   This builds `dist/` and registers the generated plugin path in `~/.config/opencode/opencode.jsonc`.
3. Restart OpenCode.
4. Run `/codex-usage` in the OpenCode TUI, or press the leader key then `i` (`ctrl+x` then `i` by default).

The installer asks which usage dialog design to use. The compact `v1` design remains the default. To change it later, run:

```sh
codex-usage-plugin --settings
```

For non-interactive use, pass `--settings=v1` or `--settings=v2`.

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
