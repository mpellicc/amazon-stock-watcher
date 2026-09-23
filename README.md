# amazon-stock-watcher

Watcher locale che tiene aperto un Chromium reale (Playwright), controlla ogni ~9-14 s la pagina
Amazon.it di un prodotto e ti avvisa **subito su Telegram** (più suono locale e, se vuoi, apertura del browser)
quando passa da *non acquistabile* ad *acquistabile/preordinabile*.

> **Non compra nulla.** Nessun login, carrello, checkout o acquisto automatico.
> Niente bypass CAPTCHA, stealth, proxy o fingerprint spoofing: se Amazon chiede una verifica il watcher va in `BLOCKED` e te lo dice.

Prodotto predefinito: <https://www.amazon.it/dp/B0F2TN43GH> (ASIN `B0F2TN43GH`).

---

## Requisiti

- **Node.js 22+** (testato con Node 24 LTS)
- **Chromium di Playwright** (`npx playwright install chromium`)
- Un **bot Telegram** e il tuo `chat_id`

## Setup

```bash
git clone <repo> amazon-stock-watcher
cd amazon-stock-watcher
npm install
npx playwright install chromium
cp .env.example .env
# compila TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID in .env
npm run test:telegram   # deve arrivarti "✅ Telegram configurato correttamente."
```

### Creare il bot Telegram

1. Su Telegram apri **@BotFather** e invia `/newbot`.
2. Scegli nome e username (deve finire in `bot`).
3. BotFather ti risponde con il **token** (`123456789:AA...`): mettilo in `TELEGRAM_BOT_TOKEN`.
4. Apri la chat con il tuo nuovo bot e premi **Avvia** / invia un messaggio qualsiasi (altrimenti il bot non può scriverti).

### Ottenere il `chat_id`

Dopo aver scritto al bot, apri nel browser (sostituisci il token):

```
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Cerca `"chat":{"id":123456789,...}`: quel numero è il `TELEGRAM_CHAT_ID`.
In alternativa scrivi a **@userinfobot**, che ti risponde con il tuo id.

## Configurazione (`.env`)

| Variabile | Default | Descrizione |
|---|---|---|
| `AMAZON_URL` | `https://www.amazon.it/dp/B0F2TN43GH` | Pagina prodotto (l'ASIN viene estratto dall'URL) |
| `TELEGRAM_BOT_TOKEN` | — | **Obbligatorio** |
| `TELEGRAM_CHAT_ID` | — | **Obbligatorio** |
| `MIN_POLL_INTERVAL_MS` / `MAX_POLL_INTERVAL_MS` | `9000` / `14000` | Attesa casuale tra un check e l'altro (minimo 3000) |
| `HEADLESS` | `true` | `false` = finestra Chromium visibile |
| `LOCAL_SOUND_ENABLED` | `true` | Suono locale quando diventa disponibile |
| `OPEN_BROWSER_ON_AVAILABLE` | `false` | Apre l'URL nel browser predefinito |
| `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES` | `30` | Distanza minima tra due alert tecnici |
| `LOG_LEVEL` | `info` | `debug` mostra i segnali del detector a ogni check |
| `PROBLEM_ALERT_THRESHOLD` | `6` | Errori consecutivi prima di un alert tecnico (~1 min) |
| `NAVIGATION_TIMEOUT_MS` | `30000` | Timeout di navigazione |
| `BLOCKED_RETRY_INTERVAL_MS` | `120000` | Ogni quanto ritentare la navigazione mentre si è `BLOCKED` |
| `BLOCK_HEAVY_RESOURCES` | `true` | Non scarica immagini/font/video: check più veloci |

La configurazione viene validata all'avvio: se manca qualcosa ricevi un messaggio chiaro e il processo esce.

## Avvio

Sviluppo (TypeScript diretto):

```bash
npm run dev
```

Produzione:

```bash
npm run build
npm start
```

Altri comandi:

```bash
npm test                # unit test (detector + macchina a stati), nessuna rete
npm run typecheck       # tsc su sorgenti e test
npm run test:telegram   # messaggio di prova con bottone "🛒 APRI SU AMAZON"
npm run test:amazon     # un singolo check reale, stampa stato e segnali (aggiungi -- --headed per vedere il browser)
```

Log a console e in `logs/watcher.log` (rotazione a 5 MB, 3 file). Esempio:

```
2026-09-23 15:30:01 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1408 ms)
2026-09-23 15:30:12 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1423 ms)
2026-09-23 15:30:23 | AVAILABLE     | Preordina ora (1512 ms)
2026-09-23 15:30:23 | Transizione UNAVAILABLE -> AVAILABLE
2026-09-23 15:30:23 |   reason="Preorder button detected" availabilityText="Questo articolo sarà disponibile..." button="Preordina ora" ... preorder=true
```

---

## Come funziona

### Architettura

