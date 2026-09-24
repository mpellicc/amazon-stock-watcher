# amazon-stock-watcher

🇬🇧 [English](README.md) | 🇮🇹 **Italiano**

![TypeScript](https://img.shields.io/badge/language-TypeScript-3178c6?logo=typescript&logoColor=white)
![Node.js](https://img.shields.io/badge/node-%3E%3D22-43853d?logo=node.js&logoColor=white)
![License](https://img.shields.io/badge/license-GPL--3.0--or--later-blue)
![Last Commit](https://img.shields.io/github/last-commit/mpellicc/amazon-stock-watcher)
![GitHub Stars](https://img.shields.io/github/stars/mpellicc/amazon-stock-watcher?style=flat)

Un watcher locale che mantiene aperto un vero Chromium (Playwright), controlla una pagina prodotto Amazon a intervalli casuali
(predefinito 9-14 s) e ti avvisa **subito su Telegram** (più un suono locale e, opzionalmente, l'apertura del browser)
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

- **Node.js 22+** (testato con Node 24 LTS)
- **Chromium di Playwright** (`npx playwright install chromium`)
- Un **bot Telegram** e il tuo `chat_id`

## Configurazione

```bash
git clone https://github.com/mpellicc/amazon-stock-watcher.git
cd amazon-stock-watcher
npm install
npx playwright install chromium
cp .env.example .env
# compila TELEGRAM_BOT_TOKEN e TELEGRAM_CHAT_ID in .env
npm run test:telegram   # dovresti ricevere "✅ Telegram is configured correctly."
```

### Creazione del bot Telegram

1. Su Telegram apri **@BotFather** e invia `/newbot`.
2. Scegli nome e username (lo username deve finire con `bot`).
3. BotFather risponde con il **token** (`123456789:AA...`): inseriscilo in `TELEGRAM_BOT_TOKEN`.
4. Apri la chat con il nuovo bot e premi **Start** / invia un messaggio (altrimenti il bot non può scriverti).

### Ottenere il `chat_id`

Dopo aver scritto al bot, apri questo URL nel browser (sostituisci il token):

```text
https://api.telegram.org/bot<TOKEN>/getUpdates
```

Cerca `"chat":{"id":123456789,...}`: quel numero è il `TELEGRAM_CHAT_ID`.
In alternativa, scrivi a **@userinfobot**, che ti risponde con il tuo id.

## Configurazione (`.env`)

| Variabile                                       | Default          | Descrizione                                                                            |
| ----------------------------------------------- | ---------------- | -------------------------------------------------------------------------------------- |
| `AMAZON_URL`                                    | —                | Prodotto di default, usato quando non c'è `-p` e non c'è un terminale da cui chiedere |
| `TELEGRAM_BOT_TOKEN`                            | —                | **Obbligatorio**                                                                       |
| `TELEGRAM_CHAT_ID`                              | —                | **Obbligatorio**                                                                       |
| `MIN_POLL_INTERVAL_MS` / `MAX_POLL_INTERVAL_MS` | `9000` / `14000` | Attesa casuale tra i controlli (minimo 3000)                                           |
| `HEADLESS`                                      | `true`           | `false` = finestra Chromium visibile                                                   |
| `LOCAL_SOUND_ENABLED`                           | `true`           | Suono locale quando il prodotto diventa disponibile                                    |
| `OPEN_BROWSER_ON_AVAILABLE`                     | `false`          | Apre l'URL nel browser predefinito                                                     |
| `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES`       | `30`             | Intervallo minimo tra due avvisi tecnici                                               |
| `RECAP_INTERVAL_HOURS`                          | `4`              | Recap Telegram ogni N ore (`0` = disattivato). Modificabile live con `/recap N`       |
| `STARTUP_ANIMATION`                             | `true`           | Animazione di avvio full-screen nel terminale (Invio la salta)                         |
| `LOG_LEVEL`                                     | `info`           | `debug` mostra i segnali del detector a ogni controllo                                 |
| `PROBLEM_ALERT_THRESHOLD`                       | `6`              | Errori consecutivi prima dell'avviso tecnico (~1 min)                                  |
| `NAVIGATION_TIMEOUT_MS`                         | `30000`          | Timeout di navigazione                                                                  |
| `BLOCKED_RETRY_INTERVAL_MS`                     | `120000`         | Frequenza dei retry di navigazione in stato `BLOCKED`                                  |
| `BLOCK_HEAVY_RESOURCES`                         | `true`           | Salta immagini/font/video: controlli più rapidi                                        |

La configurazione viene validata all'avvio: se manca qualcosa ottieni un messaggio chiaro e il processo termina.

## Esecuzione

### Scelta del prodotto

Ordine di precedenza:

1. flag `-p` / `--product`: `npm start -- -p "https://www.amazon.it/dp/B0XXXXXXXX"`;
2. in un terminale, prompt subito dopo il logo: Invio conferma l'ultimo prodotto usato (oppure `AMAZON_URL`);
3. `AMAZON_URL` in `.env`: unica opzione con pm2, launchd o systemd, dove non c'è nessuno a cui chiedere.

Va bene qualsiasi URL prodotto Amazon (con nome prodotto, `ref=`, query parameter...): l'ASIN viene estratto e l'URL normalizzato a `/dp/<ASIN>`. I link corti `amzn.eu` non sono supportati.
Ogni prodotto ha il suo stato (`data/state-<ASIN>.json`), quindi cambiando prodotto non erediti un eventuale "disarmed" dal precedente.

### Telegram: recap e comandi

- **Recap** ogni `RECAP_INTERVAL_HOURS` ore: stato, controlli nel periodo, latenza media, blocchi, errori rete, uptime.
- **Comandi** (visibili nel menu `/` del bot, risponde solo al tuo `TELEGRAM_CHAT_ID`):
  - `/recap`: recap immediato;
  - `/recap N`: recap ogni N ore da adesso (`0` = spento). Vale fino al riavvio;
  - `/check`: controllo immediato con relativo risultato.
- I comandi inviati mentre il watcher era spento vengono ignorati all'avvio.
- Un bot può essere letto da un solo processo: con due watcher sullo stesso bot, i comandi funzionano solo su uno dei due (l'altro lo logga).
- Per capire cosa succede quando i comandi non rispondono (PC spento, crash), usa desktop remoto, ad esempio Chrome Remote Desktop o RustDesk. Ti permette anche di risolvere una CAPTCHA quando sei fuori casa, con `HEADLESS=false`.

### Script npm

Sviluppo (TypeScript diretto):

```bash
npm run dev
```

Produzione:

```bash
npm run build
npm start
```

Altri script:

```bash
npm test                # test unitari (detector + macchina a stati), nessuna rete
npm run typecheck       # tsc su sorgenti e test
npm run test:telegram   # messaggio di prova con pulsante "🛒 OPEN ON AMAZON"
npm run test:amazon     # singolo controllo reale, stampa stato e segnali (-- -p <url> per un altro prodotto, -- --headed per vedere il browser)
```

### Interfaccia terminale

Quando avviato da terminale interattivo (`npm run dev`, `npm start`):

- avvio: animazione splash full-screen (radar, decoding logo, credits; ~2 s, su schermata alternativa del terminale quindi la scrollback resta intatta), poi header compatto, prompt URL prodotto (saltato con `-p`), checklist legata a eventi reali e riepilogo configurazione. Con `-p` i controlli partono subito, in parallelo all'animazione. **Invio** salta l'animazione; `STARTUP_ANIMATION=false` la disattiva, e non viene mostrata su terminali più piccoli di 60×18;
- riga di stato in basso con prossimo controllo, stato, numero controlli, uptime e legenda tasti (si accorcia su terminali stretti);
- controlli consecutivi identici compressi in una sola riga (`×42 since 17:41:03`). Il file log resta completo;
- titolo finestra/scheda che mostra lo stato (⚪ UNAVAILABLE, 🟢 AVAILABLE!, 🟣 BLOCKED…);
- box verde e campanella terminale quando il prodotto diventa disponibile;
- tasti: `c` controllo immediato (anche in BLOCKED, utile dopo aver risolto una CAPTCHA), `o` apre Amazon, `d` mostra/nasconde dettagli detector, `q` o Ctrl+C esce con riepilogo sessione.

Con pm2, launchd, systemd o output reindirizzato su file la UI non si abilita: ottieni righe log semplici, senza colori né sequenze di controllo.

### Log

I log vanno sia in console sia in `logs/watcher.log`, con formati diversi.

**Console in terminale interattivo:** solo orario, colori per stato, controlli identici compressi, riga di stato in basso.

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

Il testo del controllo (es. "Non disponibile…") è quello mostrato da Amazon nella pagina, quindi segue la lingua del sito Amazon.
Le righe più larghe del terminale vengono troncate con `…`: il testo completo resta nel file.
I dettagli detector (`reason=…`) compaiono solo quando cambia lo stato, oppure sempre con il tasto `d` o `LOG_LEVEL=debug`.

**Console senza terminale** (pm2, launchd, systemd, redirect): stesso formato, ma una riga per controllo, senza status line e senza colori.

**File `logs/watcher.log`:** data completa, una riga per controllo, mai compresso. Rotazione a 5 MB, 3 file.

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
├── index.ts                     # wiring, sequenza di avvio, SIGINT/SIGTERM, shutdown pulito
├── cli.ts                       # -p/--product e prompt URL interattivo
├── meta.ts                      # nome, versione, autore
├── Monitor.ts                   # loop: check → transition → notifications → sleep con jitter, statistiche
├── config.ts                    # .env + validazione, normalizzazione URL prodotto
├── amazon/
│   ├── AmazonWatcher.ts         # Chromium persistente, navigazione, crash/restart
│   ├── availabilityDetector.ts  # HTML → AvailabilityResult (funzione pura)
│   └── types.ts
├── state/
│   ├── transitions.ts           # macchina a stati pura (armed, errori, cooldown)
│   └── StateManager.ts          # data/state-<ASIN>.json con scritture atomiche
├── telegram/
│   ├── TelegramNotifier.ts      # Bot API sendMessage + inline keyboard, retry
│   └── TelegramCommands.ts      # /recap, /recap N, /check via long polling
├── notifications/
│   ├── LocalNotifier.ts         # suono + apertura browser (best-effort)
│   ├── Recapper.ts              # recap periodico
│   └── messages.ts              # testi messaggi
├── ui/
│   ├── TerminalUI.ts            # status line, righe compresse, tasti, banner, riepilogo finale
│   ├── splash.ts                # animazione di avvio full-screen
│   ├── intro.ts                 # header compatto + checklist di avvio
│   └── ansi.ts                  # sequenze ANSI, box, troncamento
├── scripts/                     # test:telegram, test:amazon
└── utils/                       # logger (redazione segreti, rotazione), sleep
test/                            # vitest + fixture HTML
```

Il detector riceve l'**HTML renderizzato da Chromium** (`page.content()`, quindi dopo l'esecuzione del JS Amazon)
e lo analizza con `linkedom`. È la stessa funzione usata in produzione e nei test, che girano su
fixture locali senza browser e senza rete.

### `page.goto()` invece di `page.reload()`

Ogni controllo esegue una **navigazione fresca** all'URL prodotto, nella stessa pagina e nello stesso Chromium:

- se Amazon ci ha reindirizzato su CAPTCHA o pagina errore, `reload()` ricaricherebbe _quella_ pagina, mentre `goto()` torna sempre al prodotto;
- dopo un errore rete la pagina è su `chrome-error://`, e `goto()` riparte pulito;
- il costo è lo stesso: stesso processo, stessa cache, stessi cookie.

Il browser usa un **profilo persistente** (`data/browser-profile`): cookie e consensi sopravvivono ai riavvii,
come per un utente normale. Attende `domcontentloaded`, poi fino a 10 s per titolo o CAPTCHA, poi fino a 3 s per la buybox.

### Classificazione (detector)

Segnali raccolti: bottoni `#add-to-cart-button`, `#buy-now-button`, `submit.preorder`, più un
**fallback testuale limitato alla buybox** ("Aggiungi al carrello", "Acquista ora", "Preordina ora", "Add to Cart",
"Buy Now", "Pre-order"), testo `#availability`, `#productTitle`, ASIN pagina e segnali CAPTCHA.
I pattern testuali coprono sia pagine Amazon italiane sia inglesi.

| Esito         | Quando                                                                                                                                                              |
| ------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| `BLOCKED`     | form `validateCaptcha` o `#captchacharacters`; oppure testi come "Robot Check", "Inserisci i caratteri che vedi", "CAPTCHA"... **su pagina senza titolo prodotto** |
| `UNKNOWN`     | titolo mancante (pagina incompleta/errore), ASIN diverso da quello atteso, segnali in conflitto (bottone + "unavailable"), testo positivo senza bottoni            |
| `AVAILABLE`   | titolo presente, ASIN corretto, **almeno un bottone acquisto/preordine visibile e abilitato**, nessun testo negativo                                               |
| `UNAVAILABLE` | titolo presente, nessun bottone attivo e testo negativo ("Attualmente non disponibile", "Currently unavailable"...) o buybox senza bottoni                         |

Regola: **`AVAILABLE` solo con evidenza positiva**. Pagine anomale, errori e timeout non vengono mai trattati come disponibilità.

Punti fragili noti, e come sono gestiti:

- "Add to Cart" compare anche in caroselli di altri prodotti: il fallback testuale cerca solo nella buybox;
- "disponibile" è contenuto in "non disponibile": il testo negativo viene valutato prima;
- bottoni nascosti o disabilitati (`aok-hidden`, `a-button-disabled`, `disabled`) vengono ignorati;
- redirect verso variante o bundle: se l'ASIN differisce il risultato è `UNKNOWN`;
- la parola "captcha" negli script: gli script vengono rimossi, e i segnali testuali contano solo senza titolo prodotto;
- un venditore terzo (anche a prezzo alto) produce comunque `AVAILABLE`: il venditore, quando rilevabile, compare in log e messaggio;
- se Amazon cambia radicalmente il markup, l'esito più probabile è `UNKNOWN` (che dopo qualche check invia avviso tecnico), non un falso positivo.

### Macchina a stati e notifiche

Stati: `STARTING`, `UNKNOWN`, `UNAVAILABLE`, `AVAILABLE`, `BLOCKED`, `NETWORK_ERROR`.

- **Disponibilità**: il watcher parte **armed**. Al primo `AVAILABLE` invia Telegram (con pulsante **🛒 OPEN ON AMAZON**), riproduce il suono e apre il browser se abilitato, poi diventa **disarmed**. Torna armed solo quando vede `UNAVAILABLE`. Lo stato viene mostrato all'avvio e nei recap. Quindi:
  - `UNAVAILABLE → AVAILABLE`: notifica;
  - `AVAILABLE → AVAILABLE`: niente;
  - `AVAILABLE → NETWORK_ERROR → AVAILABLE`: niente (non è una nuova disponibilità);
  - `AVAILABLE → UNAVAILABLE → AVAILABLE`: nuova notifica;
  - se Telegram non risponde, il watcher resta armed e ritenta al check successivo.
- **Persistenza**: `data/state-<ASIN>.json` (scrittura atomica: file temporaneo + `rename`) mantiene ultimo stato, timestamp e flag armed. Dopo un riavvio non rinotifica una disponibilità già notificata.
- **Avvisi tecnici** (policy):
  - `BLOCKED`: un messaggio Telegram immediato, una sola volta per episodio;
  - `NETWORK_ERROR` / `UNKNOWN`: solo log per i primi errori; a `PROBLEM_ALERT_THRESHOLD` errori consecutivi (default 6, ~1 minuto) un messaggio Telegram per episodio;
  - almeno `TECHNICAL_NOTIFICATION_COOLDOWN_MINUTES` tra due avvisi tecnici;
  - ritorno alla normalità: riga di log e, se era stato inviato un avviso, messaggio "✅ back to normal".
- **Rallentamento adattivo**: ogni nuovo episodio `BLOCKED` raddoppia l'intervallo di polling (fino a 8x). Dopo 30 minuti senza nuovi blocchi l'intervallo viene dimezzato, un livello alla volta, fino al valore normale. Ogni variazione viene loggata. Il fattore vive in memoria: riavviando si resetta.
- **Durante `BLOCKED`** il watcher non ricarica a ogni giro. Rilegge la pagina corrente (con `HEADLESS=false` puoi risolvere la verifica a mano nella finestra Chromium) e naviga di nuovo solo ogni `BLOCKED_RETRY_INTERVAL_MS`.

### Robustezza

- Timeout, `ERR_CONNECTION_RESET`, DNS e fallimenti di navigazione diventano `NETWORK_ERROR` e il loop continua.
- Crash pagina/browser, o context chiuso: Chromium viene ricreato con backoff esponenziale (2 s → 2 min).
- Telegram non raggiungibile: 3 tentativi con backoff (rispetta `retry_after`), poi prosegue. Il polling comandi ritenta autonomamente con backoff (5 s → 60 s).
- Suono e apertura browser sono best-effort: gli errori finiscono nei log e vengono ignorati.
- `SIGINT`/`SIGTERM` (oppure `q`/Ctrl+C nella UI): il loop si ferma, Chromium viene chiuso in modo pulito, uscita 0. Un secondo segnale entro 2 s viene ignorato (sotto `npm` Ctrl+C arriva due volte); un segnale successivo forza l'uscita.
- Il token Telegram non viene mai loggato: il logger maschera qualsiasi stringa che sembri un token.

---

## Avvio automatico con il PC

Esegui prima `npm run build`. Nei comandi sotto sostituisci `/path/to/amazon-stock-watcher` con il percorso reale.

Quando avviato come servizio non c'è terminale: prompt URL e UI interattiva non compaiono. Il prodotto deve essere fornito
con `AMAZON_URL` in `.env` oppure con `-p <url>` negli argomenti (negli esempi sotto: `-p https://www.amazon.it/dp/B0XXXXXXXX`).

### Windows: PM2 (più semplice)

```powershell
npm install -g pm2 pm2-windows-startup
cd C:\path\to\amazon-stock-watcher
pm2 start dist/index.js --name amazon-watcher -- -p https://www.amazon.it/dp/B0XXXXXXXX
pm2 save
pm2-startup install
```

`pm2 logs amazon-watcher` mostra i log, `pm2 restart amazon-watcher` lo riavvia.

### Windows: Utilità di pianificazione

1. _Task Scheduler_ → **Create Task**.
2. _General_: "Run only when user is logged on" (necessario per suono e apertura browser).
3. _Triggers_: **At log on**.
4. _Actions_: programma `C:\Program Files\nodejs\node.exe`, argomenti `dist\index.js -p https://www.amazon.it/dp/B0XXXXXXXX`, _Start in_ `C:\path\to\amazon-stock-watcher`.
5. _Settings_: "If the task fails, restart every 1 minute" e togli la spunta da "Stop the task if it runs longer than...".

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

Per fermarlo: `launchctl unload ...`. Mantieni il Mac attivo (Impostazioni → Batteria/Energia, oppure `caffeinate -s`).

### Linux: systemd (utente)

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
loginctl enable-linger $USER    # parte anche senza login
journalctl --user -u amazon-stock-watcher -f
```

---

## Sicurezza

- `.env`, `data/` e `logs/` sono in `.gitignore`: non committare mai segreti.
- Il codice non effettua login Amazon, non aggiunge al carrello, non fa checkout, non risolve né bypassa CAPTCHA, e non usa plugin stealth, proxy o fingerprint spoofing.
- Polling con jitter (default 9-14 s) e rallentamento automatico quando Amazon richiede verifiche: comportamento simile a un utente che ricarica la pagina, non a un crawler.
- I comandi Telegram vengono gestiti solo per il `TELEGRAM_CHAT_ID` configurato; i messaggi da altre chat vengono ignorati.

## Note legali

Questo è un progetto personale, non commerciale, realizzato per scopi educativi. Non è affiliato,
approvato o sponsorizzato da Amazon. "Amazon" è un marchio di Amazon.com, Inc. o delle sue affiliate,
usato qui solo per descrivere cosa monitora lo strumento.

L'accesso automatizzato può entrare in conflitto con le Condizioni d'Uso di Amazon. Sei l'unico responsabile
dell'utilizzo di questo tool e del rispetto dei termini Amazon e delle leggi applicabili.

Il software è fornito "così com'è", senza alcuna garanzia (vedi [LICENSE](LICENSE)): può perdere una
finestra di disponibilità, essere bloccato da Amazon, o smettere di funzionare se Amazon modifica le sue pagine.

## Licenza

Copyright (C) 2026 [@mpellicc](https://github.com/mpellicc)

Questo programma è software libero: puoi ridistribuirlo e/o modificarlo secondo i termini della
GNU General Public License pubblicata dalla Free Software Foundation, versione 3 della Licenza,
o (a tua scelta) qualsiasi versione successiva. Vedi [LICENSE](LICENSE) per il testo completo.

In breve: puoi usare, studiare, modificare e condividere il progetto, ma qualsiasi versione distribuita
(modificata o meno) deve restare sotto GPL e includere il codice sorgente.
