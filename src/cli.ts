import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { scannerFrames, scannerIntervalMs } from "./scanner-animation.js";

const execFileAsync = promisify(execFile);
const packageName = "@illiadotdev/codex-usage-plugin";
const pluginPackage = `${packageName}@latest`;

const helpText = () =>
  [
    "Usage: codex-usage-plugin [options]",
    "",
    "Options:",
    "  -h, --help                  Show this help message",
    "  --install                   Add plugins to global OpenCode/TUI configs",
    "  --uninstall                 Remove plugins from global OpenCode/TUI configs",
    "  --upgrade [version]         Upgrade the installed package version (defaults to latest)",
    "  --config <path>             Server OpenCode config path",
    "  --tui-config <path>         TUI config path",
    "",
    "Examples:",
    "  codex-usage-plugin --install",
    "  codex-usage-plugin --uninstall",
    "  codex-usage-plugin --upgrade",
    "  codex-usage-plugin --upgrade 0.2.9",
  ].join("\n");

function moduleDistDir() {
  const moduleDir = dirname(fileURLToPath(import.meta.url));
  return moduleDir.endsWith(`${join("dist", "bin")}`)
    ? resolve(moduleDir, "..")
    : moduleDir;
}

function pluginPath(name: "index" | "server" | "tui") {
  return normalizePath(join(moduleDistDir(), `${name}.js`));
}

function repoRootFromDist() {
  return normalizePath(resolve(moduleDistDir(), ".."));
}

function normalizePath(value: string) {
  return resolve(value).replaceAll("\\", "/");
}

function defaultOpencodeConfigPath() {
  return join(homedir(), ".config", "opencode", "opencode.jsonc");
}

function defaultTuiConfigPath() {
  return join(homedir(), ".config", "opencode", "tui.json");
}

async function withScanner<T>(message: string, operation: () => Promise<T>) {
  if (!process.stdout.isTTY) {
    process.stdout.write(`${message}...\n`);
    return operation();
  }

  let frame = 0;
  process.stdout.write(`${scannerFrames[frame]} ${message}`);
  const animation = setInterval(() => {
    frame = (frame + 1) % scannerFrames.length;
    process.stdout.write(`\r${scannerFrames[frame]} ${message}`);
  }, scannerIntervalMs);

  try {
    return await operation();
  } finally {
    clearInterval(animation);
    process.stdout.write("\r\x1b[2K");
  }
}