```
src/
├── index.ts                     # wiring, SIGINT/SIGTERM, shutdown ordinato
├── Monitor.ts                   # loop: check → transizione → notifiche → sleep con jitter
├── config.ts                    # .env + validazione
├── amazon/
│   ├── AmazonWatcher.ts         # Chromium persistente, navigazione, crash/restart
│   ├── availabilityDetector.ts  # HTML → AvailabilityResult (funzione pura)
│   └── types.ts
├── state/
│   ├── transitions.ts           # macchina a stati pura (armed, errori, cooldown)
│   └── StateManager.ts          # data/state.json con scrittura atomica
├── telegram/TelegramNotifier.ts # Bot API sendMessage + inline keyboard, retry
├── notifications/
│   ├── LocalNotifier.ts         # suono + apertura browser (best-effort)
│   └── messages.ts              # testi dei messaggi
├── scripts/                     # test:telegram, test:amazon
└── utils/                       # logger (redazione segreti, rotazione), sleep
test/                            # vitest + fixture HTML
```

Il detector riceve l'**HTML renderizzato da Chromium** (`page.content()`, quindi dopo l'esecuzione del JS
di Amazon) e lo analizza con `linkedom`. È la stessa funzione in produzione e nei test, che girano su fixture
locali senza browser e senza rete.

### `page.goto()` invece di `page.reload()`

Ogni check fa una **nuova navigazione** all'URL del prodotto nella stessa pagina e con lo stesso Chromium:

- se Amazon ci ha rediretti a una pagina CAPTCHA o d'errore, `reload()` ricaricherebbe *quella* pagina, mentre `goto()` torna sempre al prodotto;
- dopo un errore di rete la pagina è su `chrome-error://`, e `goto()` riparte pulito;
- il costo è lo stesso: stesso processo, stessa cache e stessi cookie.

Il browser usa un **profilo persistente** (`data/browser-profile`): cookie e consenso restano tra i riavvii,
come per un utente normale. Si attende `domcontentloaded`, poi fino a 10 s il titolo o il CAPTCHA, poi fino a 3 s il buybox.

### Classificazione (detector)

Segnali raccolti: bottoni `#add-to-cart-button`, `#buy-now-button`, `submit.preorder`, più un fallback
**testuale limitato al buybox** ("Aggiungi al carrello", "Acquista ora", "Preordina ora", "Add to Cart",
"Buy Now", "Pre-order"), il testo di `#availability`, `#productTitle`, l'ASIN della pagina e i segnali CAPTCHA.

