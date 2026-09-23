/**
 * Singolo controllo della pagina reale, senza notifiche né modifica dello stato.
 * Utile per verificare la detection: npm run test:amazon (aggiungi --headed per vedere il browser).
 */
import { AmazonWatcher } from "../amazon/AmazonWatcher.js";
import { explainResult } from "../amazon/availabilityDetector.js";
import { ConfigError, loadConfig } from "../config.js";

try {
  const config = loadConfig({ requireTelegram: false });
  const watcher = new AmazonWatcher({
    url: config.amazonUrl,
    asin: config.asin,
    headless: process.argv.includes("--headed") ? false : config.headless,
    navigationTimeoutMs: config.navigationTimeoutMs,
    blockHeavyResources: config.blockHeavyResources,
    profileDir: config.paths.browserProfileDir,
  });
  await watcher.start();
  const outcome = await watcher.check();
  await watcher.close();

  console.log(`\nStato:  ${outcome.state}  (${outcome.durationMs} ms)`);
  console.log(`Titolo: ${outcome.result?.title ?? "-"}`);
  console.log(outcome.result ? explainResult(outcome.result).replaceAll('" ', '"\n') : outcome.summary);
  process.exit(0);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
