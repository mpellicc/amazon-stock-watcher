/** Outcome of classifying a single page. */
export type DetectedState = "AVAILABLE" | "UNAVAILABLE" | "BLOCKED" | "UNKNOWN";

/** Full watcher state: also includes technical states that cannot be derived from the page. */
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
  /** Label of the most relevant purchase button (e.g. "Preordina ora"). */
  buttonLabel?: string;
  /** Seller shown in the buybox, when identifiable. */
  merchant?: string;
  signals: AvailabilitySignals;
  reason: string;
}
