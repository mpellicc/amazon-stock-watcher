import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describeError, logger } from "../utils/logger.js";

/*
 * Notifiche locali best-effort: ogni errore viene loggato e ignorato.
 * Nessuna dipendenza esterna: si usano i comandi nativi del sistema operativo.
 */

const MAC_SOUND = "/System/Library/Sounds/Glass.aiff";
const LINUX_SOUNDS = [
  "/usr/share/sounds/freedesktop/stereo/alarm-clock-elapsed.oga",
  "/usr/share/sounds/freedesktop/stereo/complete.oga",
];
const WINDOWS_SOUND = "C:\\Windows\\Media\\Alarm01.wav";
const REPEAT = 4;

export class LocalNotifier {
  constructor(private readonly options: { soundEnabled: boolean; openBrowser: boolean }) {}

  alertAvailable(url: string): void {
    if (this.options.soundEnabled) this.playSound();
    if (this.options.openBrowser) this.openUrl(url);
  }

  playSound(): void {
    switch (process.platform) {
      case "darwin":
        run("sh", ["-c", `for i in $(seq ${REPEAT}); do afplay '${MAC_SOUND}'; done`], "suono");
        return;
      case "win32":
        run(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `$p = New-Object Media.SoundPlayer '${WINDOWS_SOUND}'; 1..${REPEAT} | ForEach-Object { $p.PlaySync() }`,
          ],
          "suono",
        );
        return;
      default: {
        const file = LINUX_SOUNDS.find((f) => existsSync(f));
        if (file) run("sh", ["-c", `for i in $(seq ${REPEAT}); do paplay '${file}' || aplay '${file}'; done`], "suono");
        else process.stdout.write("\x07\x07\x07");
      }
    }
  }

  openUrl(url: string): void {
    if (!/^https:\/\//.test(url)) return;
    if (process.platform === "darwin") run("open", [url], "apertura browser");
    else if (process.platform === "win32") run("cmd", ["/c", "start", "", url], "apertura browser");
    else run("xdg-open", [url], "apertura browser");
  }
}

function run(cmd: string, args: string[], what: string): void {
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", (err) => logger.warn(`Notifica locale (${what}) fallita: ${describeError(err)}`));
    child.unref();
  } catch (err) {
    logger.warn(`Notifica locale (${what}) fallita: ${describeError(err)}`);
  }
}
