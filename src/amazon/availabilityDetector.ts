import { parseHTML } from "linkedom";
import type { AvailabilityResult, AvailabilitySignals } from "./types.js";

/*
 * Il detector lavora sull'HTML renderizzato da Chromium (page.content()), così la stessa
 * funzione gira in produzione e nei test con fixture locali, senza browser.
 *
 * Regola d'oro: AVAILABLE solo con evidenza positiva (un bottone d'acquisto attivo nel
 * buybox del prodotto giusto). Nel dubbio: UNKNOWN.
 */

// Contenitori del buybox: la ricerca testuale dei bottoni è limitata a queste aree,
// perché "Aggiungi al carrello" compare anche nei caroselli di altri prodotti.
const BUYBOX_SELECTORS = [
  "#buybox",
  "#desktop_buybox",
  "#buyBoxAccordion",
  "#qualifiedBuybox",
  "#newAccordionRow",
  "#exports_desktop_qualifiedBuybox",
  "#addToCart",
  "#buyNow",
];

const ADD_TO_CART_IDS = ["#add-to-cart-button", "#add-to-cart-button-ubb", 'input[name="submit.add-to-cart"]'];
const BUY_NOW_IDS = ["#buy-now-button", 'input[name="submit.buy-now"]'];
const PREORDER_IDS = ['input[name="submit.preorder"]', "#preorder-button"];

const CLICKABLE = 'input[type="submit"], input[type="button"], button, a.a-button-text, [role="button"]';

const RE_PREORDER = /\bpre-?ordin[ae]\b|\bpre-?order\b|\bpreordina\b/i;
const RE_ADD_TO_CART = /aggiungi al carrello|add to (cart|basket)/i;
const RE_BUY_NOW = /acquista ora|compra ora|buy now/i;

const RE_AVAIL_NEGATIVE =
  /non disponibile|non è disponibile|non sappiamo se|temporaneamente esaurit|esaurit[oa]|currently unavailable|temporarily out of stock|out of stock|unavailable|non più disponibile/i;
const RE_AVAIL_POSITIVE =
  /disponibil|in stock|preordin|pre-?order|sar[aà] (disponibile|rilasciato)|data di uscita|will be released|only \d+ left|solo \d+/i;

const CAPTCHA_TEXT_PATTERNS = [
  /robot check/i,
  /enter the characters you see below/i,
  /inserisci i caratteri che vedi/i,
  /\bcaptcha\b/i,
  /type the characters you see in this image/i,
  /digita i caratteri che vedi/i,
  /sorry, we just need to make sure you're not a robot/i,
  /dobbiamo solo assicurarci che tu non sia un robot/i,
  /fai clic sul pulsante qui sotto per continuare/i,
  /click the button below to continue shopping/i,
];

const HIDDEN_ANCESTOR =
  '[hidden], .aok-hidden, .a-hidden, [style*="display:none"], [style*="display: none"], [style*="visibility:hidden"], [style*="visibility: hidden"]';

export interface DetectOptions {
  expectedAsin?: string;
}

type Doc = ReturnType<typeof parseHTML>["document"];
type El = NonNullable<ReturnType<Doc["querySelector"]>>;

