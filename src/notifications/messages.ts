import type { AvailabilityResult, WatcherState } from "../amazon/types.js";
import type { SessionStats } from "../Monitor.js";
import type { ProblemState } from "../state/transitions.js";
import { formatDuration } from "../ui/ansi.js";

const HEADER = "Amazon Stock Watcher";

export function formatTime(date: Date): string {
  return date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit", second: "2-digit", hour12: false });
}

export function availableMessage(result: AvailabilityResult | undefined, detectedAt: Date): string {
  const status = result?.buttonLabel ?? result?.availabilityText ?? "Purchasable";
  const lines = [
    "🚨 AMAZON PRODUCT AVAILABLE",
    "",
    `🎮 ${result?.title ?? "Watched product"}`,
    "",
    "Amazon now shows it as orderable/pre-orderable.",
    "",
    `🕒 Detected at: ${formatTime(detectedAt)}`,
    `📦 Status: ${status}`,
  ];
  if (result?.merchant) lines.push(`🏪 Seller: ${result.merchant}`);
  lines.push("", "Open Amazon now:");
  return lines.join("\n");
}

export function technicalMessage(kind: ProblemState, consecutive: number): string {
  const body: Record<ProblemState, string> = {
    BLOCKED: "Amazon is asking for a manual verification / CAPTCHA.\n\nThe watcher is temporarily blocked.",
    NETWORK_ERROR: `Amazon has been unreachable for ${consecutive} consecutive checks (network/timeout).\n\nThe watcher keeps retrying.`,
    UNKNOWN: `The Amazon page has looked anomalous for ${consecutive} consecutive checks.\n\nThe watcher keeps retrying.`,
  };
  return `⚠️ ${HEADER}\n\n${body[kind]}`;
}

export function recoveredMessage(): string {
  return `✅ ${HEADER}\n\nMonitoring is back to normal.`;
}

export function telegramTestMessage(): string {
  return `✅ ${HEADER}\n\nTelegram is configured correctly.`;
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
  /** null = periodic recap disabled. */
  nextRecapAt: Date | null;
}

export function recapMessage(d: RecapData): string {
  const avg = d.period.checks > 0 ? `${(d.period.totalCheckMs / d.period.checks / 1000).toFixed(1)} s` : "-";
  const lines = [
    `📊 ${HEADER} · recap of the last ${formatDuration(d.now.getTime() - d.periodStartedAt)}`,
    "",
    `🎮 ${d.title ?? "Watched product"}`,
    `📦 State: ${d.state} (${d.armed ? "armed" : "disarmed"})`,
    `🔎 Checks: ${d.period.checks.toLocaleString("en-US")} · avg ${avg}`,
    `🧱 CAPTCHA blocks: ${d.period.blockedEpisodes} · network errors: ${d.period.networkErrors}`,
  ];
  if (d.period.availableEpisodes > 0) lines.push(`🚨 Availability detected: ${d.period.availableEpisodes}`);
  lines.push(
    `⏱ Up for: ${formatDuration(d.now.getTime() - d.session.startedAt)}`,
    `🕒 Last check: ${d.lastCheckAt ? formatTime(d.lastCheckAt) : "-"}`,
    "",
    d.nextRecapAt ? `Next recap at ${formatTime(d.nextRecapAt).slice(0, 5)}` : "Periodic recap disabled",
  );
  return lines.join("\n");
}
