# amazon-stock-watcher

Watcher locale che tiene aperto un Chromium reale (Playwright), controlla a intervalli casuali (default 9-14 s)
la pagina Amazon di un prodotto e ti avvisa **subito su Telegram** (più suono locale e, se vuoi, apertura del browser)
quando passa da _non acquistabile_ ad _acquistabile/preordinabile_. Da remoto lo interroghi con i comandi del bot
(`/recap`, `/check`) e ricevi un recap periodico.

> **Non compra nulla.** Nessun login, carrello, checkout o acquisto automatico.
> Niente bypass CAPTCHA, stealth, proxy o fingerprint spoofing: se Amazon chiede una verifica il watcher va in `BLOCKED` e te lo dice.

Il prodotto si sceglie all'avvio (vedi [Scelta del prodotto](#scelta-del-prodotto)).

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

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Cerca `"chat":{"id":123456789,...}`: quel numero è il `TELEGRAM_CHAT_ID`.
In alternativa scrivi a **@userinfobot**, che ti risponde con il tuo id.

## Configurazione (`.env`)

| Variabile                                       | Default          | Descrizione                                                                           |
| ----------------------------------------------- | ---------------- | ------------------------------------------------------------------------------------- |
| `AMAZON_URL`                                    | —                | Prodotto di default, usato se non passi `-p` e non c'è un terminale per chiederlo     |
| `TELEGRAM_BOT_TOKEN`                            | —                | **Obbligatorio**                                                                      |
| `TELEGRAM_CHAT_ID`                              | —                | **Obbligatorio**                                                                      |
| `MIN_POLL_INTERVAL_MS` / `MAX_POLL_INTERVAL_MS` | `9000` / `14000` | Attesa casuale tra un check e l'altro (minimo 3000)                                   |
| `HEADLESS`                                      | `true`           | `false` = finestra Chromium visibile                                                  |
| `LOCAL_SOUND_ENABLED`                           | `true`           | Suono locale quando diventa disponibile                                               |
| `OPEN_BROWSER_ON_AVAILABLE`                     | `false`          | Apre l'URL nel browser predefinito                                                    |
| `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES`       | `30`             | Distanza minima tra due alert tecnici                                                 |
| `RECAP_INTERVAL_HOURS`                          | `4`              | Recap su Telegram ogni N ore (`0` = disattivato). Modificabile a caldo con `/recap N` |
| `STARTUP_ANIMATION`                             | `true`           | Animazione di avvio nel terminale                                                     |
| `LOG_LEVEL`                                     | `info`           | `debug` mostra i segnali del detector a ogni check                                    |
| `PROBLEM_ALERT_THRESHOLD`                       | `6`              | Errori consecutivi prima di un alert tecnico (~1 min)                                 |
| `NAVIGATION_TIMEOUT_MS`                         | `30000`          | Timeout di navigazione                                                                |
| `BLOCKED_RETRY_INTERVAL_MS`                     | `120000`         | Ogni quanto ritentare la navigazione mentre si è `BLOCKED`                            |
| `BLOCK_HEAVY_RESOURCES`                         | `true`           | Non scarica immagini/font/video: check più veloci                                     |

La configurazione viene validata all'avvio: se manca qualcosa ricevi un messaggio chiaro e il processo esce.

## Avvio

### Scelta del prodotto

In ordine di precedenza:

1. flag `-p` / `--product`: `npm start -- -p "https://www.amazon.it/dp/B0XXXXXXXX"`;
2. da terminale, richiesta all'avvio: Invio conferma l'ultimo prodotto usato;
3. `AMAZON_URL` nel `.env`: è l'unica opzione con pm2, launchd o systemd, dove non c'è nessuno a cui chiedere.

Va bene qualunque URL prodotto Amazon (con nome del prodotto, `ref=`, parametri…): l'ASIN viene estratto e l'URL normalizzato in `/dp/<ASIN>`. I link corti `amzn.eu` non sono supportati.
Ogni prodotto ha il suo stato (`data/state-<ASIN>.json`), quindi cambiare prodotto non eredita "disarmed" dal precedente.

### Telegram: recap e comandi

- **Recap** ogni `RECAP_INTERVAL_HOURS` ore: stato, check del periodo, latenza media, blocchi, errori di rete, uptime.
- **Comandi** (compaiono nel menu `/` del bot e rispondono solo al tuo `TELEGRAM_CHAT_ID`):
  - `/recap`: recap immediato;
  - `/recap N`: recap ogni N ore da adesso (`0` = off). Vale fino al riavvio;
  - `/check`: check immediato con l'esito.
