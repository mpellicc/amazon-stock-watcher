import { describe, expect, it } from "vitest";
import type { WatcherState } from "../src/amazon/types.js";
import {
  applyObservation,
  initialState,
  markAvailableNotified,
  markTechnicalNotified,
  type PersistedState,
} from "../src/state/transitions.js";

const policy = { problemAlertThreshold: 3, cooldownMs: 30 * 60_000 };
const t0 = new Date("2026-09-23T15:30:00Z");
const at = (sec: number): Date => new Date(t0.getTime() + sec * 1000);

/** Simulates the Monitor: applies the observations and marks notifications as delivered. */
function simulate(states: WatcherState[], start: PersistedState = initialState()) {
  let s = start;
  const events: string[] = [];
  states.forEach((obs, i) => {
    const now = at(i * 10);
    const d = applyObservation(s, obs, now, policy);
    s = d.next;
    if (d.notifyAvailable) {
      events.push(`AVAILABLE@${i}`);
      s = markAvailableNotified(s, now);
    }
    if (d.technicalAlert) {
      events.push(`${d.technicalAlert}@${i}`);
      s = markTechnicalNotified(s, d.technicalAlert, now);
    }
    if (d.recoveredAfterAlert) events.push(`RECOVERED@${i}`);
  });
  return { state: s, events };
}

describe("state transitions", () => {
  it("UNAVAILABLE -> AVAILABLE notifies once, AVAILABLE -> AVAILABLE does not", () => {
    const { events } = simulate(["UNAVAILABLE", "AVAILABLE", "AVAILABLE", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@1"]);
  });

  it("AVAILABLE -> UNAVAILABLE -> AVAILABLE triggers a new notification", () => {
    const { events } = simulate(["UNAVAILABLE", "AVAILABLE", "UNAVAILABLE", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@1", "AVAILABLE@3"]);
  });

  it("STARTING/UNKNOWN -> AVAILABLE notifies", () => {
    expect(simulate(["AVAILABLE"]).events).toEqual(["AVAILABLE@0"]);
    expect(simulate(["UNKNOWN", "AVAILABLE"]).events).toEqual(["AVAILABLE@1"]);
  });

  it("a network error in the middle of AVAILABLE does not re-notify", () => {
    const { events } = simulate(["AVAILABLE", "NETWORK_ERROR", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@0"]);
  });

  it("after a restart while AVAILABLE it does not re-notify (persisted state)", () => {
    const first = simulate(["UNAVAILABLE", "AVAILABLE"]);
    const restarted = JSON.parse(JSON.stringify(first.state)) as PersistedState;
    expect(simulate(["AVAILABLE"], restarted).events).toEqual([]);
  });

  it("if Telegram fails it stays armed and retries on the next check", () => {
    const d1 = applyObservation(initialState(), "AVAILABLE", at(0), policy);
    expect(d1.notifyAvailable).toBe(true);
    const d2 = applyObservation(d1.next, "AVAILABLE", at(10), policy);
    expect(d2.notifyAvailable).toBe(true);
  });

  it("1-2 network errors: no alert; at the threshold: a single alert; then recovery", () => {
    const { events } = simulate(["UNAVAILABLE", "NETWORK_ERROR", "NETWORK_ERROR", "NETWORK_ERROR", "NETWORK_ERROR", "UNAVAILABLE"]);
    expect(events).toEqual(["NETWORK_ERROR@3", "RECOVERED@5"]);
  });

  it("BLOCKED alerts immediately and only once", () => {
    const { events } = simulate(["UNAVAILABLE", "BLOCKED", "BLOCKED", "BLOCKED"]);
    expect(events).toEqual(["BLOCKED@1"]);
  });

  it("the cooldown prevents close alerts across different episodes", () => {
    const { events } = simulate(["BLOCKED", "UNAVAILABLE", "BLOCKED"]);
    expect(events).toEqual(["BLOCKED@0", "RECOVERED@1"]);
  });

  it("recovery without an alert: no message", () => {
    expect(simulate(["NETWORK_ERROR", "UNAVAILABLE"]).events).toEqual([]);
  });
});
