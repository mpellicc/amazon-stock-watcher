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

/** Simula il Monitor: applica le osservazioni e marca come consegnate le notifiche. */
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

describe("transizioni di stato", () => {
  it("UNAVAILABLE -> AVAILABLE notifica una volta sola, AVAILABLE -> AVAILABLE no", () => {
    const { events } = simulate(["UNAVAILABLE", "AVAILABLE", "AVAILABLE", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@1"]);
  });

  it("AVAILABLE -> UNAVAILABLE -> AVAILABLE genera una nuova notifica", () => {
    const { events } = simulate(["UNAVAILABLE", "AVAILABLE", "UNAVAILABLE", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@1", "AVAILABLE@3"]);
  });

  it("STARTING/UNKNOWN -> AVAILABLE notifica", () => {
    expect(simulate(["AVAILABLE"]).events).toEqual(["AVAILABLE@0"]);
    expect(simulate(["UNKNOWN", "AVAILABLE"]).events).toEqual(["AVAILABLE@1"]);
  });

  it("un errore di rete in mezzo a AVAILABLE non rinotifica", () => {
    const { events } = simulate(["AVAILABLE", "NETWORK_ERROR", "AVAILABLE"]);
    expect(events).toEqual(["AVAILABLE@0"]);
  });

  it("dopo un riavvio in AVAILABLE non rinotifica (stato persistito)", () => {
    const first = simulate(["UNAVAILABLE", "AVAILABLE"]);
    const restarted = JSON.parse(JSON.stringify(first.state)) as PersistedState;
    expect(simulate(["AVAILABLE"], restarted).events).toEqual([]);
  });

  it("se Telegram fallisce resta armato e riprova al check successivo", () => {
    const d1 = applyObservation(initialState(), "AVAILABLE", at(0), policy);
    expect(d1.notifyAvailable).toBe(true);
    const d2 = applyObservation(d1.next, "AVAILABLE", at(10), policy);
    expect(d2.notifyAvailable).toBe(true);
  });

  it("1-2 errori di rete: nessun alert; alla soglia: un solo alert; poi recupero", () => {
    const { events } = simulate(["UNAVAILABLE", "NETWORK_ERROR", "NETWORK_ERROR", "NETWORK_ERROR", "NETWORK_ERROR", "UNAVAILABLE"]);
    expect(events).toEqual(["NETWORK_ERROR@3", "RECOVERED@5"]);
  });

  it("BLOCKED avvisa subito e una sola volta", () => {
    const { events } = simulate(["UNAVAILABLE", "BLOCKED", "BLOCKED", "BLOCKED"]);
    expect(events).toEqual(["BLOCKED@1"]);
  });

  it("il cooldown impedisce alert ravvicinati tra episodi diversi", () => {
    const { events } = simulate(["BLOCKED", "UNAVAILABLE", "BLOCKED"]);
    expect(events).toEqual(["BLOCKED@0", "RECOVERED@1"]);
  });

  it("recupero senza alert: nessun messaggio", () => {
    expect(simulate(["NETWORK_ERROR", "UNAVAILABLE"]).events).toEqual([]);
  });
});
