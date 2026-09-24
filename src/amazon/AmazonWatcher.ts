import { chromium, type BrowserContext, type Page } from "playwright";
import { describeError, logger } from "../utils/logger.js";
import { detectAvailability } from "./availabilityDetector.js";
import type { AvailabilityResult, WatcherState } from "./types.js";

export interface WatcherOptions {
  url: string;
  asin: string;
  headless: boolean;
  navigationTimeoutMs: number;
  blockHeavyResources: boolean;
  profileDir: string;
}

export interface CheckOutcome {
  state: WatcherState;
  result?: AvailabilityResult;
  /** Short text for the log line. */
  summary: string;
  durationMs: number;
}

// Wait after domcontentloaded: the buybox is sometimes hydrated via JS.
const CONTENT_SELECTOR = "#productTitle, #captchacharacters, form[action*='validateCaptcha']";
const BUYBOX_SELECTOR = "#availability, #add-to-cart-button, #buy-now-button, #outOfStock, #buybox";
const HEAVY_RESOURCES = new Set(["image", "media", "font"]);

/**
 * Keeps a Chromium with a persistent profile alive and checks the product page.
 * No interaction with the page: navigation and DOM reading only.
 */
export class AmazonWatcher {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private broken = false;
  private closing = false;

  constructor(private readonly opts: WatcherOptions) {}

  async start(): Promise<void> {
    await this.close();
    logger.info(`Starting Chromium (headless=${this.opts.headless})`);
    // Persistent context: cookies/consent survive restarts (a normal user session).
    const context = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: this.opts.headless,
      locale: "it-IT",
      timezoneId: "Europe/Rome",
      viewport: { width: 1366, height: 900 },
      // Shutdown is handled by index.ts: otherwise Playwright calls process.exit(130) on the first SIGINT.
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    context.on("close", () => this.markBroken("browser context closed"));
    context.setDefaultNavigationTimeout(this.opts.navigationTimeoutMs);
    context.setDefaultTimeout(this.opts.navigationTimeoutMs);

    if (this.opts.blockHeavyResources) {
      await context.route("**/*", (route) =>
        HEAVY_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    page.on("crash", () => this.markBroken("page crashed"));
    page.on("close", () => this.markBroken("page closed"));

    this.context = context;
    this.page = page;
    this.broken = false;
  }

  /** true if browser/page must be recreated before the next check. */
  needsRestart(): boolean {
    return this.broken || !this.context || !this.page || this.page.isClosed();
  }

  /**
   * Navigates to the product URL and classifies the page.
   * Uses goto (not reload): if Amazon redirected us to a CAPTCHA/error page, we still go back to the product.
   */
  async check(): Promise<CheckOutcome> {
    const started = Date.now();
    const page = this.page;
    if (!page || this.needsRestart()) {
      return { state: "UNKNOWN", summary: "Browser not available", durationMs: 0 };
    }

    try {
      const response = await page.goto(this.opts.url, { waitUntil: "domcontentloaded" });
      const status = response?.status();
      if (status && status >= 500) logger.debug(`HTTP ${status} from Amazon`);
      return await this.classifyCurrentPage(started);
    } catch (err) {
      const message = describeError(err);
      if (this.needsRestart() || /Target (page, context or browser )?closed|Browser has been closed/i.test(message)) {
        this.markBroken(message);
        return { state: "UNKNOWN", summary: `Browser not available: ${message}`, durationMs: Date.now() - started };
      }
      return { state: "NETWORK_ERROR", summary: message, durationMs: Date.now() - started };
    }
  }

  /** Classifies the current page without navigating (used while BLOCKED). */
  async inspectCurrentPage(): Promise<CheckOutcome> {
    const started = Date.now();
    try {
      return await this.classifyCurrentPage(started);
    } catch (err) {
      return { state: "UNKNOWN", summary: describeError(err), durationMs: Date.now() - started };
    }
  }

  async close(): Promise<void> {
    const context = this.context;
    this.context = null;
    this.page = null;
    if (!context) return;
    this.closing = true;
    try {
      await context.close();
    } catch (err) {
      logger.debug(`Closing browser: ${describeError(err)}`);
    } finally {
      this.closing = false;
    }
  }

  private async classifyCurrentPage(started: number): Promise<CheckOutcome> {
    const page = this.page;
    if (!page) throw new Error("Page not initialized");

    await page.waitForSelector(CONTENT_SELECTOR, { timeout: 10_000 }).catch(() => undefined);
    await page.waitForSelector(BUYBOX_SELECTOR, { timeout: 3_000 }).catch(() => undefined);

    const html = await page.content();
    let result: AvailabilityResult;
    try {
      result = detectAvailability(html, { expectedAsin: this.opts.asin });
    } catch (err) {
      // A parsing error is not a network problem: the page is simply anomalous.
      return { state: "UNKNOWN", summary: `Parsing failed: ${describeError(err)}`, durationMs: Date.now() - started };
    }
    return { state: result.state, result, summary: summarize(result), durationMs: Date.now() - started };
  }

  private markBroken(reason: string): void {
    if (this.closing) return;
    if (!this.broken) logger.warn(`Browser needs to be recreated: ${reason}`);
    this.broken = true;
  }
}

function summarize(r: AvailabilityResult): string {
  switch (r.state) {
    case "AVAILABLE":
      return r.buttonLabel ?? r.availabilityText ?? r.reason;
    case "UNAVAILABLE":
      return r.availabilityText ?? r.reason;
    default:
      return r.reason;
  }
}
