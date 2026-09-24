/**
 * Single check of the real page, with no notifications and no state changes.
 * Useful to verify detection: npm run test:amazon (-- -p <url> for another product, -- --headed to see the browser).
 */
import { AmazonWatcher } from "../amazon/AmazonWatcher.js";
import { explainResult } from "../amazon/availabilityDetector.js";
import { defaultProductUrl, parseCliArgs, promptProductUrl } from "../cli.js";
import { ConfigError, loadConfig, withProduct } from "../config.js";

try {
  const args = parseCliArgs();
  let config = loadConfig({ requireTelegram: false, productUrl: args.product, requireProduct: false });
  if (!config.asin) {
    if (!process.stdin.isTTY) throw new ConfigError(["No product: pass -p <url> or set AMAZON_URL in .env"]);
    config = withProduct(config, await promptProductUrl(defaultProductUrl()));
  }
  const watcher = new AmazonWatcher({
    url: config.amazonUrl,
    asin: config.asin,
    headless: args.headed ? false : config.headless,
    navigationTimeoutMs: config.navigationTimeoutMs,
    blockHeavyResources: config.blockHeavyResources,
    profileDir: config.paths.browserProfileDir,
  });
  await watcher.start();
  const outcome = await watcher.check();
  await watcher.close();

  console.log(`\nState:  ${outcome.state}  (${outcome.durationMs} ms)`);
  console.log(`Title:  ${outcome.result?.title ?? "-"}`);
  console.log(outcome.result ? explainResult(outcome.result).replaceAll('" ', '"\n') : outcome.summary);
  process.exit(0);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
