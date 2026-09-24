import { existsSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { dirname } from "node:path";
import { createInterface } from "node:readline/promises";
import { parseArgs } from "node:util";
import { parseProductUrl } from "./config.js";

const LAST_PRODUCT_FILE = "data/last-product.txt";

export interface CliArgs {
  product?: string;
  headed: boolean;
}

/** Parses -p/--product and --headed. Throws on an invalid product URL. */
export function parseCliArgs(argv: string[] = process.argv.slice(2)): CliArgs {
  const { values } = parseArgs({
    args: argv,
    options: { product: { type: "string", short: "p" }, headed: { type: "boolean" } },
    strict: false,
  });
  const product = typeof values.product === "string" ? values.product : undefined;
  if (product !== undefined && !parseProductUrl(product)) throw new Error(`Invalid URL for --product: "${product}"`);
  return { product, headed: values.headed === true };
}

/** Default offered by the prompt: last product used, otherwise AMAZON_URL. */
export function defaultProductUrl(): string {
  return readLastProduct() ?? process.env.AMAZON_URL?.trim() ?? "";
}

export function rememberProduct(url: string): void {
  try {
    mkdirSync(dirname(LAST_PRODUCT_FILE), { recursive: true });
    writeFileSync(LAST_PRODUCT_FILE, url + "\n");
  } catch {
    // Just a convenience for the next prompt: failing is fine.
  }
}

/**
 * Asks for the product URL until a valid one is entered (Enter = fallback).
 * Ctrl+C during the prompt exits the process: nothing has been started yet.
 */
export async function promptProductUrl(fallback: string, options: { indent?: string; label?: string } = {}): Promise<string> {
  const indent = options.indent ?? "";
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  rl.on("SIGINT", () => {
    rl.close();
    process.stdout.write("\n");
    process.exit(130);
  });
  try {
    for (;;) {
      const hint = fallback ? ` [${fallback}]` : "";
      const answer = (await rl.question(`${indent}${options.label ?? "Amazon product URL"}${hint}: `)).trim() || fallback;
      if (answer && parseProductUrl(answer)) return answer;
      process.stdout.write(`${indent}  Invalid URL: an https Amazon link containing /dp/<ASIN> is required.\n`);
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
