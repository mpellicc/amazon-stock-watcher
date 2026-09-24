import { AmazonWatcher, type CheckOutcome } from "./amazon/AmazonWatcher.js";
import { defaultProductUrl, parseCliArgs, rememberProduct, type CliArgs } from "./cli.js";
import { ConfigError, loadConfig, withProduct, type Config, type LoadOptions } from "./config.js";
import { APP_NAME, APP_VERSION, AUTHOR, REPO_URL } from "./meta.js";
import { createSessionStats, Monitor, type SessionStats } from "./Monitor.js";
import { LocalNotifier } from "./notifications/LocalNotifier.js";
import { Recapper } from "./notifications/Recapper.js";
import { StateManager } from "./state/StateManager.js";
import { TelegramCommands } from "./telegram/TelegramCommands.js";
import { TelegramNotifier } from "./telegram/TelegramNotifier.js";
import { formatDuration } from "./ui/ansi.js";
import { TerminalUI } from "./ui/TerminalUI.js";
import { logger } from "./utils/logger.js";

const SIGNAL_DEBOUNCE_MS = 2000;

// Shared between the UI (status line) and the Monitor (which updates it).
const stats = createSessionStats();

interface Session {
  config: Config;
  state: StateManager;
  monitor: Monitor;
  local: LocalNotifier;
  /** Resolves once the loop, recap and commands have stopped and Chromium is closed. */
  stopped: Promise<void>;
}

async function main(): Promise<void> {
  const args = parseArgsOrExit();
  const ui = TerminalUI.isSupported() ? new TerminalUI(stats) : null;
  // With the UI the product is asked on screen (unless -p is given); without it, -p or AMAZON_URL is required.
  let config = readConfig({ requireTelegram: true, productUrl: args.product, requireProduct: ui === null });
  logger.configure({ level: config.logLevel, filePath: config.paths.logFile });
  if (ui) logger.setSink(ui);

  const banner = `${APP_NAME} v${APP_VERSION} · developed by ${AUTHOR} · ${REPO_URL}`;
  if (ui) logger.record(banner);
  else logger.info(banner);

  const controller = new AbortController();
  let session: Session | null = null;
  let firstSignalAt = 0;
  const shutdown = (reason: string): void => {
    // Nothing started yet (e.g. during the product prompt): just leave.
    if (!session) process.exit(0);
    if (controller.signal.aborted) {
      // Under npm, Ctrl+C arrives twice almost at once (terminal + npm forwarding): ignore it.
      if (Date.now() - firstSignalAt < SIGNAL_DEBOUNCE_MS) return;
      logger.warn("Second signal received: forcing exit");
      process.exit(1);
    }
    firstSignalAt = Date.now();
    if (ui) {
      logger.record(`${reason}: shutting down...`);
      ui.abortIntro();
      ui.setClosing();
    } else {
      logger.info(`${reason} received: shutting down...`);
    }
    controller.abort();
  };
  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));
  // The watcher must not die because of an isolated error: log it and keep going.
  process.on("unhandledRejection", (reason) => logger.error("Unhandled promise rejection", reason));
  process.on("uncaughtException", (err) => logger.error("Uncaught exception", err));

  ui?.setKeyHandlers({
    checkNow: () => session?.monitor.requestCheckNow(),
    openAmazon: () => session?.local.openUrl(session.config.amazonUrl),
    toggleDetails: () => logger.toggleDetails(),
    quit: () => shutdown("Quit requested"),
  });

  if (!ui) {
    session = startSession(config, null, controller.signal);
  } else if (args.product) {
    // Product already known: the loop starts right away, in parallel with the animation.
    session = startSession(config, ui, controller.signal);
    await ui.showLogo(config.startupAnimation);
  } else {
    await ui.showLogo(config.startupAnimation);
    config = withProduct(config, await ui.askProduct(defaultProductUrl()));
    session = startSession(config, ui, controller.signal);
  }

  const intro = ui?.finishStartup({
    checklist: [
      { label: "Configuration valid", done: Promise.resolve() },
      { label: "Product", done: Promise.resolve(`ASIN ${config.asin}`) },
      { label: "State restored", done: Promise.resolve(describeState(session.state)) },
      { label: "Telegram configured", done: Promise.resolve(`chat ${maskChatId(config.telegram?.chatId ?? "")}`) },
    ],
    summary: startupSummary(config, session.state),
  });

  await session.stopped;
  await intro?.catch((err: unknown) => logger.error("Startup animation failed", err));

  const summary = sessionSummary(stats);
  if (ui) {
    logger.record(`Watcher stopped. ${summary}`);
    ui.finish(stats);
  } else {
    logger.info(`Watcher stopped. Chromium closed. ${summary}`);
  }
}

