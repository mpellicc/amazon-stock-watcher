import { AmazonWatcher } from "./amazon/AmazonWatcher.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { Monitor } from "./Monitor.js";
import { LocalNotifier } from "./notifications/LocalNotifier.js";
import { StateManager } from "./state/StateManager.js";
import { TelegramNotifier } from "./telegram/TelegramNotifier.js";
import { logger } from "./utils/logger.js";

const SIGNAL_DEBOUNCE_MS = 2000;

function readConfig(): Config {
  try {
    return loadConfig({ requireTelegram: true });
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

async function main(): Promise<void> {
  const config = readConfig();
  logger.configure({ level: config.logLevel, filePath: config.paths.logFile });
  if (!config.telegram) throw new Error("Telegram non configurato");

  const watcher = new AmazonWatcher({
    url: config.amazonUrl,
    asin: config.asin,
    headless: config.headless,
    navigationTimeoutMs: config.navigationTimeoutMs,
    blockHeavyResources: config.blockHeavyResources,
    profileDir: config.paths.browserProfileDir,
  });
  const monitor = new Monitor({
    config,
    watcher,
    state: new StateManager(config.paths.stateFile),
    telegram: new TelegramNotifier(config.telegram, config.amazonUrl),
    local: new LocalNotifier({ soundEnabled: config.localSoundEnabled, openBrowser: config.openBrowserOnAvailable }),
  });

  const controller = new AbortController();
  let firstSignalAt = 0;
  const shutdown = (signal: string): void => {
    if (controller.signal.aborted) {
      // Ctrl+C sotto npm arriva due volte quasi insieme (terminale + inoltro di npm): va ignorato.
      if (Date.now() - firstSignalAt < SIGNAL_DEBOUNCE_MS) return;
      logger.warn("Secondo segnale ricevuto: uscita forzata");
      process.exit(1);
    }
    firstSignalAt = Date.now();
    logger.info(`${signal} ricevuto: chiusura in corso...`);
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // Il watcher non deve morire per un errore isolato: si logga e si prosegue.
  process.on("unhandledRejection", (reason) => logger.error("Promise rifiutata non gestita", reason));
  process.on("uncaughtException", (err) => logger.error("Eccezione non gestita", err));

  await monitor.run(controller.signal);
  await watcher.close();
  logger.info("Watcher fermato. Chromium chiuso.");
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    logger.error("Errore fatale all'avvio", err);
    process.exit(1);
  },
);
