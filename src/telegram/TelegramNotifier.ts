import type { TelegramConfig } from "../config.js";
import { describeError, logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

interface InlineButton {
  text: string;
  url: string;
}

interface TelegramResponse {
  ok: boolean;
  description?: string;
  parameters?: { retry_after?: number };
}

export class TelegramNotifier {
  constructor(
    private readonly config: TelegramConfig,
    private readonly productUrl: string,
  ) {}

  /** Messaggio con il bottone "🛒 APRI SU AMAZON". Restituisce true se consegnato. */
  sendWithAmazonButton(text: string): Promise<boolean> {
    return this.send(text, { text: "🛒 APRI SU AMAZON", url: this.productUrl });
  }

  sendPlain(text: string): Promise<boolean> {
    return this.send(text);
  }

  private async send(text: string, button?: InlineButton): Promise<boolean> {
    const body = {
      chat_id: this.config.chatId,
      text,
      disable_web_page_preview: true,
      ...(button ? { reply_markup: { inline_keyboard: [[button]] } } : {}),
    };

    for (let attempt = 1; attempt <= MAX_ATTEMPTS; attempt++) {
      try {
        // L'URL contiene il token: non va mai loggato né incluso negli errori.
        const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/sendMessage`, {
          method: "POST",
          headers: { "content-type": "application/json" },
          body: JSON.stringify(body),
          signal: AbortSignal.timeout(REQUEST_TIMEOUT_MS),
        });
        const data = (await res.json().catch(() => ({ ok: false }))) as TelegramResponse;
        if (res.ok && data.ok) return true;

        logger.warn(`Telegram ha risposto ${res.status}: ${data.description ?? "errore sconosciuto"} (tentativo ${attempt})`);
        // Errori di configurazione (token/chat errati): inutile riprovare.
        if (res.status === 400 || res.status === 401 || res.status === 403 || res.status === 404) return false;
        const retryAfterMs = (data.parameters?.retry_after ?? 0) * 1000;
        if (attempt < MAX_ATTEMPTS) await sleep(Math.max(retryAfterMs, 1000 * attempt));
      } catch (err) {
        logger.warn(`Telegram non raggiungibile: ${describeError(err)} (tentativo ${attempt})`);
        if (attempt < MAX_ATTEMPTS) await sleep(1000 * attempt);
      }
    }
    return false;
  }
}
