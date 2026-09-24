import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { styleText } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 3;

type Style = Parameters<typeof styleText>[0];

// Colors on the console only; the file stays plain text.
export const STATE_STYLE: Record<string, Style> = {
  AVAILABLE: ["bold", "green"],
  UNAVAILABLE: "gray",
  BLOCKED: ["bold", "magenta"],
  NETWORK_ERROR: "red",
  UNKNOWN: "yellow",
  STARTING: "cyan",
};
const LEVEL_STYLE: Record<LogLevel, Style | null> = { debug: "gray", info: null, warn: "yellow", error: ["bold", "red"] };
const LEVEL_BADGE: Record<LogLevel, string> = { debug: "", info: "", warn: "⚠ ", error: "✖ " };

// Anything that looks like a Telegram token gets masked, even inside URLs or stacks.
const SECRET_PATTERNS: RegExp[] = [/\d{6,}:[A-Za-z0-9_-]{30,}/g];

export function redact(text: string): string {
  return SECRET_PATTERNS.reduce((acc, re) => acc.replace(re, "[REDACTED]"), text);
}

export function formatTimestamp(date: Date = new Date()): string {
  const p = (n: number): string => String(n).padStart(2, "0");
  return (
    `${date.getFullYear()}-${p(date.getMonth() + 1)}-${p(date.getDate())} ` +
    `${p(date.getHours())}:${p(date.getMinutes())}:${p(date.getSeconds())}`
  );
}

/** Line meant for the console, already colored; `key` identifies identical repeated checks. */
export interface ConsoleLine {
  time: string;
  body: string;
  level: LogLevel;
  kind: "log" | "check";
  key?: string;
}

/** Alternative console destination (the interactive UI). */
export interface ConsoleSink {
  write(line: ConsoleLine): void;
}

export class Logger {
  private level: LogLevel = "info";
  private sink: ConsoleSink | null = null;
  private showDetails = false;
  private filePath: string | null = null;
  private fileBroken = false;

  configure(options: { level?: LogLevel; filePath?: string }): void {
    if (options.level) this.level = options.level;
    if (options.filePath) {
      this.filePath = options.filePath;
      mkdirSync(dirname(options.filePath), { recursive: true });
    }
  }

  setSink(sink: ConsoleSink | null): void {
    this.sink = sink;
  }

  /** Shows detector details on every check (keyboard toggle). */
  toggleDetails(): boolean {
    this.showDetails = !this.showDetails;
    return this.showDetails;
  }

  /** File only: for information the UI already shows in another form. */
  record(msg: string): void {
    this.appendToFile(redact(`${formatTimestamp()} | ${msg}`));
  }

  debug(msg: string): void {
    this.write("debug", msg);
  }
  info(msg: string): void {
    this.write("info", msg);
  }
  warn(msg: string): void {
    this.write("warn", msg);
  }
  error(msg: string, err?: unknown): void {
    this.write("error", err === undefined ? msg : `${msg}: ${describeError(err)}`);
  }

  /** Check line: "date | STATE | text (duration)". */
  check(state: string, text: string, durationMs: number): void {
    const duration = `(${durationMs} ms)`;
    this.write("info", `${state.padEnd(13)} | ${text} ${duration}`, {
      console: `${paint(STATE_STYLE[state], `● ${state.padEnd(13)}`)} ${text} ${paint("dim", duration)}`,
      key: `${state}|${text}`,
    });
  }

  transition(from: string, to: string): void {
    this.write("info", `Transition ${from} -> ${to}`, {
      console: `${paint("bold", "↳ Transition")} ${paint(STATE_STYLE[from], from)} → ${paint(STATE_STYLE[to], to)}`,
    });
  }

  /** Detector signal details: visible at info, otherwise only at debug. */
  detail(msg: string, visible: boolean): void {
    this.write(visible || this.showDetails ? "info" : "debug", `  ${msg}`, { console: paint("dim", `  ${msg}`) });
  }

  private write(level: LogLevel, msg: string, options: { console?: string; key?: string } = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const now = new Date();
    const prefix = level === "info" || level === "debug" ? "" : `${level.toUpperCase()} | `;
    this.appendToFile(redact(`${formatTimestamp(now)} | ${prefix}${msg}`));

    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    const body = redact(options.console ?? paint(LEVEL_STYLE[level], `${LEVEL_BADGE[level]}${msg}`, stream));
    const time = formatTimestamp(now).slice(11);
    if (this.sink) {
      this.sink.write({ time, body, level, kind: options.key ? "check" : "log", key: options.key });
      return;
    }
    stream.write(`${paint("dim", time, stream)}  ${body}\n`);
  }

  private appendToFile(line: string): void {
    if (!this.filePath || this.fileBroken) return;
    try {
      this.rotateIfNeeded(this.filePath);
      appendFileSync(this.filePath, line + "\n");
    } catch (err) {
      // A log file problem must never stop the watcher.
      this.fileBroken = true;
      console.error(`File logging disabled: ${describeError(err)}`);
    }
  }

  private rotateIfNeeded(path: string): void {
    if (!existsSync(path) || statSync(path).size < MAX_LOG_BYTES) return;
    for (let i = MAX_ROTATED_FILES - 1; i >= 1; i--) {
      if (existsSync(`${path}.${i}`)) renameSync(`${path}.${i}`, `${path}.${i + 1}`);
    }
    renameSync(path, `${path}.1`);
  }
}

/** Applies the style only if the stream is a color-capable terminal (honors NO_COLOR). */
export function paint(style: Style | null | undefined, text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return style ? styleText(style, text, { stream }) : text;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return redact(err.message.split("\n")[0] ?? err.name);
  return redact(String(err));
}

export const logger = new Logger();
