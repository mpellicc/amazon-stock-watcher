import { describeError, logger } from "../utils/logger.js";
import { sleep } from "../utils/sleep.js";
import type { TelegramNotifier, TelegramUpdate } from "./TelegramNotifier.js";

/*
 * Telegram commands via long polling (getUpdates): no open ports, no webhook.
 * Only the configured chat gets answers; messages from anyone else are ignored.
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
  { command: "recap", description: "Recap now · /recap N = recap every N hours (0 = off)" },
  { command: "check", description: "Runs a check right now and reports the result" },
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
          // Another process (or a webhook) is reading the same bot.
          if (!this.conflictWarned) logger.warn("Telegram commands unavailable: another process is using the same bot");
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
        logger.debug(`Telegram command polling: ${describeError(err)} (retrying in ${backoff / 1000}s)`);
        await sleep(backoff, signal);
        backoff = Math.min(backoff * 2, BACKOFF_MAX_MS);
      }
    }
  }

  private async handle(update: TelegramUpdate): Promise<void> {
    const message = update.message;
    if (!message?.text || !this.isOwnChat(message.chat)) return;
    // "/recap@MyBot 4" → ["recap", "4"]
    const [rawCommand = "", arg] = message.text.trim().split(/\s+/);
    const command = rawCommand.replace(/^\//, "").replace(/@.*$/, "").toLowerCase();

    let reply: CommandReply;
    try {
      if (command === "recap" && arg !== undefined) reply = this.parseInterval(arg);
      else if (command === "recap") reply = await this.handlers.recap();
      else if (command === "check") reply = await this.handlers.check();
      else return;
    } catch (err) {
      reply = { text: `⚠️ Command /${command} failed: ${describeError(err)}` };
    }
    logger.info(`Telegram command /${command}${arg ? ` ${arg}` : ""}`);
    const sent = reply.withAmazonButton
      ? await this.telegram.sendWithAmazonButton(reply.text)
      : await this.telegram.sendPlain(reply.text);
    if (!sent) logger.warn(`Reply to /${command} not delivered`);
  }

  private parseInterval(arg: string): CommandReply {
    const hours = Number(arg.replace(",", "."));
    if (!Number.isFinite(hours) || hours < 0 || hours > 168) {
      return { text: "Usage: /recap N — N hours between recaps (0 = disabled, max 168)" };
    }
    return this.handlers.setRecapInterval(hours);
  }

  private isOwnChat(chat: { id: number; username?: string }): boolean {
    const configured = this.telegram.chatId;
    return String(chat.id) === configured || (chat.username !== undefined && `@${chat.username}` === configured);
  }

  /** Ignores commands sent while the watcher was off: running them now would be misleading. */
  private async skipPendingUpdates(signal: AbortSignal): Promise<void> {
    try {
      const { data } = await this.telegram.call<TelegramUpdate[]>("getUpdates", { offset: -1, timeout: 0 }, 10_000, signal);
      const last = data.result?.at(-1);
      if (last) this.offset = last.update_id + 1;
    } catch (err) {
      logger.debug(`Reading pending commands failed: ${describeError(err)}`);
    }
  }

  private async registerCommands(): Promise<void> {
    try {
      await this.telegram.call("setMyCommands", { commands: BOT_COMMANDS });
    } catch (err) {
      logger.debug(`Registering the command menu failed: ${describeError(err)}`);
    }
  }
}
