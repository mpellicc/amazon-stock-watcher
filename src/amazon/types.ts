/** Esito della classificazione di una singola pagina. */
export type DetectedState = "AVAILABLE" | "UNAVAILABLE" | "BLOCKED" | "UNKNOWN";

/** Stato completo del watcher: include gli stati tecnici non derivabili dalla pagina. */
export type WatcherState = "STARTING" | DetectedState | "NETWORK_ERROR";

export interface AvailabilitySignals {
  addToCart: boolean;
  buyNow: boolean;
  preorder: boolean;
  availabilityPositive: boolean;
  availabilityNegative: boolean;
  captchaDetected: boolean;
}

export interface AvailabilityResult {
  state: DetectedState;
  title?: string;
  availabilityText?: string;
  /** Etichetta del bottone d'acquisto più rilevante (es. "Preordina ora"). */
  buttonLabel?: string;
  /** Venditore mostrato nel buybox, se identificabile. */
  merchant?: string;
  signals: AvailabilitySignals;
  reason: string;
}
