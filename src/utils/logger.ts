import { appendFileSync, existsSync, mkdirSync, renameSync, statSync } from "node:fs";
import { dirname } from "node:path";
import { styleText } from "node:util";

export type LogLevel = "debug" | "info" | "warn" | "error";

const LEVEL_ORDER: Record<LogLevel, number> = { debug: 10, info: 20, warn: 30, error: 40 };
const MAX_LOG_BYTES = 5 * 1024 * 1024;
const MAX_ROTATED_FILES = 3;

type Style = Parameters<typeof styleText>[0];

// Colori solo in console; il file resta testo semplice.
const STATE_STYLE: Record<string, Style> = {
  AVAILABLE: ["bold", "green"],
  UNAVAILABLE: "gray",
  BLOCKED: ["bold", "magenta"],
  NETWORK_ERROR: "red",
  UNKNOWN: "yellow",
  STARTING: "cyan",
};
const LEVEL_STYLE: Record<LogLevel, Style | null> = { debug: "gray", info: null, warn: "yellow", error: ["bold", "red"] };
const LEVEL_BADGE: Record<LogLevel, string> = { debug: "", info: "", warn: "⚠ ", error: "✖ " };

// Qualunque cosa somigli a un token Telegram viene mascherata, anche dentro URL o stack.
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

export class Logger {
  private level: LogLevel = "info";
  private filePath: string | null = null;
  private fileBroken = false;

  configure(options: { level?: LogLevel; filePath?: string }): void {
    if (options.level) this.level = options.level;
    if (options.filePath) {
      this.filePath = options.filePath;
      mkdirSync(dirname(options.filePath), { recursive: true });
    }
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

  /** Riga di check: "data | STATO | testo (durata)". */
  check(state: string, text: string, durationMs: number): void {
    const duration = `(${durationMs} ms)`;
    this.write("info", `${state.padEnd(13)} | ${text} ${duration}`, {
      console: `${paint(STATE_STYLE[state], `● ${state.padEnd(13)}`)} ${text} ${paint("dim", duration)}`,
    });
  }

  transition(from: string, to: string): void {
    this.write("info", `Transizione ${from} -> ${to}`, {
      console: `${paint("bold", "↳ Transizione")} ${paint(STATE_STYLE[from], from)} → ${paint(STATE_STYLE[to], to)}`,
    });
  }

  /** Dettaglio dei segnali del detector: visibile a info, altrimenti solo in debug. */
  detail(msg: string, visible: boolean): void {
    this.write(visible ? "info" : "debug", `  ${msg}`, { console: paint("dim", `  ${msg}`) });
  }

  private write(level: LogLevel, msg: string, options: { console?: string } = {}): void {
    if (LEVEL_ORDER[level] < LEVEL_ORDER[this.level]) return;
    const now = new Date();
    const prefix = level === "info" || level === "debug" ? "" : `${level.toUpperCase()} | `;
    this.appendToFile(redact(`${formatTimestamp(now)} | ${prefix}${msg}`));

    const stream = level === "error" || level === "warn" ? process.stderr : process.stdout;
    const body = options.console ?? paint(LEVEL_STYLE[level], `${LEVEL_BADGE[level]}${msg}`, stream);
    stream.write(`${paint("dim", formatTimestamp(now).slice(11), stream)}  ${redact(body)}\n`);
  }

  private appendToFile(line: string): void {
    if (!this.filePath || this.fileBroken) return;
    try {
      this.rotateIfNeeded(this.filePath);
      appendFileSync(this.filePath, line + "\n");
    } catch (err) {
      // Un problema sul file di log non deve mai fermare il watcher.
      this.fileBroken = true;
      console.error(`Log su file disabilitato: ${describeError(err)}`);
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

/** Applica lo stile solo se lo stream è un terminale che supporta i colori (rispetta NO_COLOR). */
function paint(style: Style | null | undefined, text: string, stream: NodeJS.WriteStream = process.stdout): string {
  return style ? styleText(style, text, { stream }) : text;
}

export function describeError(err: unknown): string {
  if (err instanceof Error) return redact(err.message.split("\n")[0] ?? err.name);
  return redact(String(err));
}

export const logger = new Logger();
