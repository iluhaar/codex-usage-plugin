import { existsSync } from "node:fs";
import { readFile } from "node:fs/promises";
import { homedir } from "node:os";
import { join, resolve } from "node:path";

const CHATGPT_BACKEND_URL = "https://chatgpt.com/backend-api";
const USAGE_URL = `${CHATGPT_BACKEND_URL}/wham/usage`;
const PROFILE_URL = `${CHATGPT_BACKEND_URL}/wham/profiles/me`;
const CHATGPT_USAGE_URL = "https://chatgpt.com/codex/settings/usage";

function codexHome() {
  const fromEnv = process.env.CODEX_HOME?.trim();
  if (fromEnv) return resolve(fromEnv);
  return join(homedir(), ".codex");
}

function openCodeAuthPath() {
  const fromEnv = process.env.OPENCODE_AUTH_PATH?.trim();
  if (fromEnv) return resolve(fromEnv);

  if (process.platform === "darwin") {
    return join(homedir(), "Library", "Application Support", "opencode", "auth.json");
  }

  const xdgDataHome = process.env.XDG_DATA_HOME?.trim() || join(homedir(), ".local", "share");
  return join(xdgDataHome, "opencode", "auth.json");
}

function codexAuthPath() {
  return join(codexHome(), "auth.json");
}

function normalizeAuthFile(raw: unknown): CodexAuthFile | undefined {
  if (!raw || typeof raw !== "object") return undefined;

  const parsed = raw as Record<string, unknown>;
  const tokens = parsed.tokens as Record<string, unknown> | undefined;
  const accessToken = stringValue(tokens?.access_token);
  if (accessToken) {
    return {
      auth_mode: stringValue(parsed.auth_mode),
      OPENAI_API_KEY:
        typeof parsed.OPENAI_API_KEY === "string" ? parsed.OPENAI_API_KEY : undefined,
      tokens: {
        id_token: tokens?.id_token as string | IdTokenInfo | undefined,
        access_token: accessToken,
        refresh_token: stringValue(tokens?.refresh_token),
        account_id: stringValue(tokens?.account_id),
      },
    };
  }

  const openai = parsed.openai as Record<string, unknown> | undefined;
  const openaiAccess = stringValue(openai?.access);
  if (openaiAccess) {
    return {
      tokens: {
        access_token: openaiAccess,
        account_id: stringValue(openai?.accountId),
      },
    };
  }

  return undefined;
}

async function readAuthFile(authPath: string) {
  if (!existsSync(authPath)) return undefined;

  const raw = await readFile(authPath, "utf8");
  const parsed = JSON.parse(raw) as unknown;
  const auth = normalizeAuthFile(parsed);
  if (
    !auth?.tokens?.access_token &&
    parsed &&
    typeof parsed === "object" &&
    typeof (parsed as { OPENAI_API_KEY?: unknown }).OPENAI_API_KEY === "string" &&
    stringValue((parsed as { OPENAI_API_KEY?: unknown }).OPENAI_API_KEY)
  ) {
    throw new Error(
      "Codex is configured with an API key. ChatGPT/Codex OAuth auth is required to read usage limits.",
    );
  }

  if (!auth?.tokens?.access_token) {
    throw new Error(`Auth file at ${authPath} does not contain ChatGPT OAuth tokens.`);
  }

  return auth;
}

async function readAuth() {
  const authPaths = [
    openCodeAuthPath(),
    join(homedir(), ".local", "share", "opencode", "auth.json"),
    join(homedir(), ".opencode", "auth.json"),
    join(process.env.LOCALAPPDATA?.trim() || join(homedir(), "AppData", "Local"), "OpenCode", "auth.json"),
    codexAuthPath(),
  ];
  let lastError: Error | undefined;

  for (const authPath of authPaths) {
    try {
      const auth = await readAuthFile(authPath);
      if (auth) return auth;
    } catch (error) {
      lastError = error instanceof Error ? error : new Error(String(error));
    }
  }

  if (lastError) throw lastError;
  throw new Error(`Auth file not found at ${authPaths.join(" or ")}.`);
}

