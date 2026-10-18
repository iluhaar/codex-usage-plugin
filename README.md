# Codex Usage Plugin for OpenCode

OpenCode V2 plugin that exposes a `/codex-usage` CLI command and `<leader>i` shortcut for viewing Codex ChatGPT usage limits and credits. It also provides a `codex_usage` server tool for manual/debug agent use.

## Usage

1. Install the package globally:

   ```sh
   npm install -g @illiadotdev/codex-usage-plugin
   ```

2. Register the plugin in OpenCode:

   ```sh
   codex-usage-plugin --install
   ```

   This creates a small discovery wrapper under `~/.config/opencode/plugins/codex-usage/`. OpenCode loads its V2 server and CLI entrypoints from the installed package.
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

## Authentication

The server tool and `/codex-usage` command use the active OpenAI ChatGPT/Codex OAuth connection from OpenCode V2. OpenCode manages the connection and token refresh. API-key and environment-variable connections cannot provide ChatGPT usage limits.

It calls the same ChatGPT backend usage surfaces Codex uses:

- `https://chatgpt.com/backend-api/wham/usage`
- `https://chatgpt.com/backend-api/wham/profiles/me`

## Limitations

An active OpenCode OAuth connection is required. If the connection is missing or expired, reconnect OpenAI with ChatGPT/Codex OAuth in OpenCode.

The plugin never prints access tokens, refresh tokens, or ID tokens.
