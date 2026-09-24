import { describeError, logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import type { TelegramNotifier, TelegramUpdate } from "./TelegramNotifier.js";

/*
 * Comandi Telegram via long polling (getUpdates): nessuna porta aperta, nessun webhook.
 * Si risponde solo alla chat configurata; i messaggi di chiunque altro vengono ignorati.
 */

const POLL_TIMEOUT_SEC = 30;
const BACKOFF_MIN_MS = 5_000;
const BACKOFF_MAX_MS = 60_000;

export interface CommandReply {
  text: string;
  withAmazonButton?: boolean;
}

export interface CommandHandlers {
  recap(): Promise<CommandReply>;
  setRecapInterval(hours: number): CommandReply;
  check(): Promise<CommandReply>;
}

export const BOT_COMMANDS = [
  { command: "recap", description: "Recap ora · /recap N = recap ogni N ore (0 = off)" },
  { command: "check", description: "Esegue subito un check e ne riporta l'esito" },
];

export class TelegramCommands {
  private offset = 0;
  private conflictWarned = false;

  constructor(
    private readonly telegram: TelegramNotifier,
    private readonly handlers: CommandHandlers,
  ) {}

  async run(signal: AbortSignal): Promise<void> {
    await this.registerCommands();
    await this.skipPendingUpdates(signal);
    let backoff = BACKOFF_MIN_MS;

    while (!signal.aborted) {
      try {
        const { status, data } = await this.telegram.call<TelegramUpdate[]>(
          "getUpdates",
          { offset: this.offset, timeout: POLL_TIMEOUT_SEC, allowed_updates: ["message"] },
          (POLL_TIMEOUT_SEC + 10) * 1000,
          signal,
        );
        if (status === 409) {
          // Un altro processo (o un webhook) sta leggendo lo stesso bot.
          if (!this.conflictWarned) logger.warn("Comandi Telegram non disponibili: un altro processo sta usando lo stesso bot");
          this.conflictWarned = true;
          await sleep(BACKOFF_MAX_MS, signal);
          continue;
        }
        if (!data.ok || !data.result) throw new Error(`getUpdates: ${status} ${data.description ?? ""}`);
        backoff = BACKOFF_MIN_MS;
        for (const update of data.result) {
          this.offset = update.update_id + 1;
          await this.handle(update);
        }
      } catch (err) {
        if (signal.aborted) break;
        logger.debug(`Polling comandi Telegram: ${describeError(err)} (riprovo tra ${backoff / 1000}s)`);
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || !this.isOwnChat(message.chat)) return;
    // "/recap@NomeBot 4" → ["recap", "4"]
    const [rawCommand = "", arg] = message.text.trim().split(/\s+/);
    const command = rawCommand.replace(/^\//, "").replace(/@.*$/, "").toLowerCase();

    let reply: CommandReply;
    try {
      if (command === "recap" && arg !== undefined) reply = this.parseInterval(arg);
      else if (command === "recap") reply = await this.handlers.recap();
      else if (command === "check") reply = await this.handlers.check();
      else return;
    } catch (err) {
      reply = { text: `⚠️ Comando /${command} fallito: ${describeError(err)}` };
    }
    logger.info(`Comando Telegram /${command}${arg ? ` ${arg}` : ""}`);
    const sent = reply.withAmazonButton
      ? await this.telegram.sendWithAmazonButton(reply.text)
      : await this.telegram.sendPlain(reply.text);
    if (!sent) logger.warn(`Risposta a /${command} non consegnata`);
  }

  private parseInterval(arg: string): CommandReply {
    const hours = Number(arg.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      return { text: "Uso: /recap N — N ore tra un recap e l'altro (0 = disattivato, max 168)" };
    }
    return this.handlers.setRecapInterval(hours);
  }

  private isOwnChat(chat: { id: number; username?: string }): boolean {
    const configured = this.telegram.chatId;
    return String(chat.id) === configured || (chat.username !== undefined && `@${chat.username}` === configured);
  }

  /** Ignora i comandi inviati mentre il watcher era spento: eseguirli ora sarebbe fuorviante. */
  private async skipPendingUpdates(signal: AbortSignal): Promise<void> {
    try {
      const { data } = await this.telegram.call<TelegramUpdate[]>("getUpdates", { offset: -1, timeout: 0 }, 10_000, signal);
      const last = data.result?.at(-1);
      if (last) this.offset = last.update_id + 1;
    } catch (err) {
      logger.debug(`Lettura comandi pendenti fallita: ${describeError(err)}`);
    }
  }

  private async registerCommands(): Promise<void> {
    try {
      await this.telegram.call("setMyCommands", { commands: BOT_COMMANDS });
    } catch (err) {
      logger.debug(`Registrazione menu comandi fallita: ${describeError(err)}`);
    }
  }
}
