import { mkdir, readFile, writeFile } from "node:fs/promises";
import { execFile } from "node:child_process";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { createInterface } from "node:readline/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

import { scannerIntervalMs, terminalScannerFrames } from "./scanner-animation.js";

const execFileAsync = promisify(execFile);
const packageName = "@illiadotdev/codex-usage-plugin";
const pluginPackage = `${packageName}@latest`;

const helpText = () =>
  [
    "Usage: codex-usage-plugin [options]",
    "",
    "Options:",
    "  -h, --help                  Show this help message",
    "  --version                  Show the installed package version",
    "  --install                   Add plugins to global OpenCode/TUI configs",
    "  --install-local             Register this package's local dist plugins",
    "  --uninstall                 Remove plugins from global OpenCode/TUI configs",
    "  --upgrade [version]         Upgrade the installed package version (defaults to latest)",
    "  --enable-guard              Enable the Codex quota guard during installation",
    "  --critical-percent <value>  Remaining quota that triggers a checkpoint (default: 10)",
    "  --check-interval <minutes>  Usage cache interval (default: 5)",
    "  --config <path>             Server OpenCode config path",
    "  --tui-config <path>         TUI config path",
    "",
    "Examples:",
    "  codex-usage-plugin --install",
    "  codex-usage-plugin --install-local",
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
  process.stdout.write(`${terminalScannerFrames[frame]} ${message}`);
  const animation = setInterval(() => {
    frame = (frame + 1) % terminalScannerFrames.length;
    process.stdout.write(`\r${terminalScannerFrames[frame]} ${message}`);
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
    version: false,
    install: false,
    installLocal: false,
    uninstall: false,
    upgrade: false,
  };

  for (let index = 0; index < argv.length; index += 1) {
    const arg = argv[index];
    if (arg === "-h" || arg === "--help") {
      options.help = true;
      continue;
    }
    if (arg === "--version") {
      options.version = true;
      continue;
    }
    if (arg === "--install") {
      options.install = true;
      continue;
    }
    if (arg === "--install-local") {
      options.installLocal = true;
      continue;
    }
    if (arg === "--enable-guard") {
      options.guardEnabled = true;
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
    if (
      arg === "--config" ||
      arg === "--tui-config" ||
      arg === "--critical-percent" ||
      arg === "--check-interval"
    ) {
      const value = argv[index + 1];
      if (!value || value.startsWith("--"))
        throw new Error(`${arg} requires a value`);
      if (arg === "--config") options.opencodeConfigPath = resolve(value);
      else if (arg === "--tui-config") options.tuiConfigPath = resolve(value);
      else if (arg === "--critical-percent") {
        options.criticalRemainingPercent = parsePositiveNumber(value, arg, 100);
        options.guardEnabled = true;
      } else {
        options.checkIntervalMinutes = parsePositiveNumber(value, arg);
        options.guardEnabled = true;
      }
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
    if (arg.startsWith("--critical-percent=")) {
      options.criticalRemainingPercent = parsePositiveNumber(
        arg.slice("--critical-percent=".length),
        "--critical-percent",
        100,
      );
      options.guardEnabled = true;
      continue;
    }
    if (arg.startsWith("--check-interval=")) {
      options.checkIntervalMinutes = parsePositiveNumber(
        arg.slice("--check-interval=".length),
        "--check-interval",
      );
      options.guardEnabled = true;
      continue;
    }
    if (arg.startsWith("--upgrade=")) {
      options.upgrade = true;
      options.upgradeVersion = arg.slice("--upgrade=".length) || undefined;
      continue;
    }
    throw new Error(`unknown option: ${arg}`);
  }

  if (options.install && options.installLocal)
    throw new Error("--install and --install-local cannot be combined");
  if ((options.install || options.installLocal) && options.uninstall)
    throw new Error("install and uninstall options cannot be combined");
  if (options.upgrade && (options.install || options.installLocal || options.uninstall))
    throw new Error("--upgrade cannot be combined with install or uninstall options");
  return options;
}

function parsePositiveNumber(value: string, option: string, upperBound?: number) {
  const parsed = Number(value);
  if (
    !Number.isFinite(parsed) ||
    parsed <= 0 ||
    (upperBound !== undefined && parsed >= upperBound)
  ) {
    throw new Error(
      `${option} must be greater than 0${upperBound ? ` and less than ${upperBound}` : ""}`,
    );
  }
  return parsed;
}

async function configureGuardInteractively(options: CliOptions) {
  if (
    (!options.install && !options.installLocal) ||
    options.guardEnabled !== undefined ||
    !process.stdin.isTTY ||
    !process.stdout.isTTY
  ) {
    return;
  }

  const prompt = createInterface({ input: process.stdin, output: process.stdout });
  try {
    const enabled = await prompt.question("Enable the Codex quota guard? [y/N] ");
    if (!/^y(?:es)?$/i.test(enabled.trim())) return;

    options.guardEnabled = true;
    const critical = await prompt.question("Critical remaining percentage [10]: ");
    const interval = await prompt.question("Usage check interval in minutes [5]: ");
    options.criticalRemainingPercent = critical.trim()
      ? parsePositiveNumber(critical.trim(), "critical percentage", 100)
      : 10;
    options.checkIntervalMinutes = interval.trim()
      ? parsePositiveNumber(interval.trim(), "check interval")
      : 5;
  } finally {
    prompt.close();
  }
}

async function installedPackageVersion() {
  const packageJson = JSON.parse(
    await readFile(join(repoRootFromDist(), "package.json"), "utf8"),
  ) as { version?: unknown };
  if (typeof packageJson.version !== "string") {
    throw new Error(`Could not determine the installed ${packageName} version`);
  }
  return packageJson.version;
}

async function upgradeInstalledPackage(version?: string) {
  const target = version ? `${packageName}@${version}` : `${packageName}@latest`;
  const currentVersion = await installedPackageVersion();

  const { stdout } = await execFileAsync(
    "npm",
    ["view", target, "version", "--json"],
    {
      cwd: homedir(),
      shell: true,
    },
  );
  const resolved = JSON.parse(stdout) as unknown;
  const targetVersion = Array.isArray(resolved) ? resolved.at(-1) : resolved;
  if (typeof targetVersion !== "string") {
    throw new Error(`Could not resolve the target ${packageName} version`);
  }

  if (currentVersion === targetVersion) {
    process.stdout.write(`${packageName} is already up to date (${targetVersion})\n`);
    return;
  }

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

function skipJsoncTrivia(item: string, start: number) {
  let index = start;
  while (index < item.length) {
    if (/\s/.test(item[index])) {
      index += 1;
      continue;
    }
    if (item.startsWith("//", index)) {
      const lineEnd = item.indexOf("\n", index + 2);
      index = lineEnd < 0 ? item.length : lineEnd + 1;
      continue;
    }
    if (item.startsWith("/*", index)) {
      const commentEnd = item.indexOf("*/", index + 2);
      if (commentEnd < 0) return item.length;
      index = commentEnd + 2;
      continue;
    }
    break;
  }
  return index;
}

function parseJsonStringAt(item: string, start: number) {
  if (item[start] !== '"') return undefined;
  let escaped = false;
  for (let index = start + 1; index < item.length; index += 1) {
    const char = item[index];
    if (escaped) {
      escaped = false;
      continue;
    }
    if (char === "\\") {
      escaped = true;
      continue;
    }
    if (char === '"') {
      try {
        const parsed = JSON.parse(item.slice(start, index + 1)) as unknown;
        return typeof parsed === "string" ? parsed : undefined;
      } catch {
        return undefined;
      }
    }
  }
  return undefined;
}

function parsePluginSpecifier(item: string) {
  const start = skipJsoncTrivia(item, 0);
  if (item[start] === '"') return parseJsonStringAt(item, start);
  if (item[start] === "[") {
    return parseJsonStringAt(item, skipJsoncTrivia(item, start + 1));
  }
  try {
    const parsed = JSON.parse(item) as unknown;
    if (typeof parsed === "string") return parsed;
    if (Array.isArray(parsed) && typeof parsed[0] === "string") return parsed[0];
    return undefined;
  } catch {
    return undefined;
  }
}

function matchesTarget(specifier: string | undefined, target: ConfigTarget) {
  if (!specifier) return false;
  if (target.packageName) {
    return (
      specifier === target.packageName ||
      specifier.startsWith(`${target.packageName}@`)
    );
  }
  return normalizePath(specifier) === normalizePath(target.pluginPath);
}

function isStaleSpecifier(
  specifier: string | undefined,
  target: ConfigTarget,
  stalePaths: Set<string>,
) {
  if (!specifier) return false;
  if (stalePaths.has(normalizePath(specifier))) return true;
  return (target.stalePackageNames ?? []).some(
    (name) => specifier === name || specifier.startsWith(`${name}@`),
  );
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
  const pluginLiteral = target.pluginLiteral ?? JSON.stringify(target.pluginPath);
  const stale = new Set(target.stalePluginPaths.map(normalizePath));
  const items = pluginArrayItems(content);

  if (!items) {
    if (action === "uninstall") return content;
    return (
      addPluginProperty(content, pluginLiteral) ?? freshConfig(target, action)
    );
  }

  const parsedItems = items.map(parsePluginSpecifier);
  if (
    action === "install" &&
    parsedItems.some(
      (parsed, index) =>
        matchesTarget(parsed, target) &&
        (!target.pluginLiteral || items[index].trim() === target.pluginLiteral),
    ) &&
    !parsedItems.some(
      (parsed) => isStaleSpecifier(parsed, target, stale),
    )
  ) {
    return content;
  }

  const nextItems = items.filter((item) => {
    const parsed = parsePluginSpecifier(item);
    return (
      !matchesTarget(parsed, target) &&
      !isStaleSpecifier(parsed, target, stale)
    );
  });

  if (action === "install") nextItems.push(pluginLiteral);
  return rebuildPluginArray(content, nextItems) ?? content;
}

function freshConfig(target: ConfigTarget, action: "install" | "uninstall") {
  const pluginItems =
    action === "install"
      ? `\n    ${target.pluginLiteral ?? JSON.stringify(target.pluginPath)}\n  `
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

function serverConfigTargets(options: CliOptions): ConfigTarget[] {
  const root = repoRootFromDist();
  const localPluginPath = pluginPath("index");
  const targetPlugin = options.installLocal ? localPluginPath : pluginPackage;
  const pluginLiteral = options.guardEnabled
    ? JSON.stringify([
        targetPlugin,
        {
          guard: {
            enabled: true,
            checkIntervalMinutes: options.checkIntervalMinutes ?? 5,
            criticalRemainingPercent: options.criticalRemainingPercent ?? 10,
          },
        },
      ])
    : undefined;
  return [
    {
      path: options.opencodeConfigPath ?? defaultOpencodeConfigPath(),
      pluginPath: targetPlugin,
      packageName: options.installLocal ? undefined : packageName,
      pluginLiteral,
      schema: "https://opencode.ai/config.json",
      stalePluginPaths: [
        ...(options.installLocal ? [] : [localPluginPath]),
        `${root}/dist/server.js`,
        `${root}/src/index.ts`,
        `${root}/src/server.ts`,
        `${root}/.opencode/codex-usage-plugin/server.ts`,
        `${root}/.opencode/codex-usage-plugin`,
      ],
      stalePackageNames: options.installLocal ? [packageName] : undefined,
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
  if (options.version) {
    process.stdout.write(`${await installedPackageVersion()}\n`);
    return;
  }

  if (
    options.help ||
    (!options.install &&
      !options.installLocal &&
      !options.uninstall &&
      !options.upgrade)
  ) {
    process.stdout.write(`${helpText()}\n`);
    return;
  }

  if (options.upgrade) {
    await upgradeInstalledPackage(options.upgradeVersion);
    return;
  }

  await configureGuardInteractively(options);

  const action = options.install || options.installLocal ? "install" : "uninstall";
  const messages = await withScanner(
    `${action === "install" ? "Installing" : "Uninstalling"} ${packageName}`,
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