| Esito | Quando |
|---|---|
| `BLOCKED` | form `validateCaptcha` o `#captchacharacters`; oppure testi "Robot Check", "Inserisci i caratteri che vedi", "CAPTCHA"... **su una pagina senza titolo prodotto** |
| `UNKNOWN` | titolo mancante (pagina incompleta o d'errore), ASIN diverso da quello atteso, segnali in conflitto (bottone + "non disponibile"), testo positivo senza bottoni |
| `AVAILABLE` | titolo presente, ASIN corretto, **almeno un bottone d'acquisto/preordine visibile e abilitato**, nessun testo negativo |
| `UNAVAILABLE` | titolo presente, nessun bottone attivo e testo negativo ("Attualmente non disponibile", "Non sappiamo se...") oppure buybox senza bottoni |

Regola: **`AVAILABLE` solo con evidenza positiva**. Pagine anomale, errori e timeout non sono mai disponibilità.

Punti fragili noti, e come vengono gestiti:
- "Aggiungi al carrello" compare anche nei caroselli di altri prodotti: il fallback testuale guarda solo dentro il buybox;
- "disponibile" è contenuto in "non disponibile": il testo negativo viene valutato per primo;
- bottoni nascosti o disabilitati (`aok-hidden`, `a-button-disabled`, `disabled`) vengono ignorati;
- redirect a una variante o a un bundle: se l'ASIN è diverso il risultato è `UNKNOWN`;
- la parola "captcha" negli script: gli script vengono rimossi e i segnali solo testuali valgono solo senza titolo prodotto;
- un venditore terzo (anche a prezzo gonfiato) produce comunque `AVAILABLE`: il venditore, se rilevabile, compare in log e messaggio;
- se Amazon cambia markup in modo radicale il risultato più probabile è `UNKNOWN` (che dopo qualche check genera un alert tecnico), non un falso positivo.

### Macchina a stati e notifiche

Stati: `STARTING`, `UNKNOWN`, `UNAVAILABLE`, `AVAILABLE`, `BLOCKED`, `NETWORK_ERROR`.

- **Disponibilità**: il watcher è *armato*. Alla prima osservazione `AVAILABLE` manda Telegram (con il bottone **🛒 APRI SU AMAZON**), suona e apre il browser se abilitato, poi si **disarma**. Si riarma solo quando vede di nuovo `UNAVAILABLE`. Quindi:
  - `UNAVAILABLE → AVAILABLE`: notifica;
  - `AVAILABLE → AVAILABLE`: niente;
  - `AVAILABLE → NETWORK_ERROR → AVAILABLE`: niente (non è una nuova disponibilità);
  - `AVAILABLE → UNAVAILABLE → AVAILABLE`: nuova notifica;
  - se Telegram non risponde, il watcher resta armato e riprova al check successivo.
- **Persistenza**: `data/state.json` (scrittura atomica: file temporaneo + `rename`) conserva ultimo stato, orari e flag armed. Dopo un riavvio non rinotifica una disponibilità già notificata.
- **Alert tecnici** (policy):
  - `BLOCKED`: un Telegram subito, una sola volta per episodio;
  - `NETWORK_ERROR` / `UNKNOWN`: solo log per i primi errori; alla soglia `PROBLEM_ALERT_THRESHOLD` consecutiva (default 6, circa 1 minuto) un Telegram per episodio;
  - tra due alert tecnici passa almeno `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES`;
  - al ritorno alla normalità: riga di log e, se era partito un alert, un messaggio "✅ tornato alla normalità".
- **In `BLOCKED`** il watcher non ricarica a ogni giro. Rilegge la pagina corrente (con `HEADLESS=false` puoi risolvere tu la verifica nella finestra di Chromium) e rinaviga solo ogni `BLOCKED_RETRY_INTERVAL_MS`.

### Robustezza

- Timeout, `ERR_CONNECTION_RESET`, DNS e navigation failure diventano `NETWORK_ERROR` e il loop continua.
- Crash di pagina o browser, o chiusura del contesto: Chromium viene ricreato con backoff esponenziale (2 s → 2 min).
- Telegram irraggiungibile: 3 tentativi con backoff (rispetta `retry_after`), poi si prosegue.
- Suono e apertura del browser sono best-effort: gli errori finiscono nel log e vengono ignorati.
- `SIGINT`/`SIGTERM`: il loop si interrompe, Chromium viene chiuso ordinatamente, exit 0. Un secondo segnale forza l'uscita.
- Il token Telegram non viene mai loggato: il logger maschera tutto ciò che ha il formato di un token.

---

## Avvio automatico con il PC

Prima esegui `npm run build`. Nei comandi sotto sostituisci `/percorso/amazon-stock-watcher` con il path reale.

### Windows: PM2 (più semplice)

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\percorso\amazon-stock-watcher
pm2 start dist/index.js --name amazon-watcher
pm2 save
pm2-startup install
```

`pm2 logs amazon-watcher` mostra i log, `pm2 restart amazon-watcher` riavvia.

### Windows: Task Scheduler

1. *Utilità di pianificazione* → **Crea attività**.
2. *Generale*: "Esegui solo se l'utente è connesso" (serve per suono e apertura del browser).
3. *Attivazione*: **All'accesso**.
4. *Azione*: programma `C:\Program Files\nodejs\node.exe`, argomenti `dist\index.js`, *Inizia in* `C:\percorso\amazon-stock-watcher`.
5. *Impostazioni*: "Se l'attività non riesce, riavvia ogni 1 minuto" e togli "Arresta l'attività se viene eseguita per più di...".

### macOS: launchd

`~/Library/LaunchAgents/it.local.amazon-stock-watcher.plist`:

```xml
<?xml version="1.0" encoding="UTF-8"?>
<!DOCTYPE plist PUBLIC "-//Apple//DTD PLIST 1.0//EN" "http://www.apple.com/DTDs/PropertyList-1.0.dtd">
<plist version="1.0">
<dict>
  <key>Label</key><string>it.local.amazon-stock-watcher</string>
  <key>ProgramArguments</key>
  <array>
    <string>/usr/local/bin/node</string>   <!-- output di: which node -->
    <string>dist/index.js</string>
  </array>
  <key>WorkingDirectory</key><string>/percorso/amazon-stock-watcher</string>
  <key>RunAtLoad</key><true/>
  <key>KeepAlive</key><true/>
  <key>StandardOutPath</key><string>/percorso/amazon-stock-watcher/logs/launchd.out.log</string>
  <key>StandardErrorPath</key><string>/percorso/amazon-stock-watcher/logs/launchd.err.log</string>
</dict>
</plist>
```

```bash
launchctl load ~/Library/LaunchAgents/it.local.amazon-stock-watcher.plist
```

Per fermarlo: `launchctl unload ...`. Tieni il Mac sveglio (Impostazioni → Batteria/Energia, oppure `caffeinate -s`).

### Linux: systemd (utente)

`~/.config/systemd/user/amazon-stock-watcher.service`:

```ini
[Unit]
Description=Amazon Stock Watcher
After=network-online.target

[Service]
WorkingDirectory=/percorso/amazon-stock-watcher
ExecStart=/usr/bin/node dist/index.js
Restart=always
RestartSec=10
KillSignal=SIGTERM

[Install]
WantedBy=default.target
```

```bash
systemctl --user daemon-reload
systemctl --user enable --now amazon-stock-watcher
loginctl enable-linger $USER    # parte anche senza login
journalctl --user -u amazon-stock-watcher -f
```

---

## Sicurezza

- `.env`, `data/` e `logs/` sono in `.gitignore`: non committare mai segreti.
- Il codice non fa login ad Amazon, non aggiunge al carrello, non fa checkout, non risolve né aggira CAPTCHA, non usa stealth plugin, proxy o fingerprint spoofing.
- Polling con jitter di circa 10-12 s in media: un utente che ricarica la pagina, non un crawler.
