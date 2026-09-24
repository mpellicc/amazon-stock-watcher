import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { parseProductUrl } from "./config.js";

const LAST_PRODUCT_FILE = "data/last-product.txt";

/**
 * Sceglie l'URL del prodotto: flag -p/--product → richiesta interattiva (solo da terminale,
 * Invio = ultimo usato o AMAZON_URL) → undefined (loadConfig userà AMAZON_URL o darà errore).
 */
export async function resolveProductUrl(argv: string[] = process.argv.slice(2)): Promise<string | undefined> {
  const { values } = parseArgs({
    args: argv,
    options: { product: { type: "string", short: "p" }, headed: { type: "boolean" } },
    strict: false,
  });
  const fromFlag = typeof values.product === "string" ? values.product : undefined;
  if (fromFlag) {
    if (!parseProductUrl(fromFlag)) throw new Error(`URL non valido per --product: "${fromFlag}"`);
    return fromFlag;
  }
  if (!process.stdin.isTTY || !process.stdout.isTTY) return undefined;
  return promptProductUrl(readLastProduct() ?? process.env.AMAZON_URL?.trim() ?? "");
}

export function rememberProduct(url: string): void {
  try {
    mkdirSync(dirname(LAST_PRODUCT_FILE), { recursive: true });
    writeFileSync(LAST_PRODUCT_FILE, url + "\n");
  } catch {
    // Solo una comodità per la prossima richiesta: se fallisce, pazienza.
  }
}

async function promptProductUrl(fallback: string): Promise<string> {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  try {
    for (;;) {
      const hint = fallback ? ` [${fallback}]` : "";
      const answer = (await rl.question(`URL prodotto Amazon${hint}: `)).trim() || fallback;
      if (answer && parseProductUrl(answer)) return answer;
      console.log("  URL non valido: serve un link https di Amazon che contenga /dp/<ASIN>.");
    }
  } finally {
    rl.close();
  }
}

function readLastProduct(): string | undefined {
  if (!existsSync(LAST_PRODUCT_FILE)) return undefined;
  const url = readFileSync(LAST_PRODUCT_FILE, "utf8").trim();
  return parseProductUrl(url) ? url : undefined;
}
