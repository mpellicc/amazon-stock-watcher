import type { WatcherState } from "../amazon/types.js";

/** Stato persistito su disco: sopravvive ai riavvii. */
export interface PersistedState {
  lastState: WatcherState;
  lastCheck: string | null;
  lastAvailableAt: string | null;
  lastNotificationAt: string | null;
  /**
   * true = una transizione verso AVAILABLE genera una notifica.
   * Si disarma dopo la notifica e si riarma solo osservando UNAVAILABLE:
   * così AVAILABLE -> NETWORK_ERROR -> AVAILABLE (o un riavvio) non manda doppioni.
   */
  armed: boolean;
  consecutiveProblems: number;
  /** Tipo di problema già notificato nell'episodio in corso (null = nessuno). */
  problemAlertKind: ProblemState | null;
  lastTechnicalNotificationAt: string | null;
}

export type ProblemState = "BLOCKED" | "NETWORK_ERROR" | "UNKNOWN";

export interface TechnicalPolicy {
  /** Problemi consecutivi (rete/pagina anomala) prima di un alert. BLOCKED avvisa subito. */
  problemAlertThreshold: number;
  cooldownMs: number;
}

export interface TransitionDecision {
  next: PersistedState;
  previous: WatcherState;
  changed: boolean;
  notifyAvailable: boolean;
  technicalAlert: ProblemState | null;
  /** Fine di un episodio di problemi per cui era partito un alert tecnico. */
  recoveredAfterAlert: boolean;
  /** Fine di un episodio di problemi (anche senza alert): utile per il log. */
  recovered: boolean;
}

export function initialState(): PersistedState {
  return {
    lastState: "STARTING",
    lastCheck: null,
    lastAvailableAt: null,
    lastNotificationAt: null,
    armed: true,
    consecutiveProblems: 0,
    problemAlertKind: null,
    lastTechnicalNotificationAt: null,
  };
}

export function isProblem(state: WatcherState): state is ProblemState {
  return state === "BLOCKED" || state === "NETWORK_ERROR" || state === "UNKNOWN";
}

/** Funzione pura: dato lo stato precedente e l'osservazione, decide cosa fare. */
export function applyObservation(
  prev: PersistedState,
  observed: WatcherState,
  now: Date,
  policy: TechnicalPolicy,
): TransitionDecision {
  const next: PersistedState = { ...prev, lastState: observed, lastCheck: now.toISOString() };
  let notifyAvailable = false;
  let technicalAlert: ProblemState | null = null;
  let recovered = false;
  let recoveredAfterAlert = false;

  if (observed === "AVAILABLE") {
    next.lastAvailableAt = now.toISOString();
    notifyAvailable = prev.armed;
  } else if (observed === "UNAVAILABLE") {
    next.armed = true;
  }

  if (isProblem(observed)) {
    next.consecutiveProblems = prev.consecutiveProblems + 1;
    const threshold = observed === "BLOCKED" ? 1 : policy.problemAlertThreshold;
    const alreadyAlerted = prev.problemAlertKind === observed;
    if (!alreadyAlerted && next.consecutiveProblems >= threshold && cooldownElapsed(prev, now, policy)) {
      technicalAlert = observed;
    }
  } else if (prev.consecutiveProblems > 0) {
    recovered = true;
    recoveredAfterAlert = prev.problemAlertKind !== null;
    next.consecutiveProblems = 0;
    next.problemAlertKind = null;
  }

  return {
    next,
    previous: prev.lastState,
    changed: prev.lastState !== observed,
    notifyAvailable,
    technicalAlert,
    recovered,
    recoveredAfterAlert,
  };
}

/** Da chiamare solo se la notifica di disponibilità è stata consegnata. */
export function markAvailableNotified(state: PersistedState, now: Date): PersistedState {
  return { ...state, armed: false, lastNotificationAt: now.toISOString() };
}

/** Da chiamare solo se l'alert tecnico è stato consegnato. */
export function markTechnicalNotified(state: PersistedState, kind: ProblemState, now: Date): PersistedState {
  return { ...state, problemAlertKind: kind, lastTechnicalNotificationAt: now.toISOString() };
}

function cooldownElapsed(state: PersistedState, now: Date, policy: TechnicalPolicy): boolean {
  if (!state.lastTechnicalNotificationAt) return true;
  const last = Date.parse(state.lastTechnicalNotificationAt);
  return Number.isNaN(last) || now.getTime() - last >= policy.cooldownMs;
}
