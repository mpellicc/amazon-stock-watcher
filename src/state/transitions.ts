import type { WatcherState } from "../amazon/types.js";

/** State persisted to disk: survives restarts. */
export interface PersistedState {
  lastState: WatcherState;
  lastCheck: string | null;
  lastAvailableAt: string | null;
  lastNotificationAt: string | null;
  /**
   * true = a transition to AVAILABLE triggers a notification.
   * Disarmed after the notification, re-armed only when UNAVAILABLE is observed:
   * so AVAILABLE -> NETWORK_ERROR -> AVAILABLE (or a restart) sends no duplicates.
   */
  armed: boolean;
  consecutiveProblems: number;
  /** Problem kind already notified in the current episode (null = none). */
  problemAlertKind: ProblemState | null;
  lastTechnicalNotificationAt: string | null;
}

export type ProblemState = "BLOCKED" | "NETWORK_ERROR" | "UNKNOWN";

export interface TechnicalPolicy {
  /** Consecutive problems (network/anomalous page) before an alert. BLOCKED alerts immediately. */
  problemAlertThreshold: number;
  cooldownMs: number;
}

export interface TransitionDecision {
  next: PersistedState;
  previous: WatcherState;
  changed: boolean;
  notifyAvailable: boolean;
  technicalAlert: ProblemState | null;
  /** End of a problem episode for which a technical alert was sent. */
  recoveredAfterAlert: boolean;
  /** End of a problem episode (even without an alert): useful for logging. */
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

/** Pure function: given the previous state and the observation, decides what to do. */
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

/** Call only if the availability notification was delivered. */
export function markAvailableNotified(state: PersistedState, now: Date): PersistedState {
  return { ...state, armed: false, lastNotificationAt: now.toISOString() };
}

/** Call only if the technical alert was delivered. */
export function markTechnicalNotified(state: PersistedState, kind: ProblemState, now: Date): PersistedState {
  return { ...state, problemAlertKind: kind, lastTechnicalNotificationAt: now.toISOString() };
}

function cooldownElapsed(state: PersistedState, now: Date, policy: TechnicalPolicy): boolean {
  if (!state.lastTechnicalNotificationAt) return true;
  const last = Date.parse(state.lastTechnicalNotificationAt);
  return Number.isNaN(last) || now.getTime() - last >= policy.cooldownMs;
}
