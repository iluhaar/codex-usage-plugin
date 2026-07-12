import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { access, mkdir, mkdtemp, readFile, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { fileURLToPath, pathToFileURL } from "node:url";
import { promisify } from "node:util";
import test from "node:test";

const execFileAsync = promisify(execFile);
const repoRoot = fileURLToPath(new URL("..", import.meta.url));
const cliPath = join(repoRoot, "dist", "bin", "codex-usage-plugin.js");
const distCoreUrl = pathToFileURL(join(repoRoot, "dist", "codex-usage-core.js")).href;
const distPluginUrl = pathToFileURL(join(repoRoot, "dist", "index.js")).href;
const distTuiPluginUrl = pathToFileURL(join(repoRoot, "dist", "tui.js")).href;

async function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
}

async function withFakeNpm(testFn) {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-npm-"));
  const argsFile = join(dir, "upgrade-args.txt");
  const cwdFile = join(dir, "upgrade-cwd.txt");
  const npmCmdPath = join(dir, "npm.cmd");

  await writeFile(
    npmCmdPath,
    "@echo off\r\n> \"%UPGRADE_ARGS_FILE%\" echo %*\r\n> \"%UPGRADE_CWD_FILE%\" cd\r\nexit /b 0\r\n",
    "utf8",
  );

  const env = {
    PATH: `${dir};${process.env.PATH ?? ""}`,
    UPGRADE_ARGS_FILE: argsFile,
    UPGRADE_CWD_FILE: cwdFile,
  };

  await testFn({ argsFile, cwdFile, env });
}

await test("uninstall does not create a missing config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.jsonc");

  const result = await runCli(["--uninstall", "--config", configPath]);

  assert.match(result.stdout, /No changes needed:/);
  await assert.rejects(access(configPath), /ENOENT/);
});

await test("install writes the package name and TUI plugin path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.jsonc");
  const tuiConfigPath = join(dir, "tui.json");

  const result = await runCli([
    "--install",
    "--config",
    configPath,
    "--tui-config",
    tuiConfigPath,
  ]);
  const content = await readFile(configPath, "utf8");
  const tuiContent = await readFile(tuiConfigPath, "utf8");

  assert.match(result.stdout, /Updated:/);
  assert.match(content, /"plugin"\s*:\s*\[/);
  assert.match(content, /@illiadotdev\/codex-usage-plugin@latest/);
  assert.doesNotMatch(content, /dist\/index\.js/);
  assert.match(tuiContent, /"plugin"\s*:\s*\[/);
  assert.match(tuiContent, /dist\/tui\.js/);
});

await test("install replaces the old server plugin path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.jsonc");
  const tuiConfigPath = join(dir, "tui.json");
  const oldPath = join(repoRoot, "dist", "index.js").replaceAll("\\", "/");
  await writeFile(configPath, JSON.stringify({ plugin: [oldPath] }), "utf8");

  await runCli([
    "--install",
    "--config",
    configPath,
    "--tui-config",
    tuiConfigPath,
  ]);
  const content = await readFile(configPath, "utf8");

  assert.match(content, /@illiadotdev\/codex-usage-plugin@latest/);
  assert.doesNotMatch(content, /dist\/index\.js/);
});

await test("repeated install leaves an existing config unchanged", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.json");
  const tuiConfigPath = join(dir, "tui.json");
  const initial = `{
  "plugin": [
    "@plannotator/opencode@latest",
    "@illiadotdev/codex-usage-plugin@latest"
  ]
}\n`;
  await writeFile(configPath, initial, "utf8");

  const result = await runCli([
    "--install",
    "--config",
    configPath,
    "--tui-config",
    tuiConfigPath,
  ]);

  assert.equal(await readFile(configPath, "utf8"), initial);
  assert.match(result.stdout, /No changes needed:/);
});

