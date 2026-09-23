import { AmazonWatcher } from "./amazon/AmazonWatcher.js";
import { ConfigError, loadConfig, type Config } from "./config.js";
import { createSessionStats, Monitor, type SessionStats } from "./Monitor.js";
import { LocalNotifier } from "./notifications/LocalNotifier.js";
import { StateManager } from "./state/StateManager.js";
import { TelegramNotifier } from "./telegram/TelegramNotifier.js";
import { formatDuration } from "./ui/ansi.js";
import { TerminalUI } from "./ui/TerminalUI.js";
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

  const stats = createSessionStats();
  const state = new StateManager(config.paths.stateFile);
  const local = new LocalNotifier({ soundEnabled: config.localSoundEnabled, openBrowser: config.openBrowserOnAvailable });
  const ui = TerminalUI.isSupported() ? new TerminalUI(stats) : null;
  if (ui) logger.setSink(ui);

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
    state,
    telegram: new TelegramNotifier(config.telegram, config.amazonUrl),
    local,
    observer: ui ?? undefined,
    stats,
  });

  const controller = new AbortController();
  let firstSignalAt = 0;
  const shutdown = (reason: string): void => {
    if (controller.signal.aborted) {
      // Ctrl+C sotto npm arriva due volte quasi insieme (terminale + inoltro di npm): va ignorato.
      if (Date.now() - firstSignalAt < SIGNAL_DEBOUNCE_MS) return;
      logger.warn("Secondo segnale ricevuto: uscita forzata");
      process.exit(1);
    }
    firstSignalAt = Date.now();
    if (ui) {
      logger.record(`${reason}: chiusura in corso...`);
      ui.abortIntro();
      ui.setClosing();
    } else {
      logger.info(`${reason} ricevuto: chiusura in corso...`);
    }
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // Il watcher non deve morire per un errore isolato: si logga e si prosegue.
  process.on("unhandledRejection", (reason) => logger.error("Promise rifiutata non gestita", reason));
  process.on("uncaughtException", (err) => logger.error("Eccezione non gestita", err));

  ui?.setKeyHandlers({
    checkNow: () => monitor.requestCheckNow(),
    openAmazon: () => local.openUrl(config.amazonUrl),
    toggleDetails: () => logger.toggleDetails(),
    quit: () => shutdown("Uscita richiesta"),
  });

  // Il loop parte subito: l'animazione gira in parallelo e non ritarda il primo check.
  const running = monitor.run(controller.signal);
  const intro = ui?.start({
    animation: config.startupAnimation,
    subtitle: `amazon.it · ${config.asin}`,
    checklist: [
      { label: "Configurazione valida", done: Promise.resolve() },
      { label: "Stato ripristinato", done: Promise.resolve(describeState(state)) },
      { label: "Telegram configurato", done: Promise.resolve(`chat ${maskChatId(config.telegram.chatId)}`) },
    ],
    summary: startupSummary(config, state),
  });

  await running;
  await intro?.catch((err: unknown) => logger.error("Animazione di avvio fallita", err));
  await watcher.close();

  const summary = sessionSummary(stats);
  if (ui) {
    logger.record(`Watcher fermato. ${summary}`);
    ui.finish(stats);
  } else {
    logger.info(`Watcher fermato. Chromium chiuso. ${summary}`);
  }
}

function describeState(state: StateManager): string {
  const s = state.current;
  if (s.lastState === "STARTING") return "prima esecuzione";
  return `${s.lastState}, ${s.armed ? "armed" : "disarmed"}`;
}

function maskChatId(chatId: string): string {
  return chatId.length <= 4 ? chatId : `••••${chatId.slice(-4)}`;
}

function startupSummary(config: Config, state: StateManager): string[] {
  const yesNo = (v: boolean): string => (v ? "✔" : "✖");
  return [
    `Prodotto    ${config.amazonUrl}`,
    `Intervallo  ${config.minPollIntervalMs / 1000}–${config.maxPollIntervalMs / 1000} s con jitter`,
    `Browser     Chromium ${config.headless ? "headless" : "visibile"}`,
    `Telegram    ✔ chat ${maskChatId(config.telegram?.chatId ?? "")}`,
    `Locale      suono ${yesNo(config.localSoundEnabled)} · apri browser ${yesNo(config.openBrowserOnAvailable)}`,
    `Stato       ${describeState(state)}`,
    `Log         ${config.paths.logFile}`,
    `Tasti       c check · o apri Amazon · d dettagli · q esci`,
  ];
}

function sessionSummary(stats: SessionStats): string {
  const avg = stats.checks > 0 ? `${(stats.totalCheckMs / stats.checks / 1000).toFixed(1)} s` : "-";
  return (
    `Sessione: durata ${formatDuration(Date.now() - stats.startedAt)}, ${stats.checks} check (media ${avg}), ` +
    `${stats.blockedEpisodes} blocchi, ${stats.availableEpisodes} disponibilità, ${stats.notificationsSent} notifiche`
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    logger.error("Errore fatale all'avvio", err);
    process.exit(1);
  },
);