function decodeIdToken(auth: CodexAuthFile): IdTokenInfo {
  const idToken = auth.tokens?.id_token;
  if (!idToken) return {};
  if (typeof idToken === "object") return idToken;

  const [, payload] = idToken.split(".");
  if (!payload) return { raw_jwt: idToken };

  try {
    const normalized = payload.replaceAll("-", "+").replaceAll("_", "/");
    const padded = normalized.padEnd(Math.ceil(normalized.length / 4) * 4, "=");
    const claims = JSON.parse(
      Buffer.from(padded, "base64").toString("utf8"),
    ) as Record<string, unknown>;
    const profile = claims["https://api.openai.com/profile"] as
      | Record<string, unknown>
      | undefined;
    const authClaims = claims["https://api.openai.com/auth"] as
      | Record<string, unknown>
      | undefined;
    return {
      email: stringValue(claims.email) ?? stringValue(profile?.email),
      chatgpt_plan_type: stringValue(authClaims?.chatgpt_plan_type),
      chatgpt_user_id:
        stringValue(authClaims?.chatgpt_user_id) ??
        stringValue(authClaims?.user_id),
      chatgpt_account_id: stringValue(authClaims?.chatgpt_account_id),
      chatgpt_account_is_fedramp:
        authClaims?.chatgpt_account_is_fedramp === true,
      raw_jwt: idToken,
    };
  } catch {
    return { raw_jwt: idToken };
  }
}

function stringValue(value: unknown) {
  return typeof value === "string" && value.trim() ? value : undefined;
}

function planDisplay(plan: unknown) {
  const raw =
    typeof plan === "string"
      ? plan
      : typeof plan === "object" && plan
        ? stringValue((plan as { value?: unknown }).value)
        : undefined;
  if (!raw) return undefined;
  return raw
    .split(/[_-]/g)
    .filter(Boolean)
    .map((part) => part[0]?.toUpperCase() + part.slice(1))
    .join(" ");
}

async function fetchJson<T>(
  url: string,
  auth: CodexAuthFile,
  idToken: IdTokenInfo,
  timeoutMs = 10_000,
): Promise<T> {
  const controller = new AbortController();
  const timeoutId =
    timeoutMs > 0
      ? setTimeout(
          () => controller.abort(new Error(`Request timed out after ${timeoutMs}ms`)),
          timeoutMs,
        )
      : undefined;

  const headers: Record<string, string> = {
    Authorization: `Bearer ${auth.tokens?.access_token ?? ""}`,
    "User-Agent": "codex-usage-opencode-plugin",
  };
  const accountId = auth.tokens?.account_id ?? idToken.chatgpt_account_id;
  if (accountId) headers["ChatGPT-Account-ID"] = accountId;
  if (idToken.chatgpt_account_is_fedramp) headers["X-OpenAI-Fedramp"] = "true";

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    if (!response.ok) {
      const body = await response.text().catch(() => "");
      const safeBody = body
        .slice(0, 500)
        .replace(
          /[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}\.[A-Za-z0-9_-]{24,}/g,
          "<redacted-jwt>",
        );
      throw new Error(
        `${url} failed with HTTP ${response.status}${safeBody ? `: ${safeBody}` : ""}`,
      );
    }
    return (await response.json()) as T;
  } finally {
    if (timeoutId) clearTimeout(timeoutId);
  }
}

function renderUsage(
  auth: CodexAuthFile,
  idToken: IdTokenInfo,
  usage: UsagePayload,
  profile?: TokenUsageProfile,
) {
  const lines: string[] = [];
  const email = idToken.email;
  const plan =
    planDisplay(idToken.chatgpt_plan_type) ?? planDisplay(usage.plan_type);

  lines.push("# Codex Usage", "");
  if (email || plan)
    lines.push(
      `Account: ${[email, plan ? `(${plan})` : undefined].filter(Boolean).join(" ")}`,
    );
  lines.push(`Source: ${CHATGPT_USAGE_URL}`, "");

  const limitLines = renderLimitRows(usage);
  lines.push("## Limits");
  lines.push(
    ...(limitLines.length
      ? limitLines
      : ["No displayable limit data returned for this account."]),
  );

  const creditLines = renderCredits(usage);
  if (creditLines.length) lines.push("", "## Credits", ...creditLines);

  const profileLines = renderProfile(profile);
  if (profileLines.length)
    lines.push("", "## Token Usage Profile", ...profileLines);

  const accountId = auth.tokens?.account_id ?? idToken.chatgpt_account_id;
  if (accountId) lines.push("", `Workspace account: ${accountId}`);

  return lines.join("\n");
}

