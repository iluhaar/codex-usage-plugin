type CliOptions = {
  help: boolean;
  version: boolean;
  install: boolean;
  installLocal: boolean;
  uninstall: boolean;
  upgrade: boolean;
  guardEnabled?: boolean;
  criticalRemainingPercent?: number;
  checkIntervalMinutes?: number;
  upgradeVersion?: string;
  opencodeConfigPath?: string;
  tuiConfigPath?: string;
};

type ConfigTarget = {
  path: string;
  pluginPath: string;
  schema: string;
  stalePluginPaths: string[];
  stalePackageNames?: string[];
  packageName?: string;
  pluginLiteral?: string;
};

type CodexAuthFile = {
  auth_mode?: string;
  OPENAI_API_KEY?: string;
  tokens?: {
    id_token?: string | IdTokenInfo;
    access_token?: string;
    refresh_token?: string;
    account_id?: string;
  };
};

type IdTokenInfo = {
  email?: string;
  chatgpt_plan_type?: string | { type?: string; value?: string } | null;
  chatgpt_user_id?: string;
  chatgpt_account_id?: string;
  chatgpt_account_is_fedramp?: boolean;
  raw_jwt?: string;
};

type UsagePayload = {
  plan_type?: string;
  rate_limit?: RateLimitDetails | null;
  credits?: CreditDetails | null;
  spend_control?: {
    individual_limit?: SpendControlLimit | null;
  } | null;
  additional_rate_limits?: AdditionalRateLimit[] | null;
};

type RateLimitDetails = {
  primary_window?: RateLimitWindow | null;
  secondary_window?: RateLimitWindow | null;
};

type RateLimitWindow = {
  used_percent?: number;
  limit_window_seconds?: number;
  reset_at?: number;
};

type CreditDetails = {
  has_credits?: boolean;
  unlimited?: boolean;
  balance?: string | null;
};

type SpendControlLimit = {
  limit?: string;
  used?: string;
  remaining_percent?: number;
  reset_at?: number;
};

type AdditionalRateLimit = {
  metered_feature?: string;
  limit_name?: string;
  rate_limit?: RateLimitDetails | null;
};

type TokenUsageProfile = {
  stats?: {
    lifetime_tokens?: number | null;
    peak_daily_tokens?: number | null;
    longest_running_turn_sec?: number | null;
    current_streak_days?: number | null;
    longest_streak_days?: number | null;
  };
};