export function detectAvailability(html: string, options: DetectOptions = {}): AvailabilityResult {
  const { document } = parseHTML(html);
  // Script/style contengono testo che non è visibile (e a volte la parola "captcha").
  for (const el of document.querySelectorAll("script, style, noscript, template")) el.remove();

  const title = textOf(document.querySelector("#productTitle")) || undefined;
  const availabilityText = readAvailabilityText(document);
  const buttons = findPurchaseButtons(document);
  const captchaDetected = detectCaptcha(document, Boolean(title));

  const availabilityNegative = availabilityText ? RE_AVAIL_NEGATIVE.test(availabilityText) : false;
  const availabilityPositive =
    availabilityText && !availabilityNegative ? RE_AVAIL_POSITIVE.test(availabilityText) : false;

  const signals: AvailabilitySignals = {
    addToCart: buttons.addToCart,
    buyNow: buttons.buyNow,
    preorder: buttons.preorder,
    availabilityPositive,
    availabilityNegative,
    captchaDetected,
  };
  const base = { title, availabilityText, buttonLabel: buttons.label, merchant: readMerchant(document), signals };

  if (captchaDetected) return { ...base, state: "BLOCKED", reason: "CAPTCHA / Robot Check detected" };
  if (!title) return { ...base, state: "UNKNOWN", reason: "Product title missing: page incomplete or not a product page" };

  const pageAsin = readPageAsin(document);
  if (options.expectedAsin && pageAsin && pageAsin !== options.expectedAsin.toUpperCase()) {
    return { ...base, state: "UNKNOWN", reason: `ASIN mismatch: page shows ${pageAsin}, expected ${options.expectedAsin}` };
  }

  const anyButton = buttons.addToCart || buttons.buyNow || buttons.preorder;

  if (anyButton && availabilityNegative) {
    return { ...base, state: "UNKNOWN", reason: "Conflicting signals: purchase button present but availability text is negative" };
  }
  if (anyButton) return { ...base, state: "AVAILABLE", reason: describeButtons(buttons) };
  if (availabilityNegative) return { ...base, state: "UNAVAILABLE", reason: "Negative availability text and no purchase button" };
  if (hasBuybox(document)) {
    return { ...base, state: "UNAVAILABLE", reason: "Buybox present without purchase buttons" };
  }
  if (availabilityPositive) {
    return { ...base, state: "UNKNOWN", reason: "Positive availability text but no purchase button (not trusted alone)" };
  }
  return { ...base, state: "UNKNOWN", reason: "No availability info and no buybox found" };
}

/** Riga di log spiegabile: stato + segnali. */
export function explainResult(r: AvailabilityResult): string {
  const s = r.signals;
  return [
    `reason="${r.reason}"`,
    `availabilityText="${r.availabilityText ?? ""}"`,
    `button="${r.buttonLabel ?? ""}"`,
    `merchant="${r.merchant ?? ""}"`,
    `addToCart=${s.addToCart} buyNow=${s.buyNow} preorder=${s.preorder}`,
    `availPositive=${s.availabilityPositive} availNegative=${s.availabilityNegative} captcha=${s.captchaDetected}`,
  ].join(" ");
}

interface ButtonScan {
  addToCart: boolean;
  buyNow: boolean;
  preorder: boolean;
  label?: string;
}

function findPurchaseButtons(document: Doc): ButtonScan {
  const scan: ButtonScan = { addToCart: false, buyNow: false, preorder: false };
  const note = (label: string | undefined): void => {
    if (label && (!scan.label || RE_PREORDER.test(label))) scan.label = label;
  };

  // 1) ID/name noti di Amazon (univoci nella pagina prodotto).
  for (const el of queryAll(document, ADD_TO_CART_IDS)) {
    if (!isUsable(el)) continue;
    const label = buttonLabel(document, el);
    if (label && RE_PREORDER.test(label)) scan.preorder = true;
    else scan.addToCart = true;
    note(label || "Aggiungi al carrello");
  }
  for (const el of queryAll(document, BUY_NOW_IDS)) {
    if (!isUsable(el)) continue;
    const label = buttonLabel(document, el);
    if (label && RE_PREORDER.test(label)) scan.preorder = true;
    else scan.buyNow = true;
    note(label || "Acquista ora");
  }
  for (const el of queryAll(document, PREORDER_IDS)) {
    if (!isUsable(el)) continue;
    scan.preorder = true;
    note(buttonLabel(document, el) || "Preordina ora");
  }

  // 2) Fallback testuale, solo dentro il buybox (resiste a cambi di ID).
  for (const box of queryAll(document, BUYBOX_SELECTORS)) {
    for (const el of box.querySelectorAll(CLICKABLE)) {
      if (!isUsable(el)) continue;
      const label = buttonLabel(document, el);
      if (!label) continue;
      if (RE_PREORDER.test(label)) scan.preorder = true;
      else if (RE_ADD_TO_CART.test(label)) scan.addToCart = true;
      else if (RE_BUY_NOW.test(label)) scan.buyNow = true;
      else continue;
      note(label);
    }
  }
  return scan;
}

