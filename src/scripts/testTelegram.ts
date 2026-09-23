import { ConfigError, loadConfig } from "../config.js";
import { telegramTestMessage } from "../notifications/messages.js";
import { TelegramNotifier } from "../telegram/TelegramNotifier.js";

try {
  const config = loadConfig({ requireTelegram: true });
  if (!config.telegram) throw new Error("Telegram non configurato");
  const ok = await new TelegramNotifier(config.telegram, config.amazonUrl).sendWithAmazonButton(telegramTestMessage());
  console.log(ok ? "✅ Messaggio di test inviato: controlla Telegram." : "❌ Invio fallito: controlla token e chat_id.");
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
