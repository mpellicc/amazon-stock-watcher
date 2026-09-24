/** Sequenze ANSI minime e helper di misura/formattazione per il terminale. */

export const ansi = {
  clearScreen: "\x1b[2J\x1b[3J\x1b[H",
  hideCursor: "\x1b[?25l",
  showCursor: "\x1b[?25h",
  clearLine: "\r\x1b[2K",
  up: (n = 1): string => `\x1b[${n}A`,
  title: (text: string): string => `\x1b]0;${text}\x07`,
  bell: "\x07",
};

const ANSI_PATTERN = /\x1b\[[0-9;?]*[A-Za-z]|\x1b\][^\x07]*\x07/g;

export function stripAnsi(text: string): string {
  return text.replace(ANSI_PATTERN, "");
}

/** Larghezza visibile approssimata: emoji (presentazione grafica) doppie, simboli come ✔ singoli. */
export function visibleWidth(text: string): number {
  let width = 0;
  for (const ch of stripAnsi(text)) width += /\p{Emoji_Presentation}/u.test(ch) ? 2 : 1;
  return width;
}

/** Tronca alla larghezza del terminale mantenendo i colori (le sequenze ANSI non occupano spazio). */
export function fit(text: string, columns: number): string {
  if (visibleWidth(text) <= columns) return text;
  let out = "";
  let width = 0;
  for (const token of text.split(new RegExp(`(${ANSI_PATTERN.source})`))) {
    if (!token) continue;
    if (token.startsWith("\x1b")) {
      out += token;
      continue;
    }
    for (const ch of token) {
      const w = /\p{Emoji_Presentation}/u.test(ch) ? 2 : 1;
      if (width + w > columns - 1) return `${out}…\x1b[0m`;
      out += ch;
      width += w;
    }
  }
  return `${out}…\x1b[0m`;
}

export function color256(code: number, text: string, enabled: boolean): string {
  return enabled ? `\x1b[38;5;${code}m${text}\x1b[39m` : text;
}

export function formatDuration(ms: number): string {
  const totalSec = Math.max(0, Math.round(ms / 1000));
  const h = Math.floor(totalSec / 3600);
  const m = Math.floor((totalSec % 3600) / 60);
  const s = totalSec % 60;
  if (h >= 24) return `${Math.floor(h / 24)}g ${h % 24}h`;
  if (h > 0) return `${h}h ${String(m).padStart(2, "0")}m`;
  if (m > 0) return `${m}m ${String(s).padStart(2, "0")}s`;
  return `${s}s`;
}

/** Riquadro con bordi arrotondati. Le righe troppo lunghe vengono troncate. */
export function box(lines: string[], options: { title?: string; columns: number; paint?: (s: string) => string }): string {
  const paint = options.paint ?? ((s: string) => s);
  const maxInner = Math.max(10, options.columns - 4);
  const body = lines.map((l) => fit(l, maxInner));
  const inner = Math.min(maxInner, Math.max(...body.map(visibleWidth), visibleWidth(options.title ?? "") + 2));
  const title = options.title ? ` ${options.title} ` : "";
  const top = paint(`╭─${title}${"─".repeat(Math.max(0, inner - visibleWidth(title)))}─╮`);
  const bottom = paint(`╰${"─".repeat(inner + 2)}╯`);
  const rows = body.map((l) => `${paint("│")} ${l}${" ".repeat(inner - visibleWidth(l))} ${paint("│")}`);
  return [top, ...rows, bottom].join("\n");
}
