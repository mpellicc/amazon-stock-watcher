import { buildLogo, GRADIENT } from "./intro.js";

/*
 * Full-window startup animation, drawn on the terminal's alternate screen (like vim/htop):
 * when it ends, the normal screen comes back untouched. Frames are time-based, so a slow
 * terminal drops frames instead of stretching the animation. About 2 s; Enter skips it.
 */

export interface SplashScreen {
  write(text: string): void;
  colors: boolean;
  columns: number;
  rows: number;
  isSkipped(): boolean;
}

export const SPLASH_MIN_COLUMNS = 60;
export const SPLASH_MIN_ROWS = 18;

const ENTER_ALT_SCREEN = "\x1b[?1049h\x1b[?25l";
export const LEAVE_ALT_SCREEN = "\x1b[?1049l";
// The timeline below is written in "animation ms"; SPEED compresses it in real time.
const DURATION_MS = 3600;
const SPEED = 1.9; // 3.6 s of timeline ≈ 1.9 s on screen
const HOLD_MS = 250; // real ms the final frame stays up
const FRAME_MS = 33;
const SCRAMBLE = "░▒▓█▀▄■◆●◇◈╳╱╲";
// Radar colors, from the bright front of a ring to its faded tail.
const RADAR_FADE = [214, 208, 202, 166, 130, 94, 58];
const SWEEP_TRAIL = 0.9; // radians

interface Cell {
  ch: string;
  /** SGR parameters, e.g. "38;5;208" or "2"; "" = default style. */
  sgr: string;
}

type Grid = Cell[][];

export async function playSplash(screen: SplashScreen, lines: { title: string; credit: string; hint: string }): Promise<void> {
  const cols = screen.columns;
  const rows = screen.rows;
  const logo = buildLogo("STOCK").map((row) => [...row.trimEnd()]);
  const logoWidth = Math.max(...logo.map((row) => row.length));
  const logoTop = Math.max(1, Math.floor(rows / 2) - 6);
  const logoLeft = Math.floor((cols - logoWidth) / 2);
  const center = { x: cols / 2, y: logoTop + logo.length / 2 };
  // Each logo character decodes at its own moment, between 0.9 s and 2.0 s.
  const revealAt = logo.map((row) => row.map(() => 900 + Math.random() * 1100));
  // Area kept free of radar dots: logo, title, credit and parcel track.
  const bandWidth = Math.min(cols, Math.max(logoWidth, 48) + 6);

  screen.write(ENTER_ALT_SCREEN);
  try {
    const start = Date.now();
    for (;;) {
      const elapsed = Date.now() - start;
      const t = elapsed * SPEED;
      if (screen.isSkipped()) return;
      if (elapsed >= DURATION_MS / SPEED + HOLD_MS) return;
      const grid = emptyGrid(rows, cols);
      drawRadar(grid, center, Math.min(t, DURATION_MS));
      if (t >= 600) clearRect(grid, logoTop - 1, logoTop + logo.length + 7, Math.floor((cols - bandWidth) / 2), bandWidth);
      drawLogo(grid, logo, revealAt, { top: logoTop, left: logoLeft }, Math.min(t, DURATION_MS));
      drawTexts(grid, lines, logoTop + logo.length + 1, Math.min(t, DURATION_MS));
      drawParcel(grid, logoTop + logo.length + 6, Math.min(t, DURATION_MS));
      clearRect(grid, rows - 2, rows - 2, 0, cols);
      putCentered(grid, rows - 2, lines.hint, "2");
      screen.write(render(grid, screen.colors));
      await new Promise((r) => setTimeout(r, FRAME_MS));
    }
  } finally {
    screen.write(LEAVE_ALT_SCREEN);
  }
}

function clearRect(grid: Grid, fromY: number, toY: number, left: number, width: number): void {
  for (let y = fromY; y <= toY; y++) {
    for (let x = left; x < left + width; x++) {
      const cell = grid[y]?.[x];
      if (cell) {
        cell.ch = " ";
        cell.sgr = "";
      }
    }
  }
}

function emptyGrid(rows: number, cols: number): Grid {
  return Array.from({ length: rows }, () => Array.from({ length: cols }, () => ({ ch: " ", sgr: "" })));
}

