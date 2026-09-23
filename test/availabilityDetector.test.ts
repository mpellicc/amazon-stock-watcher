import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAvailability } from "../src/amazon/availabilityDetector.js";

const ASIN = "B0F2TN43GH";
const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const detect = (name: string) => detectAvailability(fixture(name), { expectedAsin: ASIN });

describe("detectAvailability", () => {
  it("prodotto non disponibile → UNAVAILABLE (ignora bottone nascosto e carosello)", () => {
    const r = detect("unavailable.html");
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.title).toBe("Console Gaming Edizione Standard");
    expect(r.availabilityText).toContain("Attualmente non disponibile");
    expect(r.signals).toMatchObject({
      addToCart: false,
      buyNow: false,
      preorder: false,
      availabilityNegative: true,
      availabilityPositive: false,
      captchaDetected: false,
    });
  });

  it("Add to Cart + Buy Now → AVAILABLE", () => {
    const r = detect("available-add-to-cart.html");
    expect(r.state).toBe("AVAILABLE");
    expect(r.signals).toMatchObject({ addToCart: true, buyNow: true, preorder: false, availabilityPositive: true });
    expect(r.buttonLabel).toBe("Aggiungi al carrello");
    expect(r.merchant).toBe("Amazon.it");
  });

  it("preorder → AVAILABLE con preorder=true", () => {
    const r = detect("available-preorder.html");
    expect(r.state).toBe("AVAILABLE");
    expect(r.signals).toMatchObject({ preorder: true, addToCart: false, buyNow: false, availabilityPositive: true });
    expect(r.buttonLabel).toBe("Preordina ora");
    expect(r.reason).toBe("Preorder button detected");
  });

  it("preorder in inglese con ID cambiati → AVAILABLE tramite fallback testuale nel buybox", () => {
    const r = detectAvailability(fixture("preorder-english-renamed-ids.html"));
    expect(r.state).toBe("AVAILABLE");
    expect(r.signals.preorder).toBe(true);
  });

  it("CAPTCHA (form validateCaptcha) → BLOCKED", () => {
    const r = detect("captcha.html");
    expect(r.state).toBe("BLOCKED");
    expect(r.signals.captchaDetected).toBe(true);
  });

  it("Robot Check solo testuale → BLOCKED", () => {
    expect(detect("robot-check-text-only.html").state).toBe("BLOCKED");
  });

  it("pagina incompleta (senza titolo) → UNKNOWN anche se c'è un bottone", () => {
    const r = detect("incomplete.html");
    expect(r.state).toBe("UNKNOWN");
    expect(r.state).not.toBe("AVAILABLE");
  });

  it("pagina d'errore Amazon → UNKNOWN", () => {
    expect(detect("error-page.html").state).toBe("UNKNOWN");
  });

  it("HTML vuoto o spazzatura → UNKNOWN", () => {
    expect(detectAvailability("", { expectedAsin: ASIN }).state).toBe("UNKNOWN");
    expect(detectAvailability("<<<not html", { expectedAsin: ASIN }).state).toBe("UNKNOWN");
  });

  it("segnali in conflitto (testo negativo + bottone) → UNKNOWN", () => {
    expect(detect("conflicting.html").state).toBe("UNKNOWN");
  });

  it("bottoni disabilitati → UNAVAILABLE", () => {
    const r = detect("disabled-buttons.html");
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.signals.addToCart).toBe(false);
    expect(r.signals.buyNow).toBe(false);
  });

  it("ASIN diverso (redirect a variante) → UNKNOWN", () => {
    const r = detect("other-asin.html");
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toContain("ASIN mismatch");
  });

  it("la parola 'captcha' negli script di una pagina prodotto non causa BLOCKED", () => {
    expect(detect("unavailable.html").signals.captchaDetected).toBe(false);
  });
});