function renderToastMessage(usage: UsagePayload) {
  const parts: string[] = [];
  parts.push(...renderToastWindows(undefined, usage.rate_limit ?? undefined));
  parts.push(
    ...(usage.additional_rate_limits ?? []).flatMap((additional) =>
      renderToastWindows(
        additional.limit_name ?? additional.metered_feature ?? "Additional",
        additional.rate_limit ?? undefined,
      ),
    ),
  );
  parts.push(...renderCredits(usage).map((row) => row.replace(/^- /, "")));

  const individual = usage.spend_control?.individual_limit;
  if (individual) {
    const remaining = clamp(numberValue(individual.remaining_percent), 0, 100);
    parts.push(`Monthly credits: ${remaining.toFixed(0)}% left`);
  }

  return parts.length
    ? parts.slice(0, 5).join(" | ")
    : "No displayable limit data returned for this account.";
}

function renderLimitRows(usage: UsagePayload) {
  const rows: string[] = [];
  rows.push(...renderWindowRows(undefined, usage.rate_limit ?? undefined));
  for (const additional of usage.additional_rate_limits ?? []) {
    const label =
      additional.limit_name ?? additional.metered_feature ?? "Additional";
    rows.push(...renderWindowRows(label, additional.rate_limit ?? undefined));
  }

  const individual = usage.spend_control?.individual_limit;
  if (individual) {
    const remaining = clamp(numberValue(individual.remaining_percent), 0, 100);
    const detail = formatCreditUsage(individual.used, individual.limit);
    rows.push(
      `- Monthly credit limit: ${statusIndicator(remaining)} ${progress(remaining)} ${remaining.toFixed(0)}% left${resetSuffix(individual.reset_at)}${detail ? ` (${detail})` : ""}`,
    );
  }

  return rows;
}

function renderWindowRows(
  prefix: string | undefined,
  details: RateLimitDetails | undefined,
) {
  const rows: string[] = [];
  for (const entry of [
    { window: details?.primary_window, secondary: false },
    { window: details?.secondary_window, secondary: true },
  ]) {
    if (!entry.window) continue;
    const label = limitLabel(
      entry.window.limit_window_seconds,
      entry.secondary,
    );
    const fullLabel = prefix ? `${prefix} ${label}` : label;
    const used = clamp(numberValue(entry.window.used_percent), 0, 100);
    const remaining = 100 - used;
    rows.push(
      `- ${fullLabel}: ${statusIndicator(remaining)} ${progress(remaining)} ${remaining.toFixed(0)}% left${resetSuffix(entry.window.reset_at)}`,
    );
  }
  return rows;
}

function renderToastWindows(
  prefix: string | undefined,
  details: RateLimitDetails | undefined,
) {
  const rows: string[] = [];
  for (const entry of [
    { window: details?.primary_window, secondary: false },
    { window: details?.secondary_window, secondary: true },
  ]) {
    if (!entry.window) continue;
    const label = limitLabel(
      entry.window.limit_window_seconds,
      entry.secondary,
    ).replace(/ limit$/i, "");
    const fullLabel = prefix ? `${prefix} ${label}` : label;
    const used = clamp(numberValue(entry.window.used_percent), 0, 100);
    const remaining = 100 - used;
    rows.push(`${fullLabel}: ${statusIndicator(remaining)} ${remaining.toFixed(0)}% left`);
  }
  return rows;
}

