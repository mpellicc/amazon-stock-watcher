# amazon-stock-watcher

🇬🇧 [English](README.md) | 🇮🇹 **Italiano**

![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-43853d?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Last Commit](https://img.shields.io/github/last-commit/mpellicc/amazon-stock-watcher)
![GitHub Stars](https://img.shields.io/github/stars/mpellicc/amazon-stock-watcher?style=flat)

Un watcher locale che mantiene aperto un vero Chromium (Playwright), controlla una pagina prodotto Amazon a intervalli casuali
(default 9-14 s) e ti avvisa **subito su Telegram** (più un suono locale e, opzionalmente, l'apertura del browser)
quando il prodotto passa da _non acquistabile_ a _acquistabile/preordinabile_. Puoi interrogarlo da remoto con i comandi
del bot (`/recap`, `/check`) e invia anche un recap periodico.

> [!TIP]
> Avvio rapido:
> 1. `npm install`
> 2. `npx playwright install chromium`
> 3. `cp .env.example .env` e configura i valori Telegram
> 4. `npm run test:telegram`
> 5. `npm run dev` (oppure `npm run build && npm start`)

> [!IMPORTANT]
> **Non compra mai nulla.** Nessun login, carrello, checkout o acquisto automatico.
> Nessun bypass CAPTCHA, stealth, proxy o fingerprint spoofing: se Amazon chiede una verifica il watcher va in `BLOCKED` e te lo segnala.

Il prodotto viene scelto all'avvio (vedi [Scelta del prodotto](#scelta-del-prodotto)).

---

## Requisiti

- **Node.js 22+** (tested with Node 24 LTS)
- **Playwright's Chromium** (`npx playwright install chromium`)
- A **Telegram bot** and your `chat_id`

## Configurazione

```bash
git clone https://github.com/mpellicc/amazon-stock-watcher.git
cd amazon-stock-watcher
npm install
npx playwright install chromium
cp .env.example .env
# fill in TELEGRAM_BOT_TOKEN and TELEGRAM_CHAT_ID in .env
npm run test:telegram   # you should receive "✅ Telegram is configured correctly."
```

### Creazione del bot Telegram

1. On Telegram open **@BotFather** and send `/newbot`.
2. Pick a name and a username (it must end in `bot`).
3. BotFather replies with the **token** (`123456789:AA...`): put it in `TELEGRAM_BOT_TOKEN`.
4. Open the chat with your new bot and press **Start** / send any message (otherwise the bot cannot write to you).

### Ottenere il `chat_id`

After writing to the bot, open this in a browser (replace the token):

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Look for `"chat":{"id":123456789,...}`: that number is the `TELEGRAM_CHAT_ID`.
Alternatively, write to **@userinfobot**, which replies with your id.

## Configurazione (`.env`)

| Variable                                        | Default          | Description                                                                        |
| ----------------------------------------------- | ---------------- | ---------------------------------------------------------------------------------- |
| `AMAZON_URL`                                    | —                | Default product, used when there is no `-p` and no terminal to ask in              |
| `TELEGRAM_BOT_TOKEN`                            | —                | **Required**                                                                       |
| `TELEGRAM_CHAT_ID`                              | —                | **Required**                                                                       |
| `MIN_POLL_INTERVAL_MS` / `MAX_POLL_INTERVAL_MS` | `9000` / `14000` | Random wait between checks (minimum 3000)                                          |
| `HEADLESS`                                      | `true`           | `false` = visible Chromium window                                                  |
| `LOCAL_SOUND_ENABLED`                           | `true`           | Local sound when the product becomes available                                     |
| `OPEN_BROWSER_ON_AVAILABLE`                     | `false`          | Opens the URL in the default browser                                               |
| `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES`       | `30`             | Minimum gap between two technical alerts                                           |
| `RECAP_INTERVAL_HOURS`                          | `4`              | Telegram recap every N hours (`0` = disabled). Can be changed live with `/recap N` |
| `STARTUP_ANIMATION`                             | `true`           | Full-window startup animation in the terminal (Enter skips it)                     |
| `LOG_LEVEL`                                     | `info`           | `debug` shows the detector signals on every check                                  |
| `PROBLEM_ALERT_THRESHOLD`                       | `6`              | Consecutive errors before a technical alert (~1 min)                               |
| `NAVIGATION_TIMEOUT_MS`                         | `30000`          | Navigation timeout                                                                 |
| `BLOCKED_RETRY_INTERVAL_MS`                     | `120000`         | How often to retry navigation while `BLOCKED`                                      |
| `BLOCK_HEAVY_RESOURCES`                         | `true`           | Skips images/fonts/video: faster checks                                            |

The configuration is validated at startup: if something is missing you get a clear message and the process exits.

## Esecuzione

### Scelta del prodotto

In order of precedence:

1. the `-p` / `--product` flag: `npm start -- -p "https://www.amazon.it/dp/B0XXXXXXXX"`;
2. in a terminal, a prompt right after the logo: Enter confirms the last product used (or `AMAZON_URL`);
3. `AMAZON_URL` in `.env`: the only option under pm2, launchd or systemd, where there is nobody to ask.

Any Amazon product URL works (with the product name, `ref=`, query parameters…): the ASIN is extracted and the URL normalized to `/dp/<ASIN>`. Short `amzn.eu` links are not supported.
Each product has its own state (`data/state-<ASIN>.json`), so switching product does not inherit "disarmed" from the previous one.

### Telegram: recap e comandi

- **Recap** every `RECAP_INTERVAL_HOURS` hours: state, checks in the period, average latency, blocks, network errors, uptime.
- **Commands** (shown in the bot's `/` menu, answered only for your `TELEGRAM_CHAT_ID`):
  - `/recap`: immediate recap;
  - `/recap N`: recap every N hours from now (`0` = off). Lasts until restart;
  - `/check`: immediate check with its result.
- Commands sent while the watcher was off are ignored at startup.
- A bot can only be read by one process: with two watchers on the same bot, commands work on just one of them (the other logs it).
- To see what is going on when commands do not answer (PC off, crash), use a remote desktop, e.g. Chrome Remote Desktop or RustDesk. It also lets you solve a CAPTCHA while away from home, with `HEADLESS=false`.

### Script npm

Development (TypeScript directly):

```bash
npm run dev
```

Production:

```bash
npm run build
npm start
```

Other scripts:

```bash
npm test                # unit tests (detector + state machine), no network
npm run typecheck       # tsc on sources and tests
npm run test:telegram   # test message with the "🛒 OPEN ON AMAZON" button
npm run test:amazon     # a single real check, prints state and signals (-- -p <url> for another product, -- --headed to see the browser)
```

### Interfaccia terminale

When started from an interactive terminal (`npm run dev`, `npm start`):

- startup: a full-window splash animation (radar, logo decoding, credits; about 2 s, on the terminal's alternate screen so your scrollback is untouched), then a compact header, the product URL prompt (skipped with `-p`), a checklist tied to real events and a configuration summary. With `-p` the checks start right away, in parallel with the animation. **Enter** skips the animation; `STARTUP_ANIMATION=false` disables it, and it is not shown on terminals smaller than 60×18;
- status line at the bottom with next check, state, number of checks, uptime and key legend (it shortens on narrow terminals);
- identical consecutive checks collapsed into a single line (`×42 since 17:41:03`). The log file stays complete;
- window/tab title showing the state (⚪ UNAVAILABLE, 🟢 AVAILABLE!, 🟣 BLOCKED…);
- green box and terminal bell when the product becomes available;
- keys: `c` immediate check (also while BLOCKED, useful after solving a CAPTCHA), `o` opens Amazon, `d` shows/hides the detector details, `q` or Ctrl+C quits with a session summary.

Under pm2, launchd, systemd or with output redirected to a file the UI is not enabled: you get plain log lines, with no colors or control sequences.

### Log

Logs go both to the console and to `logs/watcher.log`, in different formats.

**Console in an interactive terminal:** time only, colors per state, identical checks collapsed, status line at the bottom.

```text
09:47:09  Watching https://www.amazon.it/dp/B0F2TN43GH (ASIN B0F2TN43GH) every 9000-14000 ms. Last known state: UNAVAILABLE, armed
09:47:09  Starting Chromium (headless=true)
09:47:10  ● UNAVAILABLE   Non disponibile. Non sappiamo se o quando l'articolo…  ×42 since 09:47:10
09:56:31  ● AVAILABLE     Preordina ora (1512 ms)
09:56:31  ↳ Transition UNAVAILABLE → AVAILABLE
09:56:31    reason="Preorder button detected" availabilityText="Questo articolo sarà disponibile..." button="Preordina ora" ... preorder=true
09:56:32  🚨 Availability notification sent to Telegram
09:58:02  ⚠ Technical alert BLOCKED sent to Telegram
⠸ next check 12s · AVAILABLE · #43 · up 9m 23s  │  [c] check now  [o] open Amazon  [d] details  [q] quit
```

The check text (e.g. "Non disponibile…") is what Amazon shows on the page, so it follows the language of the Amazon site.
Lines wider than the terminal are truncated with `…`: the full text is in the file.
Detector details (`reason=…`) appear only when the state changes, or always with the `d` key or `LOG_LEVEL=debug`.

**Console without a terminal** (pm2, launchd, systemd, redirect): same format, but one line per check, no status line and no colors.

**File `logs/watcher.log`:** full date, one line per check, never collapsed. Rotated at 5 MB, 3 files.

```text
2026-09-23 15:30:01 | Amazon Stock Watcher v1.0.0 · developed by @mpellicc · https://github.com/mpellicc/amazon-stock-watcher
2026-09-23 15:30:01 | Watching https://www.amazon.it/dp/B0F2TN43GH (ASIN B0F2TN43GH) every 9000-14000 ms. Last known state: UNAVAILABLE, armed
2026-09-23 15:30:03 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1408 ms)
2026-09-23 15:30:14 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1423 ms)
2026-09-23 15:30:25 | AVAILABLE     | Preordina ora (1512 ms)
2026-09-23 15:30:25 | Transition UNAVAILABLE -> AVAILABLE
2026-09-23 15:30:25 |   reason="Preorder button detected" availabilityText="Questo articolo sarà disponibile..." button="Preordina ora" ... preorder=true
2026-09-23 15:30:26 | 🚨 Availability notification sent to Telegram
2026-09-23 15:32:40 | WARN | Technical alert BLOCKED sent to Telegram
2026-09-23 16:10:03 | Telegram command /recap
2026-09-23 17:41:55 | Watcher stopped. Session: duration 2h 11m, 612 checks (avg 1.6 s), 1 blocks, 1 availability, 1 notifications
```

---

## Come funziona

### Architettura

```text
src/
├── index.ts                     # wiring, startup sequence, SIGINT/SIGTERM, graceful shutdown
├── cli.ts                       # -p/--product and the interactive URL prompt
├── meta.ts                      # name, version, author
├── Monitor.ts                   # loop: check → transition → notifications → jittered sleep, statistics
├── config.ts                    # .env + validation, product URL normalization
├── amazon/
│   ├── AmazonWatcher.ts         # persistent Chromium, navigation, crash/restart
│   ├── availabilityDetector.ts  # HTML → AvailabilityResult (pure function)
│   └── types.ts
├── state/
│   ├── transitions.ts           # pure state machine (armed, errors, cooldown)
│   └── StateManager.ts          # data/state-<ASIN>.json with atomic writes
├── telegram/
│   ├── TelegramNotifier.ts      # Bot API sendMessage + inline keyboard, retries
│   └── TelegramCommands.ts      # /recap, /recap N, /check via long polling
├── notifications/
│   ├── LocalNotifier.ts         # sound + browser opening (best-effort)
│   ├── Recapper.ts              # periodic recap
│   └── messages.ts              # message texts
├── ui/
│   ├── TerminalUI.ts            # status line, collapsed lines, keys, banner, final summary
│   ├── splash.ts                # full-window startup animation
│   ├── intro.ts                 # compact header + startup checklist
│   └── ansi.ts                  # ANSI sequences, boxes, truncation
├── scripts/                     # test:telegram, test:amazon
└── utils/                       # logger (secret redaction, rotation), sleep
test/                            # vitest + HTML fixtures
```

The detector receives the **HTML rendered by Chromium** (`page.content()`, i.e. after Amazon's JS has run)
and parses it with `linkedom`. It is the same function in production and in the tests, which run against local
fixtures with no browser and no network.

### `page.goto()` invece di `page.reload()`

Every check performs a **fresh navigation** to the product URL, in the same page and the same Chromium:

- if Amazon redirected us to a CAPTCHA or error page, `reload()` would reload _that_ page, while `goto()` always goes back to the product;
- after a network error the page is on `chrome-error://`, and `goto()` starts clean;
- the cost is the same: same process, same cache, same cookies.

The browser uses a **persistent profile** (`data/browser-profile`): cookies and consent survive restarts,
like for a normal user. It waits for `domcontentloaded`, then up to 10 s for the title or the CAPTCHA, then up to 3 s for the buybox.

### Classificazione (detector)

Signals collected: the `#add-to-cart-button`, `#buy-now-button`, `submit.preorder` buttons, plus a
**text fallback limited to the buybox** ("Aggiungi al carrello", "Acquista ora", "Preordina ora", "Add to Cart",
"Buy Now", "Pre-order"), the `#availability` text, `#productTitle`, the page ASIN and the CAPTCHA signals.
Text patterns cover both Italian and English Amazon pages.

| Outcome       | When                                                                                                                                                            |
| ------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED`     | `validateCaptcha` form or `#captchacharacters`; or texts like "Robot Check", "Inserisci i caratteri che vedi", "CAPTCHA"... **on a page with no product title** |
| `UNKNOWN`     | missing title (incomplete or error page), ASIN different from the expected one, conflicting signals (button + "unavailable"), positive text without buttons     |
| `AVAILABLE`   | title present, correct ASIN, **at least one visible and enabled purchase/pre-order button**, no negative text                                                   |
| `UNAVAILABLE` | title present, no active button and negative text ("Attualmente non disponibile", "Currently unavailable"...) or a buybox without buttons                       |

Rule: **`AVAILABLE` only with positive evidence**. Anomalous pages, errors and timeouts are never availability.

Known fragile spots, and how they are handled:

- "Add to Cart" also appears in carousels of other products: the text fallback only looks inside the buybox;
- "disponibile" is contained in "non disponibile": negative text is evaluated first;
- hidden or disabled buttons (`aok-hidden`, `a-button-disabled`, `disabled`) are ignored;
- redirect to a variant or bundle: if the ASIN differs the result is `UNKNOWN`;
- the word "captcha" inside scripts: scripts are removed, and text-only signals count only without a product title;
- a third-party seller (even at an inflated price) still produces `AVAILABLE`: the seller, when detectable, appears in the log and in the message;
- if Amazon radically changes its markup the most likely result is `UNKNOWN` (which after a few checks triggers a technical alert), not a false positive.

### Macchina a stati e notifiche

States: `STARTING`, `UNKNOWN`, `UNAVAILABLE`, `AVAILABLE`, `BLOCKED`, `NETWORK_ERROR`.

- **Availability**: the watcher starts **armed**. On the first `AVAILABLE` it sends Telegram (with the **🛒 OPEN ON AMAZON** button), plays the sound and opens the browser if enabled, then becomes **disarmed**. It is armed again only when it sees `UNAVAILABLE`. The state is shown at startup and in recaps. So:
  - `UNAVAILABLE → AVAILABLE`: notification;
  - `AVAILABLE → AVAILABLE`: nothing;
  - `AVAILABLE → NETWORK_ERROR → AVAILABLE`: nothing (not a new availability);
  - `AVAILABLE → UNAVAILABLE → AVAILABLE`: new notification;
  - if Telegram does not answer, the watcher stays armed and retries on the next check.
- **Persistence**: `data/state-<ASIN>.json` (atomic write: temp file + `rename`) keeps the last state, timestamps and the armed flag. After a restart it does not re-notify an availability that was already notified.
- **Technical alerts** (policy):
  - `BLOCKED`: one Telegram message immediately, only once per episode;
  - `NETWORK_ERROR` / `UNKNOWN`: log only for the first errors; at `PROBLEM_ALERT_THRESHOLD` consecutive ones (default 6, about 1 minute) one Telegram message per episode;
  - at least `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES` between two technical alerts;
  - back to normal: a log line and, if an alert was sent, a "✅ back to normal" message.
- **Adaptive slowdown**: every new `BLOCKED` episode doubles the polling interval (up to 8x). After 30 minutes without new blocks the interval is halved, one step at a time, until it is back to normal. Every change is logged. The factor lives in memory: a restart resets it.
- **While `BLOCKED`** the watcher does not reload on every round. It re-reads the current page (with `HEADLESS=false` you can solve the verification yourself in the Chromium window) and navigates again only every `BLOCKED_RETRY_INTERVAL_MS`.

### Robustezza

- Timeouts, `ERR_CONNECTION_RESET`, DNS and navigation failures become `NETWORK_ERROR` and the loop keeps going.
- Page or browser crash, or context closed: Chromium is recreated with exponential backoff (2 s → 2 min).
- Telegram unreachable: 3 attempts with backoff (honors `retry_after`), then it moves on. Command polling retries on its own with backoff (5 s → 60 s).
- Sound and browser opening are best-effort: errors end up in the log and are ignored.
- `SIGINT`/`SIGTERM` (or `q`/Ctrl+C in the UI): the loop stops, Chromium is closed gracefully, exit 0. A second signal arriving within 2 s is ignored (under `npm` Ctrl+C arrives twice); a later one forces the exit.
- The Telegram token is never logged: the logger masks anything shaped like a token.

---

## Avvio automatico con il PC

Run `npm run build` first. In the commands below replace `/path/to/amazon-stock-watcher` with the real path.

When started as a service there is no terminal: the URL prompt and the interactive UI do not appear. The product must be given
with `AMAZON_URL` in `.env` or with `-p <url>` in the arguments (in the examples below: `-p https://www.amazon.it/dp/B0XXXXXXXX`).

### Windows: PM2 (simplest)

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\path\to\amazon-stock-watcher
pm2 start dist/index.js --name amazon-watcher -- -p https://www.amazon.it/dp/B0XXXXXXXX
pm2 save
pm2-startup install
```

`pm2 logs amazon-watcher` shows the logs, `pm2 restart amazon-watcher` restarts it.

### Windows: Task Scheduler

1. _Task Scheduler_ → **Create Task**.
2. _General_: "Run only when user is logged on" (needed for sound and browser opening).
3. _Triggers_: **At log on**.
4. _Actions_: program `C:\Program Files\nodejs\node.exe`, arguments `dist\index.js -p https://www.amazon.it/dp/B0XXXXXXXX`, _Start in_ `C:\path\to\amazon-stock-watcher`.
5. _Settings_: "If the task fails, restart every 1 minute" and untick "Stop the task if it runs longer than...".

### macOS: launchd

`~/Library/LaunchAgents/com.mpellicc.amazon-stock-watcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>com.mpellicc.amazon-stock-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>   <!-- output of: which node -->
    <string>dist/index.js</string>
    <string>-p</string>
    <string>https://www.amazon.it/dp/B0XXXXXXXX</string>
  </array>
  <key>WorkingDirectory</key><string>/path/to/amazon-stock-watcher</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/path/to/amazon-stock-watcher/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/path/to/amazon-stock-watcher/logs/launchd.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/com.mpellicc.amazon-stock-watcher.plist
```

To stop it: `launchctl unload ...`. Keep the Mac awake (Settings → Battery/Energy, or `caffeinate -s`).

### Linux: systemd (user)

`~/.config/systemd/user/amazon-stock-watcher.service`:

```ini
[Unit]
Description=Amazon Stock Watcher
After=network-online.target

[Service]
WorkingDirectory=/path/to/amazon-stock-watcher
ExecStart=/usr/bin/node dist/index.js -p https://www.amazon.it/dp/B0XXXXXXXX
Restart=always
RestartSec=10
KillSignal=SIGTERM

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now amazon-stock-watcher
loginctl enable-linger $USER    # starts even without logging in
journalctl --user -u amazon-stock-watcher -f
```

---

## Sicurezza

- `.env`, `data/` and `logs/` are in `.gitignore`: never commit secrets.
- The code does not log in to Amazon, does not add to cart, does not check out, does not solve or bypass CAPTCHAs, and does not use stealth plugins, proxies or fingerprint spoofing.
- Jittered polling (default 9-14 s) with automatic slowdown when Amazon asks for verifications: a user reloading the page, not a crawler.
- Telegram commands are answered only for the configured `TELEGRAM_CHAT_ID`; messages from other chats are ignored.

## Note legali

This is a personal, non-commercial project made for educational purposes. It is not affiliated with,
endorsed by or sponsored by Amazon. "Amazon" is a trademark of Amazon.com, Inc. or its affiliates,
used here only to describe what the tool monitors.

Automated access may conflict with Amazon's Conditions of Use. You are solely responsible for how you use
this tool and for complying with Amazon's terms and the laws that apply to you.

The software is provided "as is", without warranty of any kind (see [LICENSE](LICENSE)): it may miss an
availability window, be blocked by Amazon, or stop working if Amazon changes its pages.

## Licenza

Copyright (C) 2026 [@mpellicc](https://github.com/mpellicc)

This program is free software: you can redistribute it and/or modify it under the terms of the
GNU General Public License as published by the Free Software Foundation, either version 3 of the License,
or (at your option) any later version. See [LICENSE](LICENSE) for the full text.

In short: you can use, study, modify and share it, but any distributed version (modified or not)
must stay under the GPL and come with its source code.