function parseCliOptions(argv: string[]): CliOptions {
  const options: CliOptions = {
    help: false,
    install: false,
    uninstall: false,
    upgrade: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--install") {
      options.install = true;
      continue;
    }
    if (arg === "--uninstall") {
      options.uninstall = true;
      continue;
    }
    if (arg === "--upgrade") {
      options.upgrade = true;
      const value = argv[index + 1];
      if (value && !value.startsWith("--")) {
        options.upgradeVersion = value;
        index += 1;
      }
      continue;
    }
    if (arg === "--config" || arg === "--tui-config") {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value`);
      if (arg === "--config") options.opencodeConfigPath = resolve(value);
      else options.tuiConfigPath = resolve(value);
      index += 1;
      continue;
    }
    if (arg.startsWith("--config=")) {
      options.opencodeConfigPath = resolve(arg.slice("--config=".length));
      continue;
    }
    if (arg.startsWith("--tui-config=")) {
      options.tuiConfigPath = resolve(arg.slice("--tui-config=".length));
      continue;
    }
    if (arg.startsWith("--upgrade=")) {
      options.upgrade = true;
      options.upgradeVersion = arg.slice("--upgrade=".length) || undefined;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  if (options.install && options.uninstall)
    throw new Error("--install and --uninstall cannot be combined");
  if (options.upgrade && (options.install || options.uninstall))
    throw new Error("--upgrade cannot be combined with --install or --uninstall");
  return options;
}

async function upgradeInstalledPackage(version?: string) {
  const target = version ? `${packageName}@${version}` : `${packageName}@latest`;

  await withScanner(`Installing ${target}`, async () => {
    await execFileAsync("npm", ["install", "-g", target], {
      // npm cannot replace the installed package on Windows while cwd is inside it.
      cwd: homedir(),
      shell: true,
    });
  });

  process.stdout.write(`Upgraded ${packageName} to ${version ?? "latest"}\n`);
}

function findMatchingBracket(text: string, openIndex: number) {
  let depth = 0;
  let inString = false;
  let escaped = false;

  for (let index = openIndex; index < text.length; index += 1) {
    const char = text[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") depth += 1;
    if (char === "]") {
      depth -= 1;
      if (depth === 0) return index;
    }
  }

  return -1;
}

function splitTopLevelArrayItems(content: string) {
  const items: string[] = [];
  let squareDepth = 0;
  let curlyDepth = 0;
  let inString = false;
  let escaped = false;
  let start = 0;

  for (let index = 0; index < content.length; index += 1) {
    const char = content[index];
    if (inString) {
      if (escaped) {
        escaped = false;
        continue;
      }
      if (char === "\\") {
        escaped = true;
        continue;
      }
      if (char === '"') inString = false;
      continue;
    }
    if (char === '"') {
      inString = true;
      continue;
    }
    if (char === "[") squareDepth += 1;
    if (char === "]") squareDepth = Math.max(0, squareDepth - 1);
    if (char === "{") curlyDepth += 1;
    if (char === "}") curlyDepth = Math.max(0, curlyDepth - 1);
    if (char === "," && squareDepth === 0 && curlyDepth === 0) {
      const item = content.slice(start, index).trim();
      if (item) items.push(item);
      start = index + 1;
    }
  }

  const tail = content.slice(start).trim();
  if (tail) items.push(tail);
  return items;
}

function parseStringLiteral(item: string) {
  try {
    const parsed = JSON.parse(item) as unknown;
    return typeof parsed === "string" ? normalizePath(parsed) : undefined;
  } catch {
    return undefined;
  }
}

function rebuildPluginArray(content: string, nextItems: string[]) {
  const pluginMatch = /"plugin"\s*:\s*\[/m.exec(content);
  if (!pluginMatch || pluginMatch.index === undefined) return undefined;

  const openIndex = content.indexOf("[", pluginMatch.index);
  if (openIndex < 0) return undefined;

  const closeIndex = findMatchingBracket(content, openIndex);
  if (closeIndex < 0) return undefined;

  const lineStart = content.lastIndexOf("\n", pluginMatch.index) + 1;
  const baseIndent =
    content.slice(lineStart, pluginMatch.index).match(/^\s*/)?.[0] ?? "";
  const itemIndent = `${baseIndent}  `;
  const inside = nextItems.length
    ? `\n${nextItems.map((item) => `${itemIndent}${item}`).join(",\n")}\n${baseIndent}`
    : `\n${baseIndent}`;

  return `${content.slice(0, openIndex + 1)}${inside}${content.slice(closeIndex)}`;
}

function pluginArrayItems(content: string) {
  const pluginMatch = /"plugin"\s*:\s*\[/m.exec(content);
  if (!pluginMatch || pluginMatch.index === undefined) return undefined;
  const openIndex = content.indexOf("[", pluginMatch.index);
  if (openIndex < 0) return undefined;
  const closeIndex = findMatchingBracket(content, openIndex);
  if (closeIndex < 0) return undefined;
  return splitTopLevelArrayItems(content.slice(openIndex + 1, closeIndex));
}

function addPluginProperty(content: string, pluginLiteral: string) {
  const firstBrace = content.indexOf("{");
  if (firstBrace < 0) return undefined;
  return `${content.slice(0, firstBrace + 1)}\n  "plugin": [\n    ${pluginLiteral}\n  ],${content.slice(firstBrace + 1)}`;
}

function updateConfigContent(
  content: string,
  target: ConfigTarget,
  action: "install" | "uninstall",
) {
  const pluginLiteral = JSON.stringify(target.pluginPath);
  const normalizedPluginPath = normalizePath(target.pluginPath);
  const stale = new Set(target.stalePluginPaths.map(normalizePath));
  const items = pluginArrayItems(content);

  if (!items) {
    if (action === "uninstall") return content;
    return (
      addPluginProperty(content, pluginLiteral) ?? freshConfig(target, action)
    );
  }

  const parsedItems = items.map(parseStringLiteral);
  if (
    action === "install" &&
    parsedItems.includes(normalizedPluginPath) &&
    !parsedItems.some((parsed) => parsed !== undefined && stale.has(parsed))
  ) {
    return content;
  }

  const nextItems = items.filter((item) => {
    const parsed = parseStringLiteral(item);
    return parsed !== normalizedPluginPath && (parsed ? !stale.has(parsed) : true);
  });

  if (action === "install") nextItems.push(pluginLiteral);
  return rebuildPluginArray(content, nextItems) ?? content;
}

function freshConfig(target: ConfigTarget, action: "install" | "uninstall") {
  const pluginItems =
    action === "install"
      ? `\n    ${JSON.stringify(target.pluginPath)}\n  `
      : "";
  return `{
  "$schema": ${JSON.stringify(target.schema)},
  "plugin": [${pluginItems}]
}
`;
}

async function readConfig(path: string) {
  try {
    return await readFile(path, "utf8");
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    )
      return undefined;
    throw error;
  }
}

async function writeConfig(
  target: ConfigTarget,
  action: "install" | "uninstall",
) {
  const current = await readConfig(target.path);
  if (current === undefined) {
    if (action === "uninstall") {
      return `No changes needed: ${target.path}`;
    }

    const next = freshConfig(target, action);
    await mkdir(dirname(target.path), { recursive: true });
    await writeFile(target.path, next, "utf8");
    return `Updated: ${target.path}`;
  }

  const next = updateConfigContent(current, target, action);

  if (next === current) {
    return `No changes needed: ${target.path}`;
  }

  await mkdir(dirname(target.path), { recursive: true });
  await writeFile(target.path, next, "utf8");
  return `${action === "install" ? "Updated" : "Removed from"}: ${target.path}`;
}

async function cleanupConfigIfExists(target: ConfigTarget) {
  const current = await readConfig(target.path);
  if (current === undefined) return;

  const next = updateConfigContent(current, target, "uninstall");
  if (next === current) {
    process.stdout.write(`No changes needed: ${target.path}\n`);
    return;
  }

  await writeFile(target.path, next, "utf8");
  process.stdout.write(`Removed old registration from: ${target.path}\n`);
}

function serverConfigTargets(options: CliOptions): ConfigTarget[] {
  const root = repoRootFromDist();
  return [
    {
      path: options.opencodeConfigPath ?? defaultOpencodeConfigPath(),
      pluginPath: pluginPackage,
      schema: "https://opencode.ai/config.json",
      stalePluginPaths: [
        pluginPath("index"),
        `${root}/dist/server.js`,
        `${root}/src/index.ts`,
        `${root}/src/server.ts`,
        `${root}/.opencode/codex-usage-plugin/server.ts`,
        `${root}/.opencode/codex-usage-plugin`,
      ],
    },
  ];
}

function tuiCleanupTarget(options: CliOptions): ConfigTarget {
  const root = repoRootFromDist();
  return {
    path: options.tuiConfigPath ?? defaultTuiConfigPath(),
    pluginPath: pluginPath("tui"),
    schema: "https://opencode.ai/tui.json",
    stalePluginPaths: [
      `${root}/src/tui.ts`,
      `${root}/.opencode/codex-usage-plugin/tui.ts`,
      `${root}/.opencode/codex-usage-plugin`,
    ],
  };
}

function tuiConfigTargets(options: CliOptions): ConfigTarget[] {
  return [tuiCleanupTarget(options)];
}

export async function runCli(argv = process.argv.slice(2)) {
  const options = parseCliOptions(argv);
  if (options.help || (!options.install && !options.uninstall && !options.upgrade)) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (options.upgrade) {
    await upgradeInstalledPackage(options.upgradeVersion);
    return;
  }

  const action = options.install ? "install" : "uninstall";
  const messages = await withScanner(
    `${options.install ? "Installing" : "Uninstalling"} ${packageName}`,
    () =>
      Promise.all([
        ...serverConfigTargets(options).map((target) => writeConfig(target, action)),
        ...tuiConfigTargets(options).map((target) => writeConfig(target, action)),
      ]),
  );
  process.stdout.write(`${messages.join("\n")}\n`);
}

export async function runCliSafely(argv = process.argv.slice(2)) {
  try {
    await runCli(argv);
  } catch (error) {
    const message = error instanceof Error ? error.message : String(error);
    process.stderr.write(`${message}\n`);
    process.exitCode = 1;
  }
}
