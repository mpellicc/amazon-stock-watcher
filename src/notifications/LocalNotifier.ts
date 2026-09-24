import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { describeError, logger } from "../utils/logger.js";

/*
 * Best-effort local notifications: every error is logged and ignored.
 * No external dependencies: native OS commands only.
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
        run("sh", ["-c", `for i in $(seq ${REPEAT}); do afplay '${MAC_SOUND}'; done`], "sound");
        return;
      case "win32":
        run(
          "powershell",
          [
            "-NoProfile",
            "-Command",
            `$p = New-Object Media.SoundPlayer '${WINDOWS_SOUND}'; 1..${REPEAT} | ForEach-Object { $p.PlaySync() }`,
          ],
          "sound",
        );
        return;
      default: {
        const file = LINUX_SOUNDS.find((f) => existsSync(f));
        if (file) run("sh", ["-c", `for i in $(seq ${REPEAT}); do paplay '${file}' || aplay '${file}'; done`], "sound");
        else process.stdout.write("\x07\x07\x07");
      }
    }
  }

  openUrl(url: string): void {
    if (!/^https:\/\//.test(url)) return;
    if (process.platform === "darwin") run("open", [url], "open browser");
    else if (process.platform === "win32") run("cmd", ["/c", "start", "", url], "open browser");
    else run("xdg-open", [url], "open browser");
  }
}

function run(cmd: string, args: string[], what: string): void {
  try {
    const child = spawn(cmd, args, { stdio: "ignore", detached: true, windowsHide: true });
    child.on("error", (err) => logger.warn(`Local notification (${what}) failed: ${describeError(err)}`));
    child.unref();
  } catch (err) {
    logger.warn(`Local notification (${what}) failed: ${describeError(err)}`);
  }
}