await test("upgrade installs the latest package version outside its package directory", async () => {
  await withFakeNpm(async ({ argsFile, cwdFile, env }) => {
    const result = await runCli(["--upgrade"], env);
    const args = await readFile(argsFile, "utf8");
    const cwd = await readFile(cwdFile, "utf8");

    assert.match(args, /install -g @illiadotdev\/codex-usage-plugin@latest/);
    assert.notEqual(cwd.trim().replaceAll("\\", "/"), repoRoot.replace(/\/$/, ""));
    assert.match(result.stdout, /Installing @illiadotdev\/codex-usage-plugin@latest\.\.\./);
    assert.match(result.stdout, /Upgraded @illiadotdev\/codex-usage-plugin to latest/);
  });
});

await test("upgrade installs the requested package version", async () => {
  await withFakeNpm(async ({ argsFile, env }) => {
    const result = await runCli(["--upgrade", "0.2.9"], env);
    const args = await readFile(argsFile, "utf8");

    assert.match(args, /install -g @illiadotdev\/codex-usage-plugin@0\.2\.9/);
    assert.match(result.stdout, /Installing @illiadotdev\/codex-usage-plugin@0\.2\.9\.\.\./);
    assert.match(result.stdout, /Upgraded @illiadotdev\/codex-usage-plugin to 0\.2\.9/);
  });
});

await test("upgrade cannot be combined with install", async () => {
  await assert.rejects(() => runCli(["--install", "--upgrade"]), /cannot be combined/);
});

