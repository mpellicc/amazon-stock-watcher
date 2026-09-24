import { ConfigError, loadConfig } from "../config.js";
import { telegramTestMessage } from "../notifications/messages.js";
import { TelegramNotifier } from "../telegram/TelegramNotifier.js";

const FALLBACK_URL = "https://www.amazon.it";

try {
  const config = loadConfig({ requireTelegram: true, requireProduct: false });
  if (!config.telegram) throw new Error("Telegram is not configured");
  const notifier = new TelegramNotifier(config.telegram, config.amazonUrl || FALLBACK_URL);
  const ok = await notifier.sendWithAmazonButton(telegramTestMessage());
  console.log(ok ? "✅ Test message sent: check Telegram." : "❌ Sending failed: check the token and chat_id.");
  process.exit(ok ? 0 : 1);
} catch (err) {
  console.error(err instanceof ConfigError ? err.message : err);
  process.exit(1);
}