function buttonLabel(document: Doc, el: El): string {
  const labelledBy = el.getAttribute("aria-labelledby");
  if (labelledBy) {
    const text = labelledBy
      .split(/\s+/)
      .map((id: string) => textOf(document.getElementById(id)))
      .join(" ")
      .trim();
    if (text) return text;
  }
  const candidates = [
    el.getAttribute("aria-label"),
    el.getAttribute("value"),
    el.getAttribute("title"),
    textOf(el),
    textOf(el.closest(".a-button")),
  ];
  for (const c of candidates) {
    const t = normalize(c ?? "");
    // value="Submit"/"1" non è un'etichetta utile.
    if (t && !/^(submit|\d+)$/i.test(t)) return t;
  }
  return "";
}

function isUsable(el: El): boolean {
  if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
  if (el.closest(".a-button-disabled")) return false;
  if (el.closest(HIDDEN_ANCESTOR)) return false;
  return true;
}

function detectCaptcha(document: Doc, hasProductTitle: boolean): boolean {
  // Segnali strutturali: affidabili anche se la pagina contiene altro.
  if (document.querySelector('form[action*="validateCaptcha"], #captchacharacters, input[name="amzn-captcha-verify"]')) {
    return true;
  }
  // Segnali testuali: solo se non siamo su una pagina prodotto vera.
  if (hasProductTitle) return false;
  // querySelector invece di document.title/body: su HTML malformato linkedom non ha documentElement.
  const haystack = `${textOf(document.querySelector("title"))} ${textOf(document.querySelector("body")).slice(0, 5000)}`;
  return CAPTCHA_TEXT_PATTERNS.some((re) => re.test(haystack));
}

function readAvailabilityText(document: Doc): string | undefined {
  for (const sel of ["#availability", "#availabilityInsideBuyBox_feature_div", "#outOfStock", "#availability_feature_div"]) {
    const el = document.querySelector(sel);
    if (!el || el.closest(HIDDEN_ANCESTOR)) continue;
    const text = textOf(el);
    if (text) return text.length > 200 ? `${text.slice(0, 200)}…` : text;
  }
  return undefined;
}

function readMerchant(document: Doc): string | undefined {
  const el =
    document.querySelector("#sellerProfileTriggerId") ??
    document.querySelector('#merchantInfoFeature_feature_div .offer-display-feature-text-message') ??
    document.querySelector("#merchant-info");
  const text = textOf(el);
  return text ? text.slice(0, 80) : undefined;
}

function readPageAsin(document: Doc): string | undefined {
  const el = document.querySelector('#ASIN, input[name="ASIN"], input[name="asin"]');
  const value = el?.getAttribute("value")?.trim().toUpperCase();
  return value && /^[A-Z0-9]{10}$/.test(value) ? value : undefined;
}

function hasBuybox(document: Doc): boolean {
  return queryAll(document, ["#buybox", "#desktop_buybox", "#buyBoxAccordion", "#qualifiedBuybox"]).length > 0;
}

function describeButtons(b: ButtonScan): string {
  if (b.preorder) return "Preorder button detected";
  if (b.addToCart && b.buyNow) return "Add to Cart and Buy Now buttons detected";
  if (b.addToCart) return "Add to Cart button detected";
  return "Buy Now button detected";
}

function queryAll(root: Doc | El, selectors: string[]): El[] {
  return selectors.flatMap((sel) => Array.from(root.querySelectorAll(sel)));
}

function textOf(el: El | null | undefined): string {
  return el ? normalize(el.textContent ?? "") : "";
}

function normalize(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}
