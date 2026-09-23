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
  /** Testo sintetico per la riga di log. */
  summary: string;
  durationMs: number;
}

// Attesa dopo domcontentloaded: il buybox a volte viene idratato via JS.
const CONTENT_SELECTOR = "#productTitle, #captchacharacters, form[action*='validateCaptcha']";
const BUYBOX_SELECTOR = "#availability, #add-to-cart-button, #buy-now-button, #outOfStock, #buybox";
const HEAVY_RESOURCES = new Set(["image", "media", "font"]);

/**
 * Tiene vivo un Chromium con profilo persistente e controlla la pagina prodotto.
 * Nessuna interazione con la pagina: solo navigazione e lettura del DOM.
 */
export class AmazonWatcher {
  private context: BrowserContext | null = null;
  private page: Page | null = null;
  private broken = false;
  private closing = false;

  constructor(private readonly opts: WatcherOptions) {}

  async start(): Promise<void> {
    await this.close();
    logger.info(`Avvio Chromium (headless=${this.opts.headless})`);
    // Contesto persistente: cookie/consenso restano tra i riavvii (sessione normale di un utente).
    const context = await chromium.launchPersistentContext(this.opts.profileDir, {
      headless: this.opts.headless,
      locale: "it-IT",
      timezoneId: "Europe/Rome",
      viewport: { width: 1366, height: 900 },
      // Lo shutdown lo gestisce index.ts: Playwright altrimenti fa process.exit(130) al primo SIGINT.
      handleSIGINT: false,
      handleSIGTERM: false,
    });
    context.on("close", () => this.markBroken("contesto browser chiuso"));
    context.setDefaultNavigationTimeout(this.opts.navigationTimeoutMs);
    context.setDefaultTimeout(this.opts.navigationTimeoutMs);

    if (this.opts.blockHeavyResources) {
      await context.route("**/*", (route) =>
        HEAVY_RESOURCES.has(route.request().resourceType()) ? route.abort() : route.continue(),
      );
    }

    const page = context.pages()[0] ?? (await context.newPage());
    page.on("crash", () => this.markBroken("pagina crashata"));
    page.on("close", () => this.markBroken("pagina chiusa"));

    this.context = context;
    this.page = page;
    this.broken = false;
  }

  /** true se browser/pagina vanno ricreati prima del prossimo check. */
  needsRestart(): boolean {
    return this.broken || !this.context || !this.page || this.page.isClosed();
  }

  /**
   * Naviga all'URL del prodotto e classifica la pagina.
   * Usa goto (non reload): se Amazon ci ha rediretti a CAPTCHA/errore, torniamo comunque al prodotto.
   */
  async check(): Promise<CheckOutcome> {
    const started = Date.now();
    const page = this.page;
    if (!page || this.needsRestart()) {
      return { state: "UNKNOWN", summary: "Browser non disponibile", durationMs: 0 };
    }

    try {
      const response = await page.goto(this.opts.url, { waitUntil: "domcontentloaded" });
      const status = response?.status();
      if (status && status >= 500) logger.debug(`HTTP ${status} da Amazon`);
      return await this.classifyCurrentPage(started);
    } catch (err) {
      const message = describeError(err);
      if (this.needsRestart() || /Target (page, context or browser )?closed|Browser has been closed/i.test(message)) {
        this.markBroken(message);
        return { state: "UNKNOWN", summary: `Browser non disponibile: ${message}`, durationMs: Date.now() - started };
      }
      return { state: "NETWORK_ERROR", summary: message, durationMs: Date.now() - started };
    }
  }

  /** Classifica la pagina attuale senza navigare (usato mentre si è BLOCKED). */
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
      logger.debug(`Chiusura browser: ${describeError(err)}`);
    } finally {
      this.closing = false;
    }
  }

  private async classifyCurrentPage(started: number): Promise<CheckOutcome> {
    const page = this.page;
    if (!page) throw new Error("Pagina non inizializzata");

    await page.waitForSelector(CONTENT_SELECTOR, { timeout: 10_000 }).catch(() => undefined);
    await page.waitForSelector(BUYBOX_SELECTOR, { timeout: 3_000 }).catch(() => undefined);

    const html = await page.content();
    let result: AvailabilityResult;
    try {
      result = detectAvailability(html, { expectedAsin: this.opts.asin });
    } catch (err) {
      // Un errore di parsing non è un problema di rete: la pagina è semplicemente anomala.
      return { state: "UNKNOWN", summary: `Parsing fallito: ${describeError(err)}`, durationMs: Date.now() - started };
    }
    return { state: result.state, result, summary: summarize(result), durationMs: Date.now() - started };
  }

  private markBroken(reason: string): void {
    if (this.closing) return;
    if (!this.broken) logger.warn(`Browser da ricreare: ${reason}`);
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
