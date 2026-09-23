import type { CheckOutcome } from "../amazon/AmazonWatcher.js";
import type { WatcherState } from "../amazon/types.js";
import type { MonitorObserver, SessionStats } from "../Monitor.js";
import type { TransitionDecision } from "../state/transitions.js";
import type { ConsoleLine, ConsoleSink } from "../utils/logger.js";
import { ansi, box, color256, fit, formatDuration, visibleWidth } from "./ansi.js";
import { playIntro, type ChecklistItem } from "./intro.js";

/*
 * UI interattiva, attiva solo quando stdout e stdin sono un terminale vero.
 * Con pm2/launchd/systemd non viene creata: i log restano righe semplici.
 */

export interface KeyHandlers {
  checkNow(): void;
  openAmazon(): void;
  toggleDetails(): boolean;
  quit(): void;
}

type Phase = "starting" | "checking" | "waiting" | "closing";

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const TITLE_ICON: Record<WatcherState, string> = {
  STARTING: "🔵",
  UNAVAILABLE: "⚪",
  AVAILABLE: "🟢",
  BLOCKED: "🟣",
  NETWORK_ERROR: "🔴",
  UNKNOWN: "🟡",
};
// Dal più descrittivo al più compatto: si usa il primo che entra nella larghezza del terminale.
const KEYS_HINTS = ["[c] check ora  [o] apri Amazon  [d] dettagli  [q] esci", "c check · o Amazon · d dettagli · q esci", "c check·o apri·d info·q esci"];

type Pending = { kind: "line"; line: ConsoleLine } | { kind: "raw"; text: string };

export class TerminalUI implements ConsoleSink, MonitorObserver {
  private readonly out = process.stdout;
  private readonly colors = process.stdout.hasColors?.(256) ?? false;
  private buffering = true;
  private buffer: Pending[] = [];
  private statusVisible = false;
  private spinnerTimer: NodeJS.Timeout | null = null;
  private frame = 0;
  private phase: Phase = "starting";
  private nextCheckAt = 0;
  private slowdownFactor = 1;
  private lastState: WatcherState = "STARTING";
  private lastCheck: { key: string; count: number; since: string } | null = null;
  private lastLineIsCheck = false;
  private introActive = false;
  private introSkipped = false;
  private keys: KeyHandlers | null = null;
  private readonly browserReady: Promise<void>;
  private resolveBrowserReady: () => void = () => undefined;
  private rejectBrowserReady: (err: Error) => void = () => undefined;

  constructor(private readonly stats: SessionStats) {
    this.browserReady = new Promise((resolve, reject) => {
      this.resolveBrowserReady = resolve;
      this.rejectBrowserReady = reject;
    });
    this.browserReady.catch(() => undefined);
    // Qualunque sia il modo in cui il processo esce, il terminale torna com'era.
    process.on("exit", () => this.restoreTerminal());
  }

  static isSupported(): boolean {
    return Boolean(process.stdout.isTTY && process.stdin.isTTY);
  }

  // ---------------------------------------------------------------- avvio

  async start(options: { animation: boolean; subtitle: string; checklist: ChecklistItem[]; summary: string[] }): Promise<void> {
    this.enableKeyboard();
    const items: ChecklistItem[] = [
      ...options.checklist,
      { label: "Avvio Chromium", done: this.browserReady.then(() => "pronto"), timeoutMs: 30_000 },
    ];
    if (options.animation) {
      this.introActive = true;
      await playIntro(
        {
          write: (t) => this.out.write(t),
          colors: this.colors,
          columns: this.columns,
          isSkipped: () => this.introSkipped,
        },
        options.subtitle,
        items,
      );
      this.introActive = false;
    } else {
      this.out.write(ansi.clearScreen + ansi.hideCursor);
    }
    this.out.write(`${box(options.summary, { title: "Amazon Stock Watcher", columns: this.columns, paint: this.accent })}\n\n`);
    this.setTitle("STARTING");
    this.flushBuffer();
    this.startSpinner();
  }

  // ---------------------------------------------------------------- ConsoleSink

  write(line: ConsoleLine): void {
    if (this.buffering) this.buffer.push({ kind: "line", line });
    else this.render(line);
  }