/** Builds and starts everything that depends on the product: loop, recap, Telegram commands. */
function startSession(config: Config, ui: TerminalUI | null, signal: AbortSignal): Session {
  if (!config.telegram) throw new Error("Telegram is not configured");
  rememberProduct(config.amazonUrl);

  const state = new StateManager(config.paths.stateFile);
  const local = new LocalNotifier({ soundEnabled: config.localSoundEnabled, openBrowser: config.openBrowserOnAvailable });
  const watcher = new AmazonWatcher({
    url: config.amazonUrl,
    asin: config.asin,
    headless: config.headless,
    navigationTimeoutMs: config.navigationTimeoutMs,
    blockHeavyResources: config.blockHeavyResources,
    profileDir: config.paths.browserProfileDir,
  });
  const telegram = new TelegramNotifier(config.telegram, config.amazonUrl);
  const monitor = new Monitor({ config, watcher, state, telegram, local, observer: ui ?? undefined, stats });

  const recapper = new Recapper(telegram, monitor, state, config.recapIntervalHours);
  const commands = new TelegramCommands(telegram, {
    recap: async () => ({ text: recapper.build(), withAmazonButton: true }),
    setRecapInterval: (hours) => {
      recapper.setIntervalHours(hours);
      return { text: hours > 0 ? `⏰ Recap every ${hours} h (until the next restart)` : "⏰ Periodic recap disabled" };
    },
    check: async () => ({ text: describeCheck(await monitor.checkNow()) }),
  });

  const running = monitor.run(signal);
  recapper.start();
  const listening = commands.run(signal);
  const stopped = (async () => {
    await running;
    recapper.stop();
    await listening;
    await watcher.close();
  })();
  return { config, state, monitor, local, stopped };
}

function parseArgsOrExit(): CliArgs {
  try {
    return parseCliArgs();
  } catch (err) {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  }
}

function readConfig(options: LoadOptions): Config {
  try {
    return loadConfig(options);
  } catch (err) {
    if (err instanceof ConfigError) {
      console.error(err.message);
      process.exit(1);
    }
    throw err;
  }
}

function describeCheck(outcome: CheckOutcome | null): string {
  if (!outcome) return "⏳ The check did not finish within 90 s (browser restarting or Amazon slow). Try again shortly.";
  const icon = outcome.state === "AVAILABLE" ? "🟢" : outcome.state === "UNAVAILABLE" ? "⚪" : "⚠️";
  return `${icon} ${outcome.state}\n${outcome.summary}\n(${(outcome.durationMs / 1000).toFixed(1)} s)`;
}

function describeState(state: StateManager): string {
  const s = state.current;
  if (s.lastState === "STARTING") return "first run for this product";
  return `${s.lastState}, ${s.armed ? "armed" : "disarmed"}`;
}

function maskChatId(chatId: string): string {
  return chatId.length <= 4 ? chatId : `••••${chatId.slice(-4)}`;
}

function startupSummary(config: Config, state: StateManager): string[] {
  const yesNo = (v: boolean): string => (v ? "✔" : "✖");
  return [
    `Product     ${config.amazonUrl}`,
    `Interval    ${config.minPollIntervalMs / 1000}–${config.maxPollIntervalMs / 1000} s with jitter`,
    `Browser     Chromium ${config.headless ? "headless" : "visible"}`,
    `Telegram    ✔ chat ${maskChatId(config.telegram?.chatId ?? "")}`,
    `Local       sound ${yesNo(config.localSoundEnabled)} · open browser ${yesNo(config.openBrowserOnAvailable)}`,
    `State       ${describeState(state)}`,
    `Recap       ${config.recapIntervalHours > 0 ? `every ${config.recapIntervalHours} h` : "disabled"} · commands /recap /check`,
    `Log         ${config.paths.logFile}`,
    `Keys        c check · o open Amazon · d details · q quit`,
  ];
}

function sessionSummary(s: SessionStats): string {
  const avg = s.checks > 0 ? `${(s.totalCheckMs / s.checks / 1000).toFixed(1)} s` : "-";
  return (
    `Session: duration ${formatDuration(Date.now() - s.startedAt)}, ${s.checks} checks (avg ${avg}), ` +
    `${s.blockedEpisodes} blocks, ${s.availableEpisodes} availability, ${s.notificationsSent} notifications`
  );
}

main().then(
  () => process.exit(0),
  (err: unknown) => {
    logger.error("Fatal error at startup", err);
    process.exit(1);
  },
);