await test("usage fetch reads OpenCode auth path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const authHome = join(dir, ".local", "share", "opencode");
  const authPath = join(authHome, "auth.json");
  const originalEnv = {
    OPENCODE_AUTH_PATH: process.env.OPENCODE_AUTH_PATH,
    OPENCODE_CODEX_QUOTA_MODEL: process.env.OPENCODE_CODEX_QUOTA_MODEL,
  };

  await mkdir(authHome, { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({ openai: { access: "token", accountId: "acct-123" } }),
    "utf8",
  );

  process.env.OPENCODE_AUTH_PATH = authPath;
  process.env.OPENCODE_CODEX_QUOTA_MODEL = "gpt-5.5";

  const calls = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, init = {}) => {
    calls.push({ url: String(url), init });

    if (String(url).includes("/codex/responses")) {
      return new Response("data: {\"type\":\"response.completed\"}\n\n", {
        status: 200,
        headers: {
          "content-type": "text/event-stream",
          "x-codex-primary-used-percent": "12",
          "x-codex-secondary-used-percent": "34",
        },
      });
    }

    if (String(url).includes("/profiles/me")) {
      return new Response(JSON.stringify({ stats: { lifetime_tokens: 123 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ models: [{ slug: "gpt-5.5" }] }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const { getCodexUsage } = await import(distCoreUrl);
    const result = await getCodexUsage({ requestTimeoutMs: 100 });

    assert.equal(calls.length, 2);
    assert.match(result.markdown, /Workspace account: acct-123/);
    assert.match(result.markdown, /Source: https:\/\/chatgpt\.com\/codex\/settings\/usage/);
    assert.equal(calls[0].init.headers.Authorization, "Bearer token");
    assert.equal(calls[0].init.headers["ChatGPT-Account-ID"], "acct-123");
    assert.match(calls[1].url, /\/profiles\/me$/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENCODE_AUTH_PATH = originalEnv.OPENCODE_AUTH_PATH;
    process.env.OPENCODE_CODEX_QUOTA_MODEL = originalEnv.OPENCODE_CODEX_QUOTA_MODEL;
  }
});

await test("usage fetch prefers OAuth token when auth file also has API key", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const authHome = join(dir, ".local", "share", "opencode");
  const authPath = join(authHome, "auth.json");
  const originalEnv = {
    OPENCODE_AUTH_PATH: process.env.OPENCODE_AUTH_PATH,
    OPENCODE_CODEX_QUOTA_MODEL: process.env.OPENCODE_CODEX_QUOTA_MODEL,
  };

  await mkdir(authHome, { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({
      OPENAI_API_KEY: "sk-test",
      openai: { access: "token", accountId: "acct-456" },
    }),
    "utf8",
  );

  process.env.OPENCODE_AUTH_PATH = authPath;
  process.env.OPENCODE_CODEX_QUOTA_MODEL = "gpt-5.5";

  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url, _init = {}) => {
    if (String(url).includes("/profiles/me")) {
      return new Response(JSON.stringify({ stats: { lifetime_tokens: 321 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(JSON.stringify({ models: [{ slug: "gpt-5.5" }] }), {
      status: 200,
      headers: {
        "content-type": "application/json",
        "x-codex-primary-used-percent": "10",
        "x-codex-secondary-used-percent": "20",
      },
    });
  };

  try {
    const { getCodexUsage } = await import(distCoreUrl);
    const result = await getCodexUsage({ requestTimeoutMs: 100 });

    assert.match(result.markdown, /Workspace account: acct-456/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENCODE_AUTH_PATH = originalEnv.OPENCODE_AUTH_PATH;
    process.env.OPENCODE_CODEX_QUOTA_MODEL = originalEnv.OPENCODE_CODEX_QUOTA_MODEL;
  }
});

await test("usage fetch times out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const codexHome = join(dir, ".codex");
  const authPath = join(codexHome, "auth.json");
  const originalCodexHome = process.env.CODEX_HOME;

  await mkdir(codexHome, { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({ tokens: { access_token: "token" } }),
    "utf8",
  );
  process.env.CODEX_HOME = codexHome;

  const originalFetch = globalThis.fetch;
  globalThis.fetch = (_url, init = {}) =>
    new Promise((_, reject) => {
      const signal = init.signal;
      const onAbort = () => reject(signal?.reason ?? new Error("aborted"));
      if (signal?.aborted) {
        onAbort();
        return;
      }
      signal?.addEventListener("abort", onAbort, { once: true });
    });

  try {
    const { getCodexUsage } = await import(distCoreUrl);
    await assert.rejects(
      () => getCodexUsage({ requestTimeoutMs: 25 }),
      /Request timed out after 25ms/,
    );
  } finally {
    globalThis.fetch = originalFetch;
    if (originalCodexHome === undefined) delete process.env.CODEX_HOME;
    else process.env.CODEX_HOME = originalCodexHome;
  }
});

await test("server plugin exposes codex_usage tool", async () => {
  const plugin = (await import(distPluginUrl)).default;
  const hooks = await plugin.server({ client: {} });

  assert.equal(typeof hooks.tool.codex_usage.execute, "function");
});

await test("tui plugin registers leader+i shortcut", async () => {
  const plugin = (await import(distTuiPluginUrl)).default;
  let registeredLayer;
  let disposeRegistered = false;

  await plugin.tui({
    keymap: {
      registerLayer: (layer) => {
        registeredLayer = layer;
        return () => {};
      },
    },
    lifecycle: {
      onDispose: () => {
        disposeRegistered = true;
        return () => {};
      },
    },
    ui: {
      toast: () => {},
    },
  });

  assert.ok(registeredLayer);
  assert.equal(registeredLayer.commands[0].name, "codex-usage.show");
  assert.equal(registeredLayer.commands[0].namespace, "palette");
  assert.equal(registeredLayer.commands[0].slashName, "codex-usage");
  assert.equal(registeredLayer.bindings[0].key, "<leader>i");
  assert.equal(registeredLayer.bindings[0].cmd, "codex-usage.show");
  assert.equal(disposeRegistered, true);
});

await test("tui slash command animates the native toast without chat output", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const authHome = join(dir, ".local", "share", "opencode");
  const authPath = join(authHome, "auth.json");
  const originalEnv = {
    OPENCODE_AUTH_PATH: process.env.OPENCODE_AUTH_PATH,
  };

  await mkdir(authHome, { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({ openai: { access: "token", accountId: "acct-789" } }),
    "utf8",
  );

  process.env.OPENCODE_AUTH_PATH = authPath;

  const toasts = [];
  let registeredCommands = [];
  const originalFetch = globalThis.fetch;
  globalThis.fetch = async (url) => {
    if (String(url).includes("/profiles/me")) {
      return new Response(JSON.stringify({ stats: { lifetime_tokens: 999 } }), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }

    return new Response(
      JSON.stringify({
        rate_limit: {
          primary_window: {
            used_percent: 25,
            limit_window_seconds: 18_000,
          },
        },
      }),
      {
        status: 200,
        headers: { "content-type": "application/json" },
      },
    );
  };

  try {
    const plugin = (await import(distTuiPluginUrl)).default;
    await plugin.tui({
      command: {
        register: (cb) => {
          registeredCommands = cb();
          return () => {};
        },
      },
      ui: {
        toast: (body) => {
          toasts.push(body);
        },
      },
    });

    const command = registeredCommands.find(
      (entry) => entry.slash?.name === "codex-usage",
    );

    assert.ok(command);
    assert.equal(command.keybind, "<leader>i");
    await assert.doesNotReject(() => command.onSelect());

    assert.equal(toasts[0].title, "Fetching Codex Usage");
    assert.match(toasts[0].message, /^[🟦🔹]{8}$/u);
    assert.match(toasts.at(-1).message, /5h: .+75% left/);
  } finally {
    globalThis.fetch = originalFetch;
    process.env.OPENCODE_AUTH_PATH = originalEnv.OPENCODE_AUTH_PATH;
  }
});

await test("tui usage command ignores concurrent invocations", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const authPath = join(dir, "auth.json");
  const originalAuthPath = process.env.OPENCODE_AUTH_PATH;
  const originalFetch = globalThis.fetch;
  let resolveFetch;
  let markFetchStarted;
  const fetchStarted = new Promise((resolve) => {
    markFetchStarted = resolve;
  });
  let fetchCount = 0;
  let registeredCommands = [];
  const toasts = [];
  let first;

  await writeFile(
    authPath,
    JSON.stringify({ openai: { access: "token", accountId: "acct-789" } }),
    "utf8",
  );
  process.env.OPENCODE_AUTH_PATH = authPath;
  globalThis.fetch = async (url) => {
    fetchCount += 1;
    if (String(url).includes("/profiles/me")) {
      return new Response(JSON.stringify({}), {
        status: 200,
        headers: { "content-type": "application/json" },
      });
    }
    markFetchStarted();
    await new Promise((resolve) => {
      resolveFetch = resolve;
    });
    return new Response(JSON.stringify({ rate_limit: {} }), {
      status: 200,
      headers: { "content-type": "application/json" },
    });
  };

  try {
    const plugin = (await import(distTuiPluginUrl)).default;
    await plugin.tui({
      command: {
        register: (cb) => {
          registeredCommands = cb();
          return () => {};
        },
      },
      ui: {
        toast: (body) => {
          toasts.push(body);
        },
      },
    });

    const command = registeredCommands.find(
      (entry) => entry.slash?.name === "codex-usage",
    );
    first = command.onSelect();
    const second = command.onSelect();

    await fetchStarted;
    assert.equal(fetchCount, 1);
    assert.equal(toasts[0].title, "Fetching Codex Usage");
    assert.match(toasts[0].message, /^[🟦🔹]{8}$/u);
    await second;
    resolveFetch();
    await first;
  } finally {
    resolveFetch?.();
    await first?.catch(() => {});
    globalThis.fetch = originalFetch;
    if (originalAuthPath === undefined) delete process.env.OPENCODE_AUTH_PATH;
    else process.env.OPENCODE_AUTH_PATH = originalAuthPath;
  }
});
