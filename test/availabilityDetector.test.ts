import { readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { detectAvailability } from "../src/amazon/availabilityDetector.js";

const ASIN = "B0F2TN43GH";
const fixture = (name: string): string => readFileSync(join(import.meta.dirname, "fixtures", name), "utf8");
const detect = (name: string) => detectAvailability(fixture(name), { expectedAsin: ASIN });

describe("detectAvailability", () => {
  it("unavailable product → UNAVAILABLE (ignores hidden button and carousel)", () => {
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

  it("preorder → AVAILABLE with preorder=true", () => {
    const r = detect("available-preorder.html");
    expect(r.state).toBe("AVAILABLE");
    expect(r.signals).toMatchObject({ preorder: true, addToCart: false, buyNow: false, availabilityPositive: true });
    expect(r.buttonLabel).toBe("Preordina ora");
    expect(r.reason).toBe("Preorder button detected");
  });

  it("English preorder with changed IDs → AVAILABLE via text fallback in the buybox", () => {
    const r = detectAvailability(fixture("preorder-english-renamed-ids.html"));
    expect(r.state).toBe("AVAILABLE");
    expect(r.signals.preorder).toBe(true);
  });

  it("CAPTCHA (form validateCaptcha) → BLOCKED", () => {
    const r = detect("captcha.html");
    expect(r.state).toBe("BLOCKED");
    expect(r.signals.captchaDetected).toBe(true);
  });

  it("text-only Robot Check → BLOCKED", () => {
    expect(detect("robot-check-text-only.html").state).toBe("BLOCKED");
  });

  it("incomplete page (no title) → UNKNOWN even with a button", () => {
    const r = detect("incomplete.html");
    expect(r.state).toBe("UNKNOWN");
    expect(r.state).not.toBe("AVAILABLE");
  });

  it("Amazon error page → UNKNOWN", () => {
    expect(detect("error-page.html").state).toBe("UNKNOWN");
  });

  it("empty or garbage HTML → UNKNOWN", () => {
    expect(detectAvailability("", { expectedAsin: ASIN }).state).toBe("UNKNOWN");
    expect(detectAvailability("<<<not html", { expectedAsin: ASIN }).state).toBe("UNKNOWN");
  });

  it("conflicting signals (negative text + button) → UNKNOWN", () => {
    expect(detect("conflicting.html").state).toBe("UNKNOWN");
  });

  it("disabled buttons → UNAVAILABLE", () => {
    const r = detect("disabled-buttons.html");
    expect(r.state).toBe("UNAVAILABLE");
    expect(r.signals.addToCart).toBe(false);
    expect(r.signals.buyNow).toBe(false);
  });

  it("different ASIN (redirect to a variant) → UNKNOWN", () => {
    const r = detect("other-asin.html");
    expect(r.state).toBe("UNKNOWN");
    expect(r.reason).toContain("ASIN mismatch");
  });

  it("the word 'captcha' in product page scripts does not cause BLOCKED", () => {
    expect(detect("unavailable.html").signals.captchaDetected).toBe(false);
  });
});