/** Rings pulsing outward plus a rotating sweep; fades once the logo has decoded. */
function drawRadar(grid: Grid, center: { x: number; y: number }, t: number): void {
  const rows = grid.length;
  const cols = grid[0]?.length ?? 0;
  const maxR = Math.hypot(cols / 4, rows / 2);
  const fadeOut = t > 2200 ? Math.min(1, (t - 2200) / 1200) : 0;
  const sweep = (t / 650) % (2 * Math.PI);

  for (let y = 0; y < rows; y++) {
    const row = grid[y];
    if (!row) continue;
    for (let x = 0; x < cols; x++) {
      // Terminal cells are ~2x taller than wide: halve x to get round rings.
      const dx = (x - center.x) / 2;
      const dy = y - center.y;
      const d = Math.hypot(dx, dy);
      if (d > maxR) continue;

      let level = -1; // index into RADAR_FADE, -1 = nothing
      for (let k = 0; k < 3; k++) {
        const ringR = (((t / 1700 + k / 3) % 1) * maxR) | 0;
        if (Math.abs(d - ringR) < 0.55) level = Math.max(level, Math.floor((d / maxR) * (RADAR_FADE.length - 1)));
      }
      const angle = (Math.atan2(dy, dx) + 2 * Math.PI) % (2 * Math.PI);
      const behind = (sweep - angle + 2 * Math.PI) % (2 * Math.PI);
      // Thin leading edge plus a sparse, fading trail (every other cell) behind it.
      const edge = behind < 0.06 && d > 1;
      const trail = !edge && behind < SWEEP_TRAIL && d > 1 && (x + y) % 2 === 0;

      if (level < 0 && !edge && !trail) continue;
      const fade = edge ? 0 : trail ? 1 + Math.floor((behind / SWEEP_TRAIL) * (RADAR_FADE.length - 2)) : level;
      const shade = Math.min(RADAR_FADE.length - 1, Math.floor(fade + fadeOut * RADAR_FADE.length));
      if (shade >= RADAR_FADE.length - 1 && fadeOut > 0.9) continue;
      const cell = row[x];
      if (!cell) continue;
      cell.ch = edge ? "•" : "·";
      cell.sgr = `38;5;${RADAR_FADE[shade] ?? 58}`;
    }
  }
}

/** Logo characters scramble in from random glyphs, then shimmer with the orange gradient. */
function drawLogo(
  grid: Grid,
  logo: string[][],
  revealAt: number[][],
  box: { top: number; left: number },
  t: number,
): void {
  if (t < 600) return;
  const shimmer = Math.floor(t / 90);
  logo.forEach((row, i) =>
    row.forEach((ch, j) => {
      if (ch === " ") return;
      const cell = grid[box.top + i]?.[box.left + j];
      const at = revealAt[i]?.[j] ?? 0;
      if (!cell || t < at - 450) return;
      if (t < at) {
        cell.ch = SCRAMBLE[Math.floor(Math.random() * SCRAMBLE.length)] ?? "░";
        cell.sgr = "38;5;240";
      } else {
        cell.ch = ch;
        cell.sgr = `38;5;${GRADIENT[(Math.floor(j / 3) + shimmer) % GRADIENT.length] ?? 208}`;
      }
    }),
  );
}

/** Title and credit typed out under the logo. */
function drawTexts(grid: Grid, lines: { title: string; credit: string }, top: number, t: number): void {
  const typed = (text: string, from: number, msPerChar: number): string =>
    t < from ? "" : text.slice(0, Math.floor((t - from) / msPerChar));
  putCentered(grid, top, typed(lines.title, 1900, 35), "1", lines.title.length);
  putCentered(grid, top + 2, typed(lines.credit, 2400, 30), "2", lines.credit.length);
}

/** The parcel crossing a track, leaving an orange trail. */
function drawParcel(grid: Grid, y: number, t: number): void {
  const row = grid[y];
  if (!row || t < 2200) return;
  const width = Math.min(48, row.length - 10);
  const left = Math.floor((row.length - width) / 2);
  const pos = Math.floor(Math.min(1, (t - 2200) / 1100) * (width - 2));
  for (let x = 0; x < width; x++) {
    const cell = row[left + x];
    if (!cell) continue;
    cell.ch = x < pos ? "━" : "·";
    cell.sgr = x < pos ? "38;5;208" : "2";
  }
  const parcel = row[left + pos];
  const after = row[left + pos + 1];
  if (parcel && after) {
    parcel.ch = "📦";
    parcel.sgr = "";
    after.ch = ""; // the emoji takes two cells
  }
}

/** Writes text centered on a row; `slot` keeps typed text anchored at its final position. */
function putCentered(grid: Grid, y: number, text: string, sgr: string, slot = text.length): void {
  const row = grid[y];
  if (!row) return;
  const left = Math.max(0, Math.floor((row.length - slot) / 2));
  [...text].forEach((ch, i) => {
    const cell = row[left + i];
    if (cell) {
      cell.ch = ch;
      cell.sgr = sgr;
    }
  });
}

function render(grid: Grid, colors: boolean): string {
  let out = "";
  grid.forEach((row, y) => {
    out += `\x1b[${y + 1};1H`;
    let current = "";
    for (const cell of row) {
      const sgr = colors ? cell.sgr : "";
      if (sgr !== current) {
        out += `\x1b[0m${sgr ? `\x1b[${sgr}m` : ""}`;
        current = sgr;
      }
      out += cell.ch;
    }
    out += "\x1b[0m";
  });
  return out;
}
