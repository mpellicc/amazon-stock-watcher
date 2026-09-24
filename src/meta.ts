import { readFileSync } from "node:fs";

/** App metadata shown in the terminal and in the logs. */
export const APP_NAME = "Amazon Stock Watcher";
export const AUTHOR = "@mpellicc";
export const REPO_URL = "https://github.com/mpellicc/amazon-stock-watcher";

// package.json sits one level above both src/ (tsx) and dist/ (build).
export const APP_VERSION = readVersion();

function readVersion(): string {
  try {
    const pkg: unknown = JSON.parse(readFileSync(new URL("../package.json", import.meta.url), "utf8"));
    const version = typeof pkg === "object" && pkg !== null ? (pkg as { version?: unknown }).version : undefined;
    return typeof version === "string" ? version : "dev";
  } catch {
    return "dev";
  }
}