- I comandi inviati mentre il watcher era spento vengono ignorati all'avvio.
- Un bot può essere letto da un solo processo: con due watcher sullo stesso bot, i comandi funzionano solo su uno (l'altro lo segnala nel log).
- Per vedere cosa succede quando i comandi non rispondono (PC spento, crash), il metodo previsto è un desktop remoto, per esempio Chrome Remote Desktop o RustDesk. Serve anche per risolvere un CAPTCHA da fuori casa, con `HEADLESS=false`.

### Comandi npm

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
npm run test:amazon     # un singolo check reale, stampa stato e segnali (-- -p <url> per un altro prodotto, -- --headed per vedere il browser)
```

### Interfaccia nel terminale

Quando lo avvii da un terminale interattivo (`npm run dev`, `npm start`):

- animazione di avvio (logo, checklist legata agli eventi reali, riepilogo della configurazione). Gira in parallelo all'avvio di Chromium e al primo check, quindi non aggiunge latenza. Si salta premendo un tasto qualsiasi e si disattiva con `STARTUP_ANIMATION=false`;
- richiesta dell'URL del prodotto (saltata con `-p`);
- riga di stato in basso con prossimo check, stato, numero di check, uptime e legenda dei tasti (si accorcia se il terminale è stretto);
- check identici consecutivi compattati in una sola riga (`×42 dalle 17:41:03`). Il file di log resta completo;
- titolo della finestra o tab con lo stato (⚪ UNAVAILABLE, 🟢 AVAILABLE!, 🟣 BLOCKED…);
- riquadro verde e campanello quando il prodotto diventa disponibile;
- tasti: `c` check immediato (anche in BLOCKED, utile dopo aver risolto un CAPTCHA), `o` apre Amazon, `d` mostra o nasconde i dettagli del detector, `q` o Ctrl+C per uscire con il riepilogo della sessione.

Con pm2, launchd, systemd o output rediretto su file la UI non si attiva: restano le righe di log semplici, senza colori né sequenze di controllo.

### Log

I log vanno sia a console sia su `logs/watcher.log`, con formati diversi.

**Console da terminale interattivo:** solo l'ora, colori per stato, check identici compattati, riga di stato in basso.

```text
09:47:09  Monitoraggio https://www.amazon.it/dp/B0F2TN43GH (ASIN B0F2TN43GH) ogni 9000-14000 ms. Ultimo stato noto: UNAVAILABLE
09:47:09  Avvio Chromium (headless=true)
09:47:10  ● UNAVAILABLE   Non disponibile. Non sappiamo se o quando l'articolo…  ×42 dalle 09:47:10
09:56:31  ● AVAILABLE     Preordina ora (1512 ms)
09:56:31  ↳ Transizione UNAVAILABLE → AVAILABLE
09:56:31    reason="Preorder button detected" availabilityText="Questo articolo sarà disponibile..." button="Preordina ora" ... preorder=true
09:56:32  🚨 Notifica di disponibilità inviata su Telegram
09:58:02  ⚠ Alert tecnico BLOCKED inviato su Telegram
⠸ prossimo check 12s · AVAILABLE · #43 · up 9m 23s  │  [c] check ora  [o] apri Amazon  [d] dettagli  [q] esci
```

Le righe più larghe del terminale vengono troncate con `…`: il testo completo è nel file.
I dettagli del detector (`reason=…`) compaiono solo quando lo stato cambia, oppure sempre con il tasto `d` o `LOG_LEVEL=debug`.

**Console senza terminale** (pm2, launchd, systemd, redirect): stesso formato, ma una riga per ogni check, senza riga di stato e senza colori.

**File `logs/watcher.log`:** data completa, una riga per ogni check, mai compattato. Rotazione a 5 MB, 3 file.

```text
2026-09-23 15:30:01 | Monitoraggio https://www.amazon.it/dp/B0F2TN43GH (ASIN B0F2TN43GH) ogni 9000-14000 ms. Ultimo stato noto: UNAVAILABLE
2026-09-23 15:30:03 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1408 ms)
2026-09-23 15:30:14 | UNAVAILABLE   | Non disponibile. Non sappiamo se o quando l'articolo sarà di nuovo disponibile. (1423 ms)
2026-09-23 15:30:25 | AVAILABLE     | Preordina ora (1512 ms)
2026-09-23 15:30:25 | Transizione UNAVAILABLE -> AVAILABLE
2026-09-23 15:30:25 |   reason="Preorder button detected" availabilityText="Questo articolo sarà disponibile..." button="Preordina ora" ... preorder=true
2026-09-23 15:30:26 | 🚨 Notifica di disponibilità inviata su Telegram
2026-09-23 15:32:40 | WARN | Alert tecnico BLOCKED inviato su Telegram
2026-09-23 16:10:03 | Comando Telegram /recap
2026-09-23 17:41:55 | Watcher fermato. Sessione: durata 2h 11m, 612 check (media 1.6 s), 1 blocchi, 1 disponibilità, 1 notifiche
```

---

## Come funziona

### Architettura

```text
src/
├── index.ts                     # wiring, SIGINT/SIGTERM, shutdown ordinato
├── cli.ts                       # -p/--product e richiesta interattiva dell'URL
├── Monitor.ts                   # loop: check → transizione → notifiche → sleep con jitter, statistiche
├── config.ts                    # .env + validazione, normalizzazione URL prodotto
├── amazon/
│   ├── AmazonWatcher.ts         # Chromium persistente, navigazione, crash/restart
│   ├── availabilityDetector.ts  # HTML → AvailabilityResult (funzione pura)
│   └── types.ts
├── state/
│   ├── transitions.ts           # macchina a stati pura (armed, errori, cooldown)
│   └── StateManager.ts          # data/state-<ASIN>.json con scrittura atomica
├── telegram/
│   ├── TelegramNotifier.ts      # Bot API sendMessage + inline keyboard, retry
│   └── TelegramCommands.ts      # /recap, /recap N, /check via long polling
├── notifications/
│   ├── LocalNotifier.ts         # suono + apertura browser (best-effort)
│   ├── Recapper.ts              # recap periodico
│   └── messages.ts              # testi dei messaggi
├── ui/
│   ├── TerminalUI.ts            # riga di stato, righe compattate, tasti, banner, riepilogo finale
│   ├── intro.ts                 # animazione di avvio + checklist
│   └── ansi.ts                  # sequenze ANSI, riquadri, troncamento
├── scripts/                     # test:telegram, test:amazon
└── utils/                       # logger (redazione segreti, rotazione), sleep
test/                            # vitest + fixture HTML
```

Il detector riceve l'**HTML renderizzato da Chromium** (`page.content()`, quindi dopo l'esecuzione del JS
di Amazon) e lo analizza con `linkedom`. È la stessa funzione in produzione e nei test, che girano su fixture
locali senza browser e senza rete.

### `page.goto()` invece di `page.reload()`

Ogni check fa una **nuova navigazione** all'URL del prodotto nella stessa pagina e con lo stesso Chromium:

- se Amazon ci ha rediretti a una pagina CAPTCHA o d'errore, `reload()` ricaricherebbe _quella_ pagina, mentre `goto()` torna sempre al prodotto;
- dopo un errore di rete la pagina è su `chrome-error://`, e `goto()` riparte pulito;
- il costo è lo stesso: stesso processo, stessa cache e stessi cookie.

