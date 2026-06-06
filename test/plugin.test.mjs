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
