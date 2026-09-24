import { ansi, color256 } from "./ansi.js";

/*
 * Startup animation, in two parts: the logo (before the product prompt) and the checklist
 * (after it). Any key skips the animations (all waits become zero).
 */

export interface IntroScreen {
  write(text: string): void;
  colors: boolean;
  columns: number;
  isSkipped(): boolean;
}

export interface ChecklistItem {
  label: string;
  /** Resolves with an optional detail (e.g. "UNAVAILABLE, armed"). */
  done: Promise<string | void>;
  timeoutMs?: number;
}

// "ANSI Shadow" letters: each row of a letter gets padded to the same width.
const LETTERS: Record<string, string[]> = {
  S: ["███████╗", "██╔════╝", "███████╗", "╚════██║", "███████║", "╚══════╝"],
  T: ["████████╗", "╚══██╔══╝", "   ██║", "   ██║", "   ██║", "   ╚═╝"],
  O: [" ██████╗", "██╔═══██╗", "██║   ██║", "██║   ██║", "╚██████╔╝", " ╚═════╝"],
  C: [" ██████╗", "██╔════╝", "██║", "██║", "╚██████╗", " ╚═════╝"],
  K: ["██╗  ██╗", "██║ ██╔╝", "█████╔╝", "██╔═██╗", "██║  ██╗", "╚═╝  ╚═╝"],
};

// From Amazon orange to yellow and back (256-color palette).
const GRADIENT = [202, 208, 214, 220, 226, 220, 214, 208];
const SPINNER = ["⠋", "⠙", "⠹", "⠸", "⠼", "⠴", "⠦", "⠧", "⠇", "⠏"];
const PAD = "  ";

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

function waiter(screen: IntroScreen): (ms: number) => Promise<void> {
  return (ms) => (screen.isSkipped() ? Promise.resolve() : new Promise((r) => setTimeout(r, ms)));
}

const dimmer = (screen: IntroScreen) => (s: string): string => (screen.colors ? `\x1b[2m${s}\x1b[22m` : s);

/** Clears the screen and draws the animated logo, the subtitle and the parcel scene. */
export async function playLogo(screen: IntroScreen, subtitle: string): Promise<void> {
  const wait = waiter(screen);
  const dim = dimmer(screen);
  const logo = buildLogo("STOCK");

  screen.write(ansi.clearScreen + ansi.hideCursor + "\n");

  // 1) Logo written row by row.
  for (const row of logo) {
    screen.write(`${PAD}${shade(row, 0, screen.colors)}\n`);
    await wait(70);
  }
  // 2) Gradient sweeping across the logo.
  for (let frame = 1; frame <= 16 && !screen.isSkipped(); frame++) {
    screen.write(ansi.up(logo.length));
    for (const row of logo) screen.write(`${ansi.clearLine}${PAD}${shade(row, frame, screen.colors)}\n`);
    await wait(45);
  }
  const bold = (s: string): string => (screen.colors ? `\x1b[1m${s}\x1b[22m` : s);
  screen.write(`${PAD}${bold("W  A  T  C  H  E  R")}   ${dim(subtitle)}\n\n`);

  // 3) The parcel crosses the screen, then the radar pulses.
  const track = Math.min(40, Math.max(10, screen.columns - 20));
  for (let pos = 0; pos <= track && !screen.isSkipped(); pos += 2) {
    const trail = color256(208, "━".repeat(pos), screen.colors);
    screen.write(`${ansi.clearLine}${PAD}${trail}📦${dim("·".repeat(track - pos))}`);
    await wait(28);
  }
  const trail = color256(208, "━".repeat(track), screen.colors);
  for (const pulse of ["(·)", "((·))", "(((·)))", "((·))", "(((·)))"]) {
    screen.write(`${ansi.clearLine}${PAD}${trail}📦 ${color256(214, pulse, screen.colors)}`);
    await wait(110);
  }
  screen.write(`${ansi.clearLine}${PAD}${trail}📦 ${color256(214, "(((·)))", screen.colors)}\n\n`);
}

/** Checklist tied to real events: each item waits for its promise, with a spinner. */
export async function runChecklist(screen: IntroScreen, items: ChecklistItem[]): Promise<void> {
  const wait = waiter(screen);
  for (const item of items) await runChecklistItem(screen, item, wait);
  screen.write("\n");
}

type Settled = { ok: boolean; detail?: string };

async function runChecklistItem(screen: IntroScreen, item: ChecklistItem, wait: (ms: number) => Promise<void>): Promise<void> {
  const green = (s: string): string => color256(42, s, screen.colors);
  const yellow = (s: string): string => color256(220, s, screen.colors);
  const dim = dimmer(screen);

  const holder: { value: Settled | null } = { value: null };
  const timeout = new Promise<Settled>((resolve) =>
    setTimeout(() => resolve({ ok: false, detail: "still running, continues in the background" }), item.timeoutMs ?? 20_000).unref(),
  );
  void Promise.race([
    item.done.then(
      (detail): Settled => ({ ok: true, detail: detail || undefined }),
      (err: unknown): Settled => ({ ok: false, detail: err instanceof Error ? err.message : String(err) }),
    ),
    timeout,
  ]).then((r) => (holder.value = r));

  // Minimum duration for the effect, then wait for the real event with the spinner.
  let frame = 0;
  const minUntil = Date.now() + (screen.isSkipped() ? 0 : 180);
  while (!holder.value || Date.now() < minUntil) {
    const spin = color256(214, SPINNER[frame++ % SPINNER.length] ?? "·", screen.colors);
    screen.write(`${ansi.clearLine}${PAD}${spin} ${item.label}…`);
    await new Promise((r) => setTimeout(r, 80));
  }
  const result = holder.value;
  const mark = result.ok ? green("✔") : yellow("⚠");
  const detail = result.detail ? ` ${dim(`(${result.detail})`)}` : "";
  screen.write(`${ansi.clearLine}${PAD}${mark} ${item.label}${detail}\n`);
  await wait(60);
}
