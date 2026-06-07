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

async function runCli(args, env = {}) {
  return execFileAsync(process.execPath, [cliPath, ...args], {
    cwd: repoRoot,
    env: { ...process.env, ...env },
  });
}

await test("uninstall does not create a missing config", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.jsonc");

  const result = await runCli(["--uninstall", "--config", configPath]);

  assert.match(result.stdout, /No changes needed:/);
  await assert.rejects(access(configPath), /ENOENT/);
});

await test("install writes the plugin path", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const configPath = join(dir, "opencode.jsonc");

  const result = await runCli(["--install", "--config", configPath]);
  const content = await readFile(configPath, "utf8");

  assert.match(result.stdout, /Updated:/);
  assert.match(content, /"plugin"\s*:\s*\[/);
  assert.match(content, /dist\/index\.js/);
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

await test("usage fetch times out", async () => {
  const dir = await mkdtemp(join(tmpdir(), "codex-usage-plugin-"));
  const codexHome = join(dir, ".codex");
  const authPath = join(codexHome, "auth.json");

  await mkdir(codexHome, { recursive: true });
  await writeFile(
    authPath,
    JSON.stringify({ tokens: { access_token: "token" } }),
    "utf8",
  );

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
  }
});
