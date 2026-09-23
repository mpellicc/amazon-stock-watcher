import { ansi, color256 } from "./ansi.js";

/*
 * Animazione di avvio. Gira in parallelo all'avvio di Chromium e al primo check:
 * non aggiunge latenza. Qualunque tasto la salta (le attese diventano zero).
 */

export interface IntroScreen {
  write(text: string): void;
  colors: boolean;
  columns: number;
  isSkipped(): boolean;
}

export interface ChecklistItem {
  label: string;
  /** Risolve con un dettaglio opzionale (es. "UNAVAILABLE, armed"). */
  done: Promise<string | void>;
  timeoutMs?: number;
}

// Lettere "ANSI Shadow": ogni riga di una lettera viene allineata alla stessa larghezza.
const LETTERS: Record<string, string[]> = {
  S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║", "   ██║", "   ██║", "   ╚═╝"],
  O: [" ██████╗", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝"],
  C: [" ██████╗", "██╔════╝", "██║", "██║", "╚██████╗", " ╚═════╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝", "██╔═██╗", "██║  ██╗", "╚═╝  ╚═╝"],
};

// Da arancione Amazon a giallo e ritorno (palette 256 colori).
const GRADIENT = [202, 208, 214, 220, 226, 220, 214, 208];

function buildLogo(word: string): string[] {
  const rows: string[] = ["", "", "", "", "", ""];
  for (const ch of word) {
    const letter = LETTERS[ch] ?? [];
    const width = Math.max(...letter.map((r) => r.length));
    letter.forEach((r, i) => (rows[i] += r.padEnd(width) + " "));
  }
  return rows;
}

function shade(row: string, offset: number, colors: boolean): string {
  if (!colors) return row;
  let out = "";
  let current = -1;
  [...row].forEach((ch, col) => {
    const code = GRADIENT[(Math.floor(col / 3) + offset) % GRADIENT.length] ?? 208;
    if (code !== current && ch !== " ") {
      out += `\x1b[38;5;${code}m`;
      current = code;
    }
    out += ch;
  });
  return `${out}\x1b[39m`;
}

const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];

export async function playIntro(screen: IntroScreen, subtitle: string, checklist: ChecklistItem[]): Promise<void> {
  const wait = (ms: number): Promise<void> =>
    screen.isSkipped() ? Promise.resolve() : new Promise((r) => setTimeout(r, ms));
  const logo = buildLogo("STOCK");
  const pad = "  ";

  screen.write(ansi.clearScreen + ansi.hideCursor + "\n");

  // 1) Logo che si scrive riga per riga.
  for (const row of logo) {
    screen.write(`${pad}${shade(row, 0, screen.colors)}\n`);
    await wait(70);
  }
  // 2) Sfumatura che scorre sul logo.
  for (let frame = 1; frame <= 16 && !screen.isSkipped(); frame++) {
    screen.write(ansi.up(logo.length));
    for (const row of logo) screen.write(`${ansi.clearLine}${pad}${shade(row, frame, screen.colors)}\n`);
    await wait(45);
  }
  const bold = (s: string): string => (screen.colors ? `\x1b[1m${s}\x1b[22m` : s);
  const dim = (s: string): string => (screen.colors ? `\x1b[2m${s}\x1b[22m` : s);
  screen.write(`${pad}${bold("W  A  T  C  H  E  R")}   ${dim(subtitle)}\n\n`);

  // 3) Il pacco attraversa lo schermo, poi il radar pulsa.
  const track = Math.min(40, Math.max(10, screen.columns - 20));
  for (let pos = 0; pos <= track && !screen.isSkipped(); pos += 2) {
    const trail = color256(208, "━".repeat(pos), screen.colors);
    const rest = dim("·".repeat(track - pos));
    screen.write(`${ansi.clearLine}${pad}${trail}📦${rest}`);
    await wait(28);
  }
  const trail = color256(208, "━".repeat(track), screen.colors);
  for (const pulse of ["(·)", "((·))", "(((·)))", "((·))", "(((·)))"]) {
    screen.write(`${ansi.clearLine}${pad}${trail}📦 ${color256(214, pulse, screen.colors)}`);
    await wait(110);
  }
  screen.write(`${ansi.clearLine}${pad}${trail}📦 ${color256(214, "(((·)))", screen.colors)}\n\n`);

  // 4) Checklist legata a eventi reali.
  for (const item of checklist) await runChecklistItem(screen, pad, item, wait);
  screen.write("\n");
}

async function runChecklistItem(
  screen: IntroScreen,
  pad: string,
  item: ChecklistItem,
  wait: (ms: number) => Promise<void>,
): Promise<void> {
  const green = (s: string): string => color256(42, s, screen.colors);
  const yellow = (s: string): string => color256(220, s, screen.colors);
  const dim = (s: string): string => (screen.colors ? `\x1b[2m${s}\x1b[22m` : s);

  let settled: { ok: boolean; detail?: string } | null = null;
  const timeout = new Promise<{ ok: boolean; detail?: string }>((resolve) =>
    setTimeout(() => resolve({ ok: false, detail: "ancora in corso, prosegue in background" }), item.timeoutMs ?? 20_000).unref(),
  );
  void Promise.race([
    item.done.then(
      (detail) => ({ ok: true, detail: detail || undefined }),
      (err: unknown) => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }),
    ),
    timeout,
  ]).then((r) => (settled = r));

  // Durata minima per l'effetto, poi si aspetta l'evento reale con lo spinner.
  let frame = 0;
  const minUntil = Date.now() + (screen.isSkipped() ? 0 : 180);
  while (!settled || Date.now() < minUntil) {
    screen.write(`${ansi.clearLine}${pad}${color256(214, SPINNER[frame++ % SPINNER.length] ?? "·", screen.colors)} ${item.label}…`);
    await new Promise((r) => setTimeout(r, 80));
  }
  const result: { ok: boolean; detail?: string } = settled;
  const mark = result.ok ? green("✔") : yellow("⚠");
  const detail = result.detail ? ` ${dim(`(${result.detail})`)}` : "";
  screen.write(`${ansi.clearLine}${pad}${mark} ${item.label}${detail}\n`);
  await wait(60);
}
