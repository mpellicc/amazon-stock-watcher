import type { AvailabilityResult } from "../amazon/types.js";
import type { ProblemState } from "../state/transitions.js";

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
