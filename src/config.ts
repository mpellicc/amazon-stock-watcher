import "dotenv/config";
import type { LogLevel } from "./utils/logger.js";

export interface TelegramConfig {
  botToken: string;
  chatId: string;
}

export interface Config {
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
  logLevel: LogLevel;
  paths: { stateFile: string; logFile: string; browserProfileDir: string };
}

export class ConfigError extends Error {
  constructor(public readonly problems: string[]) {
    super(`Configurazione non valida:\n  - ${problems.join("\n  - ")}\n\nControlla il file .env (vedi .env.example).`);
    this.name = "ConfigError";
  }
}

type Env = Record<string, string | undefined>;

export function loadConfig(options: { requireTelegram: boolean }, env: Env = process.env): Config {
  const problems: string[] = [];
  const str = (key: string): string => (env[key] ?? "").trim();

  const int = (key: string, def: number, min: number): number => {
    const raw = str(key);
    if (raw === "") return def;
    const n = Number(raw);
    if (!Number.isInteger(n) || n < min) {
      problems.push(`${key} deve essere un intero >= ${min} (valore attuale: "${raw}")`);
      return def;
    }
    return n;
  };

  const bool = (key: string, def: boolean): boolean => {
    const raw = str(key).toLowerCase();
    if (raw === "") return def;
    if (["true", "1", "yes"].includes(raw)) return true;
    if (["false", "0", "no"].includes(raw)) return false;
    problems.push(`${key} deve essere true o false (valore attuale: "${raw}")`);
    return def;
  };

  const amazonUrl = str("AMAZON_URL") || "https://www.amazon.it/dp/B0F2TN43GH";
  const asin = extractAsin(amazonUrl);
  if (!/^https:\/\/(www\.)?amazon\.[a-z.]+\//.test(amazonUrl)) {
    problems.push(`AMAZON_URL deve essere un URL https di Amazon (valore attuale: "${amazonUrl}")`);
  }
  if (!asin) problems.push(`AMAZON_URL non contiene un ASIN riconoscibile (/dp/XXXXXXXXXX)`);

  const botToken = str("TELEGRAM_BOT_TOKEN");
  const chatId = str("TELEGRAM_CHAT_ID");
  if (options.requireTelegram) {
    if (!botToken) problems.push("TELEGRAM_BOT_TOKEN mancante (crealo con @BotFather)");
    else if (!/^\d+:[A-Za-z0-9_-]{20,}$/.test(botToken)) problems.push("TELEGRAM_BOT_TOKEN ha un formato non valido");
    if (!chatId) problems.push("TELEGRAM_CHAT_ID mancante (vedi README: come ottenere il chat_id)");
    else if (!/^-?\d+$|^@[A-Za-z0-9_]{4,}$/.test(chatId)) problems.push("TELEGRAM_CHAT_ID deve essere numerico (o @nomecanale)");
  }

  const minPoll = int("MIN_POLL_INTERVAL_MS", 9000, 3000);
  const maxPoll = int("MAX_POLL_INTERVAL_MS", 14000, 3000);
  if (maxPoll < minPoll) problems.push("MAX_POLL_INTERVAL_MS deve essere >= MIN_POLL_INTERVAL_MS");

  const logLevel = (str("LOG_LEVEL") || "info").toLowerCase();
  if (!["debug", "info", "warn", "error"].includes(logLevel)) {
    problems.push(`LOG_LEVEL deve essere debug|info|warn|error (valore attuale: "${logLevel}")`);
  }

  const config: Config = {
    amazonUrl,
    asin: asin ?? "",
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
    logLevel: logLevel as LogLevel,
    paths: {
      stateFile: "data/state.json",
      logFile: "logs/watcher.log",
      browserProfileDir: "data/browser-profile",
    },
  };

  if (problems.length > 0) throw new ConfigError(problems);
  return config;
}

export function extractAsin(url: string): string | null {
  const match = /\/(?:dp|gp\/product)\/([A-Z0-9]{10})(?:[/?#]|$)/i.exec(url);
  return match?.[1]?.toUpperCase() ?? null;
}
