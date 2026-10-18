import { describe, expect, it } from "vitest";
import { applyPriceEnding, decideListing, defaultRules, profitAt } from "../src/pricing/rules.js";

describe("decideListing", () => {
  it("zeroes quantity when the supplier is out of stock", () => {
    const d = decideListing({ price: 10, shippingCost: 0, inStock: false });
    expect(d).toMatchObject({ quantity: 0, price: null });
  });

  it("zeroes quantity when supplier price exceeds the limit", () => {
    const d = decideListing({ price: 120, shippingCost: 0, inStock: true }, { ...defaultRules, maxSupplierPrice: 100 });
    expect(d.quantity).toBe(0);
  });

  it("never prices below the target profit after fees", () => {
    for (const cost of [1, 7.5, 19.99, 49, 230]) {
      const supplier = { price: cost, shippingCost: 2, inStock: true };
      const d = decideListing(supplier);
      const target = Math.max(defaultRules.minProfit, cost * defaultRules.markupPercent);
      expect(d.price).not.toBeNull();
      expect(profitAt(d.price!, supplier, defaultRules)).toBeGreaterThanOrEqual(target - 0.01);
      expect(d.quantity).toBe(defaultRules.quantityWhenInStock);
    }
  });

  it("uses min profit for cheap items", () => {
    const d = decideListing({ price: 5, shippingCost: 0, inStock: true });
    expect(d.expectedProfit).toBeGreaterThanOrEqual(3);
  });
});

describe("applyPriceEnding", () => {
  it("rounds up to the ending", () => {
    expect(applyPriceEnding(24.1, 0.99)).toBe(24.99);
    expect(applyPriceEnding(24.995, 0.99)).toBe(25.99);
    expect(applyPriceEnding(24.99, 0.99)).toBe(24.99);
    expect(applyPriceEnding(24.123, undefined)).toBe(24.12);
  });
});
