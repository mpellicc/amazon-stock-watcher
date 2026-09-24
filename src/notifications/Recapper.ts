import type { Monitor, SessionStats } from "../Monitor.js";
import type { StateManager } from "../state/StateManager.js";
import type { TelegramNotifier } from "../telegram/TelegramNotifier.js";
import { logger } from "../utils/logger.js";
import { recapMessage } from "./messages.js";

/**
 * Recap periodico su Telegram. Ogni recap programmato copre il periodo dall'ultimo recap;
 * un /recap manuale mostra lo stesso periodo senza azzerarlo.
 */
export class Recapper {
  private timer: NodeJS.Timeout | null = null;
  private nextAt: Date | null = null;
  private periodStart: { at: number; stats: SessionStats };

  constructor(
    private readonly telegram: TelegramNotifier,
    private readonly monitor: Monitor,
    private readonly state: StateManager,
    private intervalHours: number,
  ) {
    this.periodStart = { at: Date.now(), stats: { ...monitor.stats } };
  }

  get hours(): number {
    return this.intervalHours;
  }

  start(): void {
    this.schedule();
  }

  stop(): void {
    if (this.timer) clearTimeout(this.timer);
    this.timer = null;
    this.nextAt = null;
  }

  /** Nuovo intervallo, conteggiato da adesso. 0 = disattivato. Vale fino al riavvio. */
  setIntervalHours(hours: number): void {
    this.intervalHours = hours;
    logger.info(hours > 0 ? `Recap ogni ${hours} h` : "Recap periodico disattivato");
    this.schedule();
  }

  /** Testo del recap per il periodo corrente. */
  build(): string {
    return recapMessage({
      now: new Date(),
      periodStartedAt: this.periodStart.at,
      period: diffStats(this.monitor.stats, this.periodStart.stats),
      session: this.monitor.stats,
      title: this.monitor.productTitle,
      state: this.state.current.lastState,
      armed: this.state.current.armed,
      lastCheckAt: this.monitor.lastOutcome?.at,
      nextRecapAt: this.nextAt,
    });
  }

  private schedule(): void {
    this.stop();
    if (this.intervalHours <= 0) return;
    const delay = this.intervalHours * 3_600_000;
    this.nextAt = new Date(Date.now() + delay);
    this.timer = setTimeout(() => void this.sendScheduled(), delay);
    this.timer.unref();
  }

  private async sendScheduled(): Promise<void> {
    this.schedule(); // prima di build(), così il messaggio riporta l'orario del prossimo recap
    const text = this.build();
    this.periodStart = { at: Date.now(), stats: { ...this.monitor.stats } };
    const sent = await this.telegram.sendWithAmazonButton(text);
    logger.info(`Recap periodico ${sent ? "inviato" : "NON inviato"} su Telegram`);
  }
}

function diffStats(now: SessionStats, before: SessionStats): SessionStats {
  return {
    startedAt: before.startedAt,
    checks: now.checks - before.checks,
    totalCheckMs: now.totalCheckMs - before.totalCheckMs,
    blockedEpisodes: now.blockedEpisodes - before.blockedEpisodes,
    networkErrors: now.networkErrors - before.networkErrors,
    availableEpisodes: now.availableEpisodes - before.availableEpisodes,
    notificationsSent: now.notificationsSent - before.notificationsSent,
  };
}
