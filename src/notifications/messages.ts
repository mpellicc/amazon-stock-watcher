import type { AvailabilityResult, WatcherState } from "../amazon/types.js";
import type { SessionStats } from "../Monitor.js";
import type { ProblemState } from "../state/transitions.js";
import { formatDuration } from "../ui/ansi.js";

const HEADER = "Amazon Stock Watcher";

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("it-IT", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function availableMessage(result: AvailabilityResult | undefined, detectedAt: Date): string {
  const status = result?.buttonLabel ?? result?.availabilityText ?? "Acquistabile";
  const lines = [
    "🚨 PREORDER AMAZON DISPONIBILE",
    "",
    `🎮 ${result?.title ?? "Prodotto monitorato"}`,
    "",
    "Amazon lo mostra ora come ordinabile/preordinabile.",
    "",
    `🕒 Rilevato alle: ${formatTime(detectedAt)}`,
    `📦 Stato: ${status}`,
  ];
  if (result?.merchant) lines.push(`🏪 Venditore: ${result.merchant}`);
  lines.push("", "Apri subito Amazon:");
  return lines.join("\n");
}

export function technicalMessage(kind: ProblemState, consecutive: number): string {
  const body: Record<ProblemState, string> = {
    BLOCKED: "Amazon sta richiedendo una verifica manuale / CAPTCHA.\n\nIl watcher è temporaneamente bloccato.",
    NETWORK_ERROR: `Amazon non è raggiungibile da ${consecutive} controlli consecutivi (rete/timeout).\n\nIl watcher continua a riprovare.`,
    UNKNOWN: `La pagina Amazon risulta anomala da ${consecutive} controlli consecutivi.\n\nIl watcher continua a riprovare.`,
  };
  return `⚠️ ${HEADER}\n\n${body[kind]}`;
}

export function recoveredMessage(): string {
  return `✅ ${HEADER}\n\nIl monitoraggio è tornato alla normalità.`;
}

export function telegramTestMessage(): string {
  return `✅ ${HEADER}\n\nTelegram configurato correttamente.`;
}

export interface RecapData {
  now: Date;
  periodStartedAt: number;
  period: SessionStats;
  session: SessionStats;
  title?: string;
  state: WatcherState;
  armed: boolean;
  lastCheckAt?: Date;
  /** null = recap periodico disattivato. */
  nextRecapAt: Date | null;
}

export function recapMessage(d: RecapData): string {
  const avg = d.period.checks > 0 ? `${(d.period.totalCheckMs / d.period.checks / 1000).toFixed(1).replace(".", ",")} s` : "-";
  const lines = [
    `📊 ${HEADER} · recap ultime ${formatDuration(d.now.getTime() - d.periodStartedAt)}`,
    "",
    `🎮 ${d.title ?? "Prodotto monitorato"}`,
    `📦 Stato: ${d.state} (${d.armed ? "armed" : "disarmed"})`,
    `🔎 Check: ${d.period.checks.toLocaleString("it-IT")} · media ${avg}`,
    `🧱 Blocchi CAPTCHA: ${d.period.blockedEpisodes} · errori di rete: ${d.period.networkErrors}`,
  ];
  if (d.period.availableEpisodes > 0) lines.push(`🚨 Disponibilità rilevate: ${d.period.availableEpisodes}`);
  lines.push(
    `⏱ Attivo da: ${formatDuration(d.now.getTime() - d.session.startedAt)}`,
    `🕒 Ultimo check: ${d.lastCheckAt ? formatTime(d.lastCheckAt) : "-"}`,
    "",
    d.nextRecapAt ? `Prossimo recap alle ${formatTime(d.nextRecapAt).slice(0, 5)}` : "Recap periodico disattivato",
  );
  return lines.join("\n");
}
