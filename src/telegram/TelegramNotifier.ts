import type { TelegramConfig } from "../config.js";
import { describeError, logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";

const REQUEST_TIMEOUT_MS = 10_000;
const MAX_ATTEMPTS = 3;

interface InlineButton {
  text: string;
  url: string;
}

export interface TelegramResponse<T = unknown> {
  ok: boolean;
  result?: T;
  description?: string;
  error_code?: number;
  parameters?: { retry_after?: number };
}

export interface TelegramUpdate {
  update_id: number;
  message?: { text?: string; chat: { id: number; username?: string } };
}

export class TelegramNotifier {
  constructor(
    private readonly config: TelegramConfig,
    private readonly productUrl: string,
  ) {}

  get chatId(): string {
    return this.config.chatId;
  }

  /** Messaggio con il bottone "🛒 APRI SU AMAZON". Restituisce true se consegnato. */
  sendWithAmazonButton(text: string): Promise<boolean> {
    return this.send(text, { text: "🛒 APRI SU AMAZON", url: this.productUrl });
  }

  sendPlain(text: string): Promise<boolean> {
    return this.send(text);
  }

  /**
   * Chiamata grezza alla Bot API. Lancia solo su errori di rete/timeout.
   * L'URL contiene il token: non va mai loggato né incluso negli errori.
   */
  async call<T>(method: string, body: object, timeoutMs = REQUEST_TIMEOUT_MS, signal?: AbortSignal): Promise<{ status: number; data: TelegramResponse<T> }> {
    const timeout = AbortSignal.timeout(timeoutMs);
    const res = await fetch(`https://api.telegram.org/bot${this.config.botToken}/${method}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify(body),
      signal: signal ? AbortSignal.any([signal, timeout]) : timeout,
    });
    const data = (await res.json().catch(() => ({ ok: false }))) as TelegramResponse<T>;
    return { status: res.status, data };
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
        const { status, data } = await this.call("sendMessage", body);
        if (status === 200 && data.ok) return true;

        logger.warn(`Telegram ha risposto ${status}: ${data.description ?? "errore sconosciuto"} (tentativo ${attempt})`);
        // Errori di configurazione (token/chat errati): inutile riprovare.
        if (status === 400 || status === 401 || status === 403 || status === 404) return false;
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