  // ---------------------------------------------------------------- MonitorObserver

  onBrowserStarted(): void {
    this.resolveBrowserReady();
  }

  onCheckStart(): void {
    this.phase = "checking";
    this.drawStatus();
  }

  onCheckDone(outcome: CheckOutcome, decision: TransitionDecision): void {
    this.lastState = outcome.state;
    if (decision.changed) this.setTitle(outcome.state);
    if (decision.notifyAvailable) this.showAvailableBanner(outcome);
  }

  onSleep(until: number, slowdownFactor: number): void {
    this.phase = "waiting";
    this.nextCheckAt = until;
    this.slowdownFactor = slowdownFactor;
    this.drawStatus();
  }

  // ---------------------------------------------------------------- chiusura

  /** Chiusura durante l'intro: salta le animazioni e non aspetta Chromium. */
  abortIntro(): void {
    this.introSkipped = true;
    this.rejectBrowserReady(new Error("interrotto"));
  }

  setClosing(): void {
    this.phase = "closing";
    this.drawStatus();
  }

  finish(stats: SessionStats): void {
    this.stopSpinner();
    this.clearStatus();
    const avg = stats.checks > 0 ? (stats.totalCheckMs / stats.checks / 1000).toFixed(1) : "-";
    const lines = [
      `Durata          ${formatDuration(Date.now() - stats.startedAt)}`,
      `Check           ${stats.checks}  (media ${avg} s)`,
      `Blocchi CAPTCHA ${stats.blockedEpisodes}`,
      `Disponibilità   ${stats.availableEpisodes}`,
      `Notifiche       ${stats.notificationsSent}`,
    ];
    this.out.write(`\n${box(lines, { title: "👋 Sessione terminata", columns: this.columns, paint: this.accent })}\n`);
    this.restoreTerminal();
  }

  // ---------------------------------------------------------------- rendering

  private get columns(): number {
    return this.out.columns || 80;
  }

  private readonly accent = (s: string): string => color256(208, s, this.colors);
  private readonly dim = (s: string): string => (this.colors ? `\x1b[2m${s}\x1b[22m` : s);

  private render(line: ConsoleLine): void {
    this.clearStatus();
    const repeated =
      line.kind === "check" && this.lastLineIsCheck && this.lastCheck !== null && this.lastCheck.key === line.key;

    if (repeated && this.lastCheck) {
      // Stesso stato e stesso testo del check precedente: si aggiorna la riga invece di aggiungerne una.
      this.lastCheck.count++;
      const counter = this.dim(`  ×${this.lastCheck.count} dalle ${this.lastCheck.since}`);
      // Si tronca il testo, non il contatore.
      const head = fit(`${this.dim(line.time)}  ${line.body}`, this.columns - visibleWidth(counter));
      this.out.write(ansi.up(1) + ansi.clearLine + head + counter + "\n");
    } else if (line.kind === "check") {
      this.lastCheck = { key: line.key ?? "", count: 1, since: line.time };
      // Troncata: se andasse a capo, l'aggiornamento sul posto sovrascriverebbe la riga sbagliata.
      this.out.write(fit(`${this.dim(line.time)}  ${line.body}`, this.columns) + "\n");
    } else {
      this.out.write(`${this.dim(line.time)}  ${line.body}\n`);
    }
    this.lastLineIsCheck = line.kind === "check";
    this.drawStatus();
  }

  private printRaw(text: string): void {
    if (this.buffering) {
      this.buffer.push({ kind: "raw", text });
      return;
    }
    this.clearStatus();
    this.out.write(text + "\n");
    this.lastLineIsCheck = false;
    this.drawStatus();
  }

  private flushBuffer(): void {
    this.buffering = false;
    this.statusVisible = true;
    for (const item of this.buffer) {
      if (item.kind === "line") this.render(item.line);
      else this.printRaw(item.text);
    }
    this.buffer = [];
  }