Il browser usa un **profilo persistente** (`data/browser-profile`): cookie e consenso restano tra i riavvii,
come per un utente normale. Si attende `domcontentloaded`, poi fino a 10 s il titolo o il CAPTCHA, poi fino a 3 s il buybox.

### Classificazione (detector)

Segnali raccolti: bottoni `#add-to-cart-button`, `#buy-now-button`, `submit.preorder`, più un fallback
**testuale limitato al buybox** ("Aggiungi al carrello", "Acquista ora", "Preordina ora", "Add to Cart",
"Buy Now", "Pre-order"), il testo di `#availability`, `#productTitle`, l'ASIN della pagina e i segnali CAPTCHA.

| Esito         | Quando                                                                                                                                                            |
| ------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED`     | form `validateCaptcha` o `#captchacharacters`; oppure testi "Robot Check", "Inserisci i caratteri che vedi", "CAPTCHA"... **su una pagina senza titolo prodotto** |
| `UNKNOWN`     | titolo mancante (pagina incompleta o d'errore), ASIN diverso da quello atteso, segnali in conflitto (bottone + "non disponibile"), testo positivo senza bottoni   |
| `AVAILABLE`   | titolo presente, ASIN corretto, **almeno un bottone d'acquisto/preordine visibile e abilitato**, nessun testo negativo                                            |
| `UNAVAILABLE` | titolo presente, nessun bottone attivo e testo negativo ("Attualmente non disponibile", "Non sappiamo se...") oppure buybox senza bottoni                         |

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

- **Disponibilità**: il watcher parte **armed**. Alla prima osservazione `AVAILABLE` manda Telegram (con il bottone **🛒 APRI SU AMAZON**), suona e apre il browser se abilitato, poi diventa **disarmed**. Torna armed solo quando vede di nuovo `UNAVAILABLE`. Lo stato è mostrato all'avvio e nei recap. Quindi:
  - `UNAVAILABLE → AVAILABLE`: notifica;
  - `AVAILABLE → AVAILABLE`: niente;
  - `AVAILABLE → NETWORK_ERROR → AVAILABLE`: niente (non è una nuova disponibilità);
  - `AVAILABLE → UNAVAILABLE → AVAILABLE`: nuova notifica;
  - se Telegram non risponde, il watcher resta armed e riprova al check successivo.
- **Persistenza**: `data/state-<ASIN>.json` (scrittura atomica: file temporaneo + `rename`) conserva ultimo stato, orari e flag armed. Dopo un riavvio non rinotifica una disponibilità già notificata.
- **Alert tecnici** (policy):
  - `BLOCKED`: un Telegram subito, una sola volta per episodio;
  - `NETWORK_ERROR` / `UNKNOWN`: solo log per i primi errori; alla soglia `PROBLEM_ALERT_THRESHOLD` consecutiva (default 6, circa 1 minuto) un Telegram per episodio;
  - tra due alert tecnici passa almeno `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES`;
  - al ritorno alla normalità: riga di log e, se era partito un alert, un messaggio "✅ tornato alla normalità".
- **Rallentamento adattivo**: ogni nuovo episodio `BLOCKED` raddoppia l'intervallo di polling (fino a 8x). Dopo 30 minuti senza nuovi blocchi l'intervallo si dimezza, un passo alla volta, fino a tornare normale. Ogni variazione viene loggata. Il fattore vive in memoria: un riavvio lo azzera.
- **In `BLOCKED`** il watcher non ricarica a ogni giro. Rilegge la pagina corrente (con `HEADLESS=false` puoi risolvere tu la verifica nella finestra di Chromium) e rinaviga solo ogni `BLOCKED_RETRY_INTERVAL_MS`.

### Robustezza

- Timeout, `ERR_CONNECTION_RESET`, DNS e navigation failure diventano `NETWORK_ERROR` e il loop continua.
- Crash di pagina o browser, o chiusura del contesto: Chromium viene ricreato con backoff esponenziale (2 s → 2 min).
- Telegram irraggiungibile: 3 tentativi con backoff (rispetta `retry_after`), poi si prosegue. La lettura dei comandi riprova da sola con backoff (5 s → 60 s).
- Suono e apertura del browser sono best-effort: gli errori finiscono nel log e vengono ignorati.
- `SIGINT`/`SIGTERM` (o `q`/Ctrl+C nella UI): il loop si interrompe, Chromium viene chiuso ordinatamente, exit 0. Un secondo segnale che arriva entro 2 s viene ignorato (con `npm` Ctrl+C arriva due volte); uno successivo forza l'uscita.
- Il token Telegram non viene mai loggato: il logger maschera tutto ciò che ha il formato di un token.

---

## Avvio automatico con il PC

Prima esegui `npm run build`. Nei comandi sotto sostituisci `/percorso/amazon-stock-watcher` con il path reale.

Avviato come servizio non c'è un terminale: la richiesta dell'URL e la UI interattiva non compaiono. Il prodotto va indicato
con `AMAZON_URL` nel `.env` oppure con `-p <url>` negli argomenti (negli esempi sotto: `-p https://www.amazon.it/dp/B0XXXXXXXX`).

### Windows: PM2 (più semplice)

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\percorso\amazon-stock-watcher
pm2 start dist/index.js --name amazon-watcher -- -p https://www.amazon.it/dp/B0XXXXXXXX
pm2 save
pm2-startup install
```

`pm2 logs amazon-watcher` mostra i log, `pm2 restart amazon-watcher` riavvia.

### Windows: Task Scheduler

1. _Utilità di pianificazione_ → **Crea attività**.
2. _Generale_: "Esegui solo se l'utente è connesso" (serve per suono e apertura del browser).
3. _Attivazione_: **All'accesso**.
4. _Azione_: programma `C:\Program Files\nodejs\node.exe`, argomenti `dist\index.js -p https://www.amazon.it/dp/B0XXXXXXXX`, _Inizia in_ `C:\percorso\amazon-stock-watcher`.
5. _Impostazioni_: "Se l'attività non riesce, riavvia ogni 1 minuto" e togli "Arresta l'attività se viene eseguita per più di...".

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
    <string>-p</string>
    <string>https://www.amazon.it/dp/B0XXXXXXXX</string>
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
loginctl enable-linger $USER    # parte anche senza login
journalctl --user -u amazon-stock-watcher -f
```

---

## Sicurezza

- `.env`, `data/` e `logs/` sono in `.gitignore`: non committare mai segreti.
- Il codice non fa login ad Amazon, non aggiunge al carrello, non fa checkout, non risolve né aggira CAPTCHA, non usa stealth plugin, proxy o fingerprint spoofing.
- Polling con jitter (default 9-14 s) e rallentamento automatico se Amazon chiede verifiche: un utente che ricarica la pagina, non un crawler.
- I comandi Telegram rispondono solo al `TELEGRAM_CHAT_ID` configurato; i messaggi di altre chat vengono ignorati.
