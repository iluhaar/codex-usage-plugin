import { mkdir, readFile, writeFile } from "node:fs/promises";
import { homedir } from "node:os";
import { dirname, join, resolve } from "node:path";

export type UsageDialogDesign = "v1" | "v2";

type PluginSettings = {
  usageDialogDesign: UsageDialogDesign;
};

export function defaultSettingsPath() {
  const fromEnv = process.env.CODEX_USAGE_SETTINGS_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), ".config", "opencode", "codex-usage-plugin.json");
}

export async function readSettings(path = defaultSettingsPath()): Promise<PluginSettings> {
  try {
    const parsed = JSON.parse(await readFile(path, "utf8")) as {
      usageDialogDesign?: unknown;
    };
    return {
      usageDialogDesign: parsed.usageDialogDesign === "v2" ? "v2" : "v1",
    };
  } catch (error) {
    if (
      typeof error === "object" &&
      error &&
      "code" in error &&
      error.code === "ENOENT"
    ) {
      return { usageDialogDesign: "v1" };
    }
    throw error;
  }
}

export async function writeSettings(
  usageDialogDesign: UsageDialogDesign,
  path = defaultSettingsPath(),
) {
  await mkdir(dirname(path), { recursive: true });
  await writeFile(path, `${JSON.stringify({ usageDialogDesign }, null, 2)}\n`, "utf8");
}
