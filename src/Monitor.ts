import type { AmazonWatcher, CheckOutcome } from "./amazon/AmazonWatcher.js";
import { explainResult } from "./amazon/availabilityDetector.js";
import type { Config } from "./config.js";
import type { LocalNotifier } from "./notifications/LocalNotifier.js";
import { availableMessage, recoveredMessage, technicalMessage } from "./notifications/messages.js";
import type { StateManager } from "./state/StateManager.js";
import { applyObservation, markAvailableNotified, markTechnicalNotified, type TransitionDecision } from "./state/transitions.js";
import type { TelegramNotifier } from "./telegram/TelegramNotifier.js";
import { logger } from "./utils/logger.js";
import { randomBetween, sleep } from "./utils/sleep.js";

const RESTART_BACKOFF_MIN_MS = 2_000;
const RESTART_BACKOFF_MAX_MS = 120_000;
// Rallentamento adattivo: ogni nuovo episodio BLOCKED raddoppia l'intervallo di polling
// (fino a 8x); dopo 30 minuti senza nuovi blocchi si dimezza di nuovo, un passo alla volta.
const SLOWDOWN_MAX_FACTOR = 8;
const SLOWDOWN_RECOVERY_MS = 30 * 60_000;

export interface SessionStats {
  startedAt: number;
  checks: number;
  totalCheckMs: number;
  blockedEpisodes: number;
  networkErrors: number;
  availableEpisodes: number;
  notificationsSent: number;
}

/** Eventi per la UI del terminale: tutti opzionali, il Monitor funziona anche senza. */
export interface MonitorObserver {
  onBrowserStarted?(): void;
  onCheckStart?(): void;
  onCheckDone?(outcome: CheckOutcome, decision: TransitionDecision): void;
  onSleep?(until: number, slowdownFactor: number): void;
}

export interface MonitorDeps {
  config: Config;
  watcher: AmazonWatcher;
  state: StateManager;
  telegram: TelegramNotifier;
  local: LocalNotifier;
  observer?: MonitorObserver;
  stats?: SessionStats;
}

export function createSessionStats(): SessionStats {
  return { startedAt: Date.now(), checks: 0, totalCheckMs: 0, blockedEpisodes: 0, networkErrors: 0, availableEpisodes: 0, notificationsSent: 0 };
}

/** Loop principale: check → transizione di stato → notifiche → attesa con jitter. */
export class Monitor {
  private restartFailures = 0;
  private lastNavigationAt = 0;
  /** Suono/apertura browser una sola volta per episodio di disponibilità. */
  private localAlertDone = false;
  private slowdownFactor = 1;
  private lastSlowdownChangeAt = 0;
  private wake: AbortController | null = null;
  private forceNavigation = false;
  private checkWaiters: Array<(outcome: CheckOutcome) => void> = [];
  /** Ultimo titolo letto dalla pagina (per recap e risposte ai comandi). */
  productTitle: string | undefined;
  lastOutcome: { outcome: CheckOutcome; at: Date } | null = null;
  readonly stats: SessionStats;

  constructor(private readonly deps: MonitorDeps) {
    this.stats = deps.stats ?? createSessionStats();
  }

  async run(signal: AbortSignal): Promise<void> {
    const { config, state } = this.deps;
    logger.info(
      `Monitoraggio ${config.amazonUrl} (ASIN ${config.asin}) ogni ${config.minPollIntervalMs}-${config.maxPollIntervalMs} ms. ` +
        `Ultimo stato noto: ${state.current.lastState}${state.current.armed ? "" : " (notifica già inviata, in attesa di UNAVAILABLE)"}`,
    );

    while (!signal.aborted) {
      try {
        if (!(await this.ensureBrowser(signal))) continue;
        this.deps.observer?.onCheckStart?.();
        const outcome = await this.observe();
        if (signal.aborted) break;
        await this.handle(outcome);
      } catch (err) {
        // Ultima rete di sicurezza: nessun errore imprevisto deve fermare il loop.
        logger.error("Errore inatteso nel ciclo di controllo", err);
      }
      const delay = randomBetween(config.minPollIntervalMs, config.maxPollIntervalMs) * this.slowdownFactor;
      this.deps.observer?.onSleep?.(Date.now() + delay, this.slowdownFactor);
      this.wake = new AbortController();
      await sleep(delay, AbortSignal.any([signal, this.wake.signal]));
      this.wake = null;
    }
  }

  /** Interrompe l'attesa e forza una navigazione (anche se si è BLOCKED). */
  requestCheckNow(): void {
    this.forceNavigation = true;
    this.wake?.abort();
  }

  /** Come requestCheckNow, ma attende l'esito (null se non arriva entro timeoutMs). */
  checkNow(timeoutMs = 90_000): Promise<CheckOutcome | null> {
    return new Promise((resolve) => {
      const timer = setTimeout(() => resolve(null), timeoutMs);
      this.checkWaiters.push((outcome) => {
        clearTimeout(timer);
        resolve(outcome);
      });
      this.requestCheckNow();
    });
  }

  /** Avvia/ricrea Chromium con backoff esponenziale. false = riprovare al giro successivo. */
  private async ensureBrowser(signal: AbortSignal): Promise<boolean> {
    const { watcher } = this.deps;
    if (!watcher.needsRestart()) return true;
    try {
      await watcher.start();
      this.restartFailures = 0;
      this.deps.observer?.onBrowserStarted?.();
      return true;
    } catch (err) {
      this.restartFailures++;
      const delay = Math.min(RESTART_BACKOFF_MIN_MS * 2 ** (this.restartFailures - 1), RESTART_BACKOFF_MAX_MS);
      const hint = /Executable doesn't exist|playwright install/i.test(String(err))
        ? " — esegui: npx playwright install chromium"
        : "";
      logger.error(`Avvio Chromium fallito (tentativo ${this.restartFailures}, riprovo tra ${delay / 1000}s)${hint}`, err);
      await this.handle({ state: "UNKNOWN", summary: "Chromium non avviabile", durationMs: 0 });
      await sleep(delay, signal);
      return false;
    }
  }

