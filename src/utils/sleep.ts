/** Sleep interrompibile: risolve subito se il segnale viene abortito (shutdown). */
export function sleep(ms: number, signal?: AbortSignal): Promise<void> {
  return new Promise((resolve) => {
    if (signal?.aborted) return resolve();
    const timer = setTimeout(done, ms);
    function done(): void {
      clearTimeout(timer);
      signal?.removeEventListener("abort", done);
      resolve();
    }
    signal?.addEventListener("abort", done, { once: true });
  });
}

/** Intero casuale uniforme in [min, max]. */
export function randomBetween(min: number, max: number): number {
  return Math.floor(min + Math.random() * (max - min + 1));
}
