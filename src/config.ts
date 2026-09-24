import dotenv from "dotenv";
import type { LogLevel } from "./utils/logger.js";

// quiet: dotenv 17+ otherwise prints a banner on every start.
dotenv.config({ quiet: true });

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface Config {
  /** Empty until a product is chosen (see withProduct). */
  amazonUrl: string;
  asin: string;
  telegram: TelegramConfig | null;
  minPollIntervalMs: number;
  maxPollIntervalMs: number;
  headless: boolean;
  localSoundEnabled: boolean;
  openBrowserOnAvailable: boolean;
  technicalCooldownMs: number;
  problemAlertThreshold: number;
  navigationTimeoutMs: number;
  blockedRetryIntervalMs: number;
  blockHeavyResources: boolean;
  startupAnimation: boolean;
  recapIntervalHours: number;
  logLevel: LogLevel;
  paths: { stateFile: string; logFile: string; browserProfileDir: string };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Invalid configuration:\n  - ${problems.join("\n  - ")}\n\nCheck your .env file (see .env.example).`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

export interface LoadOptions {
  requireTelegram: boolean;
  /** Already chosen URL (-p flag): takes precedence over AMAZON_URL. */
  productUrl?: string;
  /** false = a missing product is not an error (it will be asked later). Default: true. */
  requireProduct?: boolean;
}

export function loadConfig(options: LoadOptions, env: Env = process.env): Config {
  const problems: string[] = [];
  const str = (key: string): string => (env[key] ?? "").trim();

  const int = (key: string, def: number, min: number): number => {
    const raw = str(key);
    if (raw === "") return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
      problems.push(`${key} must be an integer >= ${min} (current value: "${raw}")`);
      return def;
    }
    return n;
  };

  const bool = (key: string, def: boolean): boolean => {
    const raw = str(key).toLowerCase();
    if (raw === "") return def;
    if (["true", "1", "yes"].includes(raw)) return true;
    if (["false", "0", "no"].includes(raw)) return false;
    problems.push(`${key} must be true or false (current value: "${raw}")`);
    return def;
  };

  const rawUrl = options.productUrl ?? str("AMAZON_URL");
  const product = rawUrl ? parseProductUrl(rawUrl) : null;
  if (rawUrl && !product) problems.push(productUrlError(rawUrl));
  else if (!rawUrl && options.requireProduct !== false) {
    problems.push("No product: pass -p <url> or set AMAZON_URL in .env");
  }

  const botToken = str("TELEGRAM_BOT_TOKEN");
  const chatId = str("TELEGRAM_CHAT_ID");
  if (options.requireTelegram) {
    if (!botToken) problems.push("TELEGRAM_BOT_TOKEN is missing (create one with @BotFather)");
    else if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) problems.push("TELEGRAM_BOT_TOKEN has an invalid format");
    if (!chatId) problems.push("TELEGRAM_CHAT_ID is missing (see README: how to get the chat_id)");
    else if (!/^-?\d+$|^@[A-Za-z0-9_]{4,}$/.test(chatId)) problems.push("TELEGRAM_CHAT_ID must be numeric (or @channelname)");
  }

  const minPoll = int("MIN_POLL_INTERVAL_MS", 9000, 3000);
  const maxPoll = int("MAX_POLL_INTERVAL_MS", 14000, 3000);
  if (maxPoll < minPoll) problems.push("MAX_POLL_INTERVAL_MS must be >= MIN_POLL_INTERVAL_MS");

  const logLevel = (str("LOG_LEVEL") || "info").toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    problems.push(`LOG_LEVEL must be debug|info|warn|error (current value: "${logLevel}")`);
  }

  const base: Config = {
    amazonUrl: "",
    asin: "",
    telegram: botToken && chatId ? { botToken, chatId } : null,
    minPollIntervalMs: minPoll,
    maxPollIntervalMs: maxPoll,
    headless: bool("HEADLESS", true),
    localSoundEnabled: bool("LOCAL_SOUND_ENABLED", true),
    openBrowserOnAvailable: bool("OPEN_BROWSER_ON_AVAILABLE", false),
    technicalCooldownMs: int("TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES", 30, 0) * 60_000,
    problemAlertThreshold: int("PROBLEM_ALERT_THRESHOLD", 6, 1),
    navigationTimeoutMs: int("NAVIGATION_TIMEOUT_MS", 30_000, 5000),
    blockedRetryIntervalMs: int("BLOCKED_RETRY_INTERVAL_MS", 120_000, 10_000),
    blockHeavyResources: bool("BLOCK_HEAVY_RESOURCES", true),
    startupAnimation: bool("STARTUP_ANIMATION", true),
    recapIntervalHours: int("RECAP_INTERVAL_HOURS", 4, 0),
    logLevel: logLevel as LogLevel,
    paths: {
      stateFile: "",
      logFile: "logs/watcher.log",
      browserProfileDir: "data/browser-profile",
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return product ? withProduct(base, product.url) : base;
}

/** Sets the product on the config. Throws ConfigError if the URL is not a valid Amazon product URL. */
export function withProduct(config: Config, url: string): Config {
  const product = parseProductUrl(url);
  if (!product) throw new ConfigError([productUrlError(url)]);
  return {
    ...config,
    amazonUrl: product.url,
    asin: product.asin,
    // One state per product: switching product must not inherit "disarmed" from the previous one.
    paths: { ...config.paths, stateFile: `data/state-${product.asin}.json` },
  };
}

export function extractAsin(url: string): string | null {
  const match = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(url);
  return match?.[1]?.toUpperCase() ?? null;
}

/**
 * Accepts any Amazon product URL (with slug or query parameters) and normalizes it
 * to https://<domain>/dp/<ASIN>. null if it is not an Amazon URL with an ASIN.
 */
export function parseProductUrl(input: string): { url: string; asin: string } | null {
  let parsed: URL;
  try {
    parsed = new URL(input.trim());
  } catch {
    return null;
  }
  if (parsed.protocol !== "https:" || !/^(www\.)?amazon\.[a-z.]+$/.test(parsed.hostname)) return null;
  const asin = extractAsin(parsed.pathname);
  return asin ? { url: `https://${parsed.hostname}/dp/${asin}`, asin } : null;
}

function productUrlError(url: string): string {
  return `Invalid product URL: "${url}" (an https Amazon URL containing /dp/<ASIN> is required)`;
}
