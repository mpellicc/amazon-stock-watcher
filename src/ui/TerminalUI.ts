import type { CheckOutcome } from "../amazon/AmazonWatcher.js";
import type { WatcherState } from "../amazon/types.js";
import { promptProductUrl } from "../cli.js";
import { AUTHOR, AUTHOR_URL, REPO_URL } from "../meta.js";
import type { MonitorObserver, SessionStats } from "../Monitor.js";
import type { TransitionDecision } from "../state/transitions.js";
import type { ConsoleLine, ConsoleSink } from "../utils/logger.js";
import { ansi, box, color256, fit, formatDuration, link, visibleWidth } from "./ansi.js";
import { drawHeader, runChecklist, type ChecklistItem, type IntroScreen } from "./intro.js";
import { LEAVE_ALT_SCREEN, playSplash, SPLASH_MIN_COLUMNS, SPLASH_MIN_ROWS } from "./splash.js";

/*
 * Interactive UI, enabled only when stdout and stdin are a real terminal.
 * Under pm2/launchd/systemd it is never created: logs stay plain lines.
 *
 * Startup sequence: showLogo() (full-window splash, then compact header) → askProduct() (only without -p)
 * → finishStartup().
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
// From most descriptive to most compact: the first one that fits the terminal width wins.
const KEYS_HINTS = [
  "[c] check now  [o] open Amazon  [d] details  [q] quit",
  "c check · o Amazon · d details · q quit",
  "c check·o open·d info·q quit",
];

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
  private splashActive = false;
  private splashSkipped = false;
  private keys: KeyHandlers | null = null;
  private readonly keyListener = (key: string): void => this.onKey(key);
  private readonly browserReady: Promise<void>;
  private resolveBrowserReady: () => void = () => undefined;
  private rejectBrowserReady: (err: Error) => void = () => undefined;

  constructor(private readonly stats: SessionStats) {
    this.browserReady = new Promise((resolve, reject) => {
      this.resolveBrowserReady = resolve;
      this.rejectBrowserReady = reject;
    });
    this.browserReady.catch(() => undefined);
    // However the process exits, the terminal goes back to how it was.
    process.on("exit", () => this.restoreTerminal());
  }

  static isSupported(): boolean {
    return Boolean(process.stdout.isTTY && process.stdin.isTTY);
  }

  // ---------------------------------------------------------------- startup

  /**
   * Full-window splash (skipped with Enter; not shown if disabled or the terminal is too small),
   * then the compact header that stays on screen above the prompt and the logs.
   */
  async showLogo(animation: boolean): Promise<void> {
    this.enableKeyboard();
    if (!animation) this.introSkipped = true;
    if (animation && this.columns >= SPLASH_MIN_COLUMNS && this.rows >= SPLASH_MIN_ROWS) {
      this.splashActive = true;
      await playSplash(
        { ...this.screen(), rows: this.rows, isSkipped: () => this.splashSkipped },
        { title: "W  A  T  C  H  E  R", credit: `developed by ${AUTHOR}`, hint: "press Enter to skip" },
      );
      this.splashActive = false;
    }
    drawHeader(this.screen(), `developed by ${this.authorLink()}`);
  }

  /** Asks for the product URL below the logo. Keyboard shortcuts are paused meanwhile. */
  async askProduct(fallback: string): Promise<string> {
    const stdin = process.stdin;
    stdin.off("data", this.keyListener);
    // Raw mode stays on: readline sets it anyway. Toggling it off and readline toggling it back on
    // while stdin is reading leaves a stale line read in libuv on Windows, which swallows keys later.
    this.out.write(ansi.showCursor);
    try {
      return await promptProductUrl(fallback, { indent: "  ", label: "? Amazon product URL" });
    } finally {
      this.out.write(ansi.hideCursor + "\n");
      stdin.setRawMode(true);
      stdin.on("data", this.keyListener);
      stdin.resume();
    }
  }

  /** Checklist (tied to real events), summary box, then the buffered logs and the status line. */
  async finishStartup(options: { checklist: ChecklistItem[]; summary: string[] }): Promise<void> {
    const items: ChecklistItem[] = [
      ...options.checklist,
      { label: "Starting Chromium", done: this.browserReady.then(() => "ready"), timeoutMs: 30_000 },
    ];
    this.introActive = true;
    await runChecklist(this.screen(), items);
    this.introActive = false;

    const repoLink = link(REPO_URL.replace(/^https:\/\//, ""), REPO_URL, this.out.isTTY);
    const summary = [...options.summary, "", this.dim(repoLink)];
    const title = `Amazon Stock Watcher · by ${this.authorLink()}`;
    this.out.write(`${box(summary, { title, columns: this.columns, paint: this.accent })}\n\n`);
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

  // ---------------------------------------------------------------- shutdown

  /** Shutdown during the intro: skip the animations and stop waiting for Chromium. */
  abortIntro(): void {
    this.splashSkipped = true;
    this.introSkipped = true;
    this.rejectBrowserReady(new Error("interrupted"));
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
      `Duration        ${formatDuration(Date.now() - stats.startedAt)}`,
      `Checks          ${stats.checks}  (avg ${avg} s)`,
      `CAPTCHA blocks  ${stats.blockedEpisodes}`,
      `Availability    ${stats.availableEpisodes}`,
      `Notifications   ${stats.notificationsSent}`,
    ];
    this.out.write(`\n${box(lines, { title: "👋 Session ended", columns: this.columns, paint: this.accent })}\n`);
    this.restoreTerminal();
  }

  // ---------------------------------------------------------------- rendering

  private get columns(): number {
    return this.out.columns || 80;
  }

  private get rows(): number {
    return this.out.rows || 24;
  }

  private readonly accent = (s: string): string => color256(208, s, this.colors);
  private readonly dim = (s: string): string => (this.colors ? `\x1b[2m${s}\x1b[22m` : s);

  private authorLink(): string {
    return link(AUTHOR, AUTHOR_URL, this.out.isTTY);
  }

  private screen(): IntroScreen {
    return {
      write: (t) => this.out.write(t),
      colors: this.colors,
      columns: this.columns,
      isSkipped: () => this.introSkipped,
    };
  }

  private render(line: ConsoleLine): void {
    this.clearStatus();
    const repeated =
      line.kind === "check" && this.lastLineIsCheck && this.lastCheck !== null && this.lastCheck.key === line.key;

    if (repeated && this.lastCheck) {
      // Same state and text as the previous check: update the line instead of adding one.
      this.lastCheck.count++;
      const counter = this.dim(`  ×${this.lastCheck.count} since ${this.lastCheck.since}`);
      // Truncate the text, not the counter.
      const head = fit(`${this.dim(line.time)}  ${line.body}`, this.columns - visibleWidth(counter));
      this.out.write(ansi.up(1) + ansi.clearLine + head + counter + "\n");
    } else if (line.kind === "check") {
      this.lastCheck = { key: line.key ?? "", count: 1, since: line.time };
      // Truncated: if it wrapped, the in-place update would overwrite the wrong line.
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
        parts.push(`${spin} starting…`);
        break;
      case "checking":
        parts.push(`${spin} checking…`);
        break;
      case "waiting": {
        const secs = Math.max(0, Math.ceil((this.nextCheckAt - Date.now()) / 1000));
        parts.push(`${spin} next check ${secs}s`);
        break;
      }
      case "closing":
        return `${spin} 👋 Shutting down… closing Chromium`;
    }
    const slow = this.slowdownFactor > 1 ? [`slowed ${this.slowdownFactor}x`] : [];
    // Uptime and counter are dropped first, never the key legend.
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
      "🚨  AVAILABLE NOW  🚨",
      "",
      outcome.result?.title ?? "Watched product",
      `Status: ${outcome.result?.buttonLabel ?? outcome.result?.availabilityText ?? "purchasable"}`,
      "",
      "Press [o] to open Amazon",
    ];
    this.printRaw(`\n${box(lines, { title: "AMAZON", columns: this.columns, paint: green })}\n${ansi.bell}`);
  }

  private setTitle(state: WatcherState): void {
    const icon = TITLE_ICON[state];
    const label = state === "AVAILABLE" ? "AVAILABLE!" : state;
    this.out.write(ansi.title(`${icon} ${label} · Stock Watcher`));
  }

  // ---------------------------------------------------------------- keyboard

  setKeyHandlers(handlers: KeyHandlers): void {
    this.keys = handlers;
  }

  private enableKeyboard(): void {
    const stdin = process.stdin;
    stdin.setRawMode(true);
    stdin.setEncoding("utf8");
    stdin.on("data", this.keyListener);
    stdin.resume();
  }

  private onKey(key: string): void {
    // In raw mode Ctrl+C does not raise SIGINT: it has to be handled here.
    if (key === "\u0003") {
      if (this.keys) this.keys.quit();
      else process.exit(130); // nothing started yet
      return;
    }
    const enter = key === "\r" || key === "\n";
    if (this.splashActive) {
      if (enter) this.splashSkipped = true;
      return;
    }
    if (this.introActive) {
      if (enter) this.introSkipped = true;
      return;
    }
    if (!this.keys || this.phase === "closing") return;
    switch (key.toLowerCase()) {
      case "c":
        this.printRaw(this.dim("  ↻ check requested"));
        this.keys.checkNow();
        break;
      case "o":
        this.printRaw(this.dim("  ↗ opening Amazon in the browser"));
        this.keys.openAmazon();
        break;
      case "d": {
        const on = this.keys.toggleDetails();
        this.printRaw(this.dim(`  detector details ${on ? "on" : "off"}`));
        break;
      }
      case "q":
        this.keys.quit();
        break;
    }
  }

  private restoreTerminal(): void {
    this.stopSpinner();
    if (this.splashActive) this.out.write(LEAVE_ALT_SCREEN);
    if (process.stdin.isTTY) {
      try {
        process.stdin.setRawMode(false);
      } catch {
        // stdin already closed: nothing to restore.
      }
      process.stdin.pause();
    }
    this.out.write(ansi.showCursor + ansi.title(""));
  }
}
