import dotenv from "dotenv";
import type { LogLevel } from "./utils/logger.js";

// quiet: dotenv 17+ altrimenti stampa un messaggio a ogni avvio.
dotenv.config({ quiet: true });

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
  startupAnimation: boolean;
  recapIntervalHours: number;
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

export interface LoadOptions {
  requireTelegram: boolean;
  /** URL già scelto (flag -p o richiesta interattiva): ha la precedenza su AMAZON_URL. */
  productUrl?: string;
}

export function loadConfig(options: LoadOptions, env: Env = process.env): Config {
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

  const rawUrl = options.productUrl ?? str("AMAZON_URL");
  const product = parseProductUrl(rawUrl);
  if (!rawUrl) problems.push("Nessun prodotto: passa -p <url> oppure imposta AMAZON_URL nel .env");
  else if (!product) problems.push(`URL prodotto non valido: "${rawUrl}" (serve un URL https di Amazon con /dp/ASIN)`);

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

  const asin = product?.asin ?? "";
  const config: Config = {
    amazonUrl: product?.url ?? "",
    asin,
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
      // Uno stato per prodotto: cambiando prodotto non si eredita "disarmed" dal precedente.
      stateFile: `data/state-${asin || "unknown"}.json`,
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

/**
 * Accetta qualunque URL prodotto Amazon (anche con slug o parametri) e lo normalizza
 * in https://<dominio>/dp/<ASIN>. null se non è un URL Amazon con ASIN.
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
