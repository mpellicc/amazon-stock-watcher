import { existsSync, mkdirSync, readFileSync, renameSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import type { WatcherState } from "../amazon/types.js";
import { describeError, logger } from "../utils/logger.js";
import { initialState, type PersistedState } from "./transitions.js";

const VALID_STATES: WatcherState[] = ["STARTING", "UNKNOWN", "UNAVAILABLE", "AVAILABLE", "BLOCKED", "NETWORK_ERROR"];

/** Persistenza JSON con scrittura atomica (file temporaneo + rename). */
export class StateManager {
  private state: PersistedState;

  constructor(private readonly filePath: string) {
    this.state = this.load();
  }

  get current(): PersistedState {
    return this.state;
  }

  update(next: PersistedState): void {
    this.state = next;
    this.save();
  }

  private load(): PersistedState {
    if (!existsSync(this.filePath)) return initialState();
    try {
      const raw: unknown = JSON.parse(readFileSync(this.filePath, "utf8"));
      return sanitize(raw);
    } catch (err) {
      logger.warn(`State file illeggibile, riparto da zero: ${describeError(err)}`);
      return initialState();
    }
  }

  private save(): void {
    try {
      mkdirSync(dirname(this.filePath), { recursive: true });
      const tmp = `${this.filePath}.${process.pid}.tmp`;
      writeFileSync(tmp, JSON.stringify(this.state, null, 2) + "\n");
      renameSync(tmp, this.filePath);
    } catch (err) {
      // Lo stato in memoria resta valido: il watcher continua.
      logger.error("Salvataggio stato fallito", err);
    }
  }
}

/** Accetta solo campi noti e ben tipizzati; il resto torna ai default. */
function sanitize(raw: unknown): PersistedState {
  const base = initialState();
  if (typeof raw !== "object" || raw === null) return base;
  const r = raw as Record<string, unknown>;
  const str = (v: unknown): string | null => (typeof v === "string" ? v : null);
  const lastState = VALID_STATES.includes(r.lastState as WatcherState) ? (r.lastState as WatcherState) : base.lastState;
  const kind = r.problemAlertKind;
  return {
    lastState,
    lastCheck: str(r.lastCheck),
    lastAvailableAt: str(r.lastAvailableAt),
    lastNotificationAt: str(r.lastNotificationAt),
    armed: typeof r.armed === "boolean" ? r.armed : base.armed,
    consecutiveProblems:
      typeof r.consecutiveProblems === "number" && r.consecutiveProblems >= 0 ? Math.floor(r.consecutiveProblems) : 0,
    problemAlertKind: kind === "BLOCKED" || kind === "NETWORK_ERROR" || kind === "UNKNOWN" ? kind : null,
    lastTechnicalNotificationAt: str(r.lastTechnicalNotificationAt),
  };
}