  /**
   * In BLOCKED non si ricarica a ogni giro: si rilegge la pagina corrente (con HEADLESS=false
   * l'utente può risolvere la verifica a mano) e si rinaviga solo ogni BLOCKED_RETRY_INTERVAL_MS.
   */
  private async observe(): Promise<CheckOutcome> {
    const { watcher, state, config } = this.deps;
    const forced = this.forceNavigation;
    this.forceNavigation = false;
    if (state.current.lastState === "BLOCKED" && !forced) {
      const current = await watcher.inspectCurrentPage();
      const retryDue = Date.now() - this.lastNavigationAt >= config.blockedRetryIntervalMs;
      if (current.state !== "BLOCKED" || !retryDue) return current;
    }
    this.lastNavigationAt = Date.now();
    return watcher.check();
  }

  private async handle(outcome: CheckOutcome): Promise<void> {
    const { state, config } = this.deps;
    const now = new Date();
    const decision = applyObservation(state.current, outcome.state, now, {
      problemAlertThreshold: config.problemAlertThreshold,
      cooldownMs: config.technicalCooldownMs,
    });

    this.log(outcome, decision);
    state.update(decision.next);
    this.adjustSlowdown(outcome.state, decision.changed, now.getTime());
    this.updateStats(outcome, decision);
    this.deps.observer?.onCheckDone?.(outcome, decision);
    if (outcome.result?.title) this.productTitle = outcome.result.title;
    this.lastOutcome = { outcome, at: now };
    // Solo i check reali (durationMs > 0) soddisfano chi ha chiesto /check.
    if (outcome.durationMs > 0) {
      const waiters = this.checkWaiters;
      this.checkWaiters = [];
      for (const resolve of waiters) resolve(outcome);
    }

    if (outcome.state === "UNAVAILABLE") this.localAlertDone = false;
    if (decision.notifyAvailable) await this.notifyAvailable(outcome, now);
    if (decision.technicalAlert) {
      const kind = decision.technicalAlert;
      const sent = await this.deps.telegram.sendPlain(technicalMessage(kind, decision.next.consecutiveProblems));
      // Best-effort: anche un tentativo fallito consuma il cooldown, per non martellare Telegram.
      state.update(markTechnicalNotified(state.current, kind, now));
      logger.warn(`Alert tecnico ${kind} ${sent ? "inviato" : "NON inviato"} su Telegram`);
    }
    if (decision.recoveredAfterAlert) await this.deps.telegram.sendPlain(recoveredMessage());
  }

  private updateStats(outcome: CheckOutcome, d: TransitionDecision): void {
    if (outcome.durationMs > 0) {
      this.stats.checks++;
      this.stats.totalCheckMs += outcome.durationMs;
    }
    if (d.changed && outcome.state === "BLOCKED") this.stats.blockedEpisodes++;
    if (outcome.state === "NETWORK_ERROR") this.stats.networkErrors++;
    if (d.changed && outcome.state === "AVAILABLE") this.stats.availableEpisodes++;
  }

  private adjustSlowdown(observed: CheckOutcome["state"], changed: boolean, now: number): void {
    const { minPollIntervalMs, maxPollIntervalMs } = this.deps.config;
    let next = this.slowdownFactor;
    if (observed === "BLOCKED" && changed) {
      next = Math.min(this.slowdownFactor * 2, SLOWDOWN_MAX_FACTOR);
    } else if (observed !== "BLOCKED" && this.slowdownFactor > 1 && now - this.lastSlowdownChangeAt >= SLOWDOWN_RECOVERY_MS) {
      next = this.slowdownFactor / 2;
    }
    // Un nuovo blocco con il fattore già al massimo riavvia comunque il periodo di recupero.
    if (observed === "BLOCKED" && changed) this.lastSlowdownChangeAt = now;
    if (next === this.slowdownFactor) return;
    this.slowdownFactor = next;
    this.lastSlowdownChangeAt = now;
    logger.info(
      `Polling ${next > 1 ? `rallentato ${next}x` : "tornato normale"}: ` +
        `${(minPollIntervalMs * next) / 1000}-${(maxPollIntervalMs * next) / 1000} s`,
    );
  }

  private async notifyAvailable(outcome: CheckOutcome, now: Date): Promise<void> {
    const { telegram, local, state, config } = this.deps;
    if (!this.localAlertDone) {
      this.localAlertDone = true;
      local.alertAvailable(config.amazonUrl);
    }
    const sent = await telegram.sendWithAmazonButton(availableMessage(outcome.result, now));
    if (sent) {
      state.update(markAvailableNotified(state.current, now));
      this.stats.notificationsSent++;
      logger.info("🚨 Notifica di disponibilità inviata su Telegram");
    } else {
      // Resta armato: riprova al prossimo check.
      logger.error("Notifica di disponibilità NON consegnata a Telegram: riprovo al prossimo controllo");
    }
  }

  private log(outcome: CheckOutcome, d: TransitionDecision): void {
    logger.check(outcome.state, outcome.summary, outcome.durationMs);
    if (d.changed) logger.transition(d.previous, outcome.state);
    if (outcome.result) logger.detail(explainResult(outcome.result), d.changed || outcome.state === "AVAILABLE");
    if (d.recovered) logger.info(`Ritorno alla normalità dopo ${d.previous} (${this.deps.state.current.consecutiveProblems} problemi consecutivi)`);
  }
}