  private statusText(): string {
    const spin = SPINNER[this.frame % SPINNER.length] ?? "·";
    const uptime = formatDuration(Date.now() - this.stats.startedAt);
    const parts: string[] = [];
    switch (this.phase) {
      case "starting":
        parts.push(`${spin} avvio in corso…`);
        break;
      case "checking":
        parts.push(`${spin} controllo in corso…`);
        break;
      case "waiting": {
        const secs = Math.max(0, Math.ceil((this.nextCheckAt - Date.now()) / 1000));
        parts.push(`${spin} prossimo check ${secs}s`);
        break;
      }
      case "closing":
        return `${spin} 👋 Chiusura in corso… chiudo Chromium`;
    }
    const slow = this.slowdownFactor > 1 ? [`lento ${this.slowdownFactor}x`] : [];
    // Si sacrificano prima uptime e contatore, mai la spiegazione dei tasti.
    const infoVariants = [
      [...parts, this.lastState, `#${this.stats.checks}`, `up ${uptime}`, ...slow],
      [...parts, this.lastState, `#${this.stats.checks}`, ...slow],
      [...parts, this.lastState, ...slow],
    ];
    for (const hint of KEYS_HINTS) {
      for (const info of infoVariants) {
        const text = `${info.join(" · ")}  │  ${hint}`;
        if (visibleWidth(text) <= this.columns - 1) return text;
      }
    }
    return `${[...parts, this.lastState].join(" · ")}  │  ${KEYS_HINTS[KEYS_HINTS.length - 1] ?? ""}`;
  }

  private drawStatus(): void {
    if (!this.statusVisible) return;
    this.out.write(ansi.clearLine + this.dim(fit(this.statusText(), this.columns)));
  }

  private clearStatus(): void {
    if (this.statusVisible) this.out.write(ansi.clearLine);
  }

  private startSpinner(): void {
    this.spinnerTimer = setInterval(() => {
      this.frame++;
      this.drawStatus();
    }, 120);
    this.spinnerTimer.unref();
  }

  private stopSpinner(): void {
    if (this.spinnerTimer) clearInterval(this.spinnerTimer);
    this.spinnerTimer = null;
  }

  private showAvailableBanner(outcome: CheckOutcome): void {
    const green = (s: string): string => (this.colors ? `\x1b[1;38;5;46m${s}\x1b[0m` : s);
    const lines = [
      "🚨  DISPONIBILE ORA  🚨",
      "",
      outcome.result?.title ?? "Prodotto monitorato",
      `Stato: ${outcome.result?.buttonLabel ?? outcome.result?.availabilityText ?? "acquistabile"}`,
      "",
      "Premi [o] per aprire Amazon",
    ];
    this.printRaw(`\n${box(lines, { title: "AMAZON", columns: this.columns, paint: green })}\n${ansi.bell}`);
  }

  private setTitle(state: WatcherState): void {
    const icon = TITLE_ICON[state];
    const label = state === "AVAILABLE" ? "AVAILABLE!" : state;
    this.out.write(ansi.title(`${icon} ${label} · Stock Watcher`));
  }

  // ---------------------------------------------------------------- tastiera

  setKeyHandlers(handlers: KeyHandlers): void {
    this.keys = handlers;
  }

  private enableKeyboard(): void {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", (key: string) => this.onKey(key));
    stdin.resume();
  }

  private onKey(key: string): void {
    // In raw mode Ctrl+C non genera SIGINT: va gestito qui.
    if (key === "\u0003") return this.keys?.quit();
    if (this.introActive) {
      this.introSkipped = true;
      return;
    }
    if (!this.keys || this.phase === "closing") return;
    switch (key.toLowerCase()) {
      case "c":
        this.printRaw(this.dim("  ↻ check richiesto"));
        this.keys.checkNow();
        break;
      case "o":
        this.printRaw(this.dim("  ↗ apro Amazon nel browser"));
        this.keys.openAmazon();
        break;
      case "d": {
        const on = this.keys.toggleDetails();
        this.printRaw(this.dim(`  dettagli detector ${on ? "attivi" : "disattivati"}`));
        break;
      }
      case "q":
        this.keys.quit();
        break;
    }
  }

  private restoreTerminal(): void {
    this.stopSpinner();
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // stdin già chiuso: niente da ripristinare.
      }
      process.stdin.pause();
    }
    this.out.write(ansi.showCursor + ansi.title(""));
  }
}