function renderCredits(usage: UsagePayload) {
  const credits = usage.credits;
  if (!credits?.has_credits) return [];
  if (credits.unlimited) return ["- Credits: Unlimited"];
  const balance = Number.parseFloat(credits.balance ?? "");
  if (!Number.isFinite(balance) || balance <= 0) return [];
  return [`- Credits: ${Math.round(balance).toLocaleString()} credits`];
}

function renderProfile(profile?: TokenUsageProfile) {
  const stats = profile?.stats;
  if (!stats) return [];
  const rows: string[] = [];
  pushStat(rows, "Lifetime tokens", stats.lifetime_tokens);
  pushStat(rows, "Peak daily tokens", stats.peak_daily_tokens);
  pushStat(rows, "Current streak", stats.current_streak_days, " days");
  pushStat(rows, "Longest streak", stats.longest_streak_days, " days");
  pushStat(rows, "Longest turn", stats.longest_running_turn_sec, " sec");
  return rows;
}

function pushStat(
  rows: string[],
  label: string,
  value: number | null | undefined,
  suffix = "",
) {
  if (typeof value === "number" && Number.isFinite(value))
    rows.push(`- ${label}: ${value.toLocaleString()}${suffix}`);
}

function limitLabel(seconds: number | undefined, secondary: boolean) {
  const minutes =
    typeof seconds === "number" && seconds > 0
      ? Math.ceil(seconds / 60)
      : undefined;
  if (minutes === 60 * 5) return "5h limit";
  if (minutes === 60 * 24 * 7) return "Weekly limit";
  if (minutes === 60 * 24 * 30 || minutes === 60 * 24 * 31)
    return "Monthly limit";
  if (minutes) return `${formatDuration(minutes)} limit`;
  return secondary ? "Secondary limit" : "Primary limit";
}

function formatDuration(minutes: number) {
  if (minutes % (60 * 24 * 7) === 0) return `${minutes / (60 * 24 * 7)}w`;
  if (minutes % (60 * 24) === 0) return `${minutes / (60 * 24)}d`;
  if (minutes % 60 === 0) return `${minutes / 60}h`;
  return `${minutes}m`;
}

function resetSuffix(epochSeconds: number | undefined) {
  if (
    typeof epochSeconds !== "number" ||
    !Number.isFinite(epochSeconds) ||
    epochSeconds <= 0
  )
    return "";
  return ` (resets ${new Date(epochSeconds * 1000).toLocaleString()})`;
}

function progress(remaining: number) {
  const width = 20;
  const filled = Math.min(
    width,
    Math.max(0, Math.round((remaining / 100) * width)),
  );
  return `[${"█".repeat(filled)}${"░".repeat(width - filled)}]`;
}

function statusIndicator(remaining: number) {
  if (remaining < 20) return "🔴";
  if (remaining < 50) return "🟡";
  return "🟢";
}

function numberValue(value: unknown) {
  return typeof value === "number" && Number.isFinite(value) ? value : 0;
}

function clamp(value: number, min: number, max: number) {
  return Math.min(max, Math.max(min, value));
}

function formatCreditUsage(
  used: string | undefined,
  limit: string | undefined,
) {
  const usedNumber = Number.parseFloat(used ?? "");
  const limitNumber = Number.parseFloat(limit ?? "");
  if (!Number.isFinite(usedNumber) || !Number.isFinite(limitNumber))
    return undefined;
  return `${Math.round(usedNumber).toLocaleString()} of ${Math.round(limitNumber).toLocaleString()} credits used`;
}

export async function getCodexUsage(options?: { requestTimeoutMs?: number }) {
  const auth = await readAuth();
  const idToken = decodeIdToken(auth);
  const requestTimeoutMs = options?.requestTimeoutMs ?? 10_000;
  const usage = await fetchJson<UsagePayload>(
    USAGE_URL,
    auth,
    idToken,
    requestTimeoutMs,
  );
  let profile: TokenUsageProfile | undefined;
  try {
    profile = await fetchJson<TokenUsageProfile>(
      PROFILE_URL,
      auth,
      idToken,
      requestTimeoutMs,
    );
  } catch {
    profile = undefined;
  }
  return {
    markdown: renderUsage(auth, idToken, usage, profile),
    toast: renderToastMessage(usage),
  };
}
