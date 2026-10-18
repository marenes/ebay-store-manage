export interface PricingRules {
  /** Profit as a share of supplier cost, e.g. 0.2 = 20%. */
  markupPercent: number;
  /** Minimum profit per sale in listing currency, applied when markup gives less. */
  minProfit: number;
  /** eBay final value fee + payment processing, as a share of the sale price. */
  ebayFeePercent: number;
  /** Fixed per-order fee charged by eBay. */
  ebayFixedFee: number;
  /** Extra cost you pay per order (shipping not included by the supplier, packaging...). */
  extraCost: number;
  /** Quantity to show on eBay while the supplier has stock. */
  quantityWhenInStock: number;
  /** Stop selling when the supplier cost goes above this amount. */
  maxSupplierPrice?: number;
  /** Price ending, e.g. 0.99 gives 24.99. Omit to keep cents as computed. */
  priceEnding?: number;
}

export const defaultRules: PricingRules = {
  markupPercent: 0.2,
  minProfit: 3,
  ebayFeePercent: 0.136,
  ebayFixedFee: 0.4,
  extraCost: 0,
  quantityWhenInStock: 3,
  priceEnding: 0.99,
};

export interface SupplierSnapshot {
  price: number | null;
  shippingCost: number;
  inStock: boolean;
}

export interface ListingDecision {
  price: number | null;
  quantity: number;
  expectedProfit: number | null;
  reason: string;
}

const round2 = (n: number) => Math.round(n * 100) / 100;

export function applyPriceEnding(price: number, ending: number | undefined): number {
  if (ending === undefined) return round2(price);
  const whole = Math.floor(price);
  const candidate = whole + ending;
  return round2(candidate >= price - 1e-9 ? candidate : candidate + 1);
}

/** Profit left after eBay fees and supplier costs for a given sale price. */
export function profitAt(price: number, supplier: SupplierSnapshot, rules: PricingRules): number {
  const cost = (supplier.price ?? 0) + supplier.shippingCost + rules.extraCost;
  return round2(price * (1 - rules.ebayFeePercent) - rules.ebayFixedFee - cost);
}

export function decideListing(supplier: SupplierSnapshot, rules: PricingRules = defaultRules): ListingDecision {
  if (!supplier.inStock || supplier.price === null) {
    return { price: null, quantity: 0, expectedProfit: null, reason: "supplier out of stock" };
  }
  if (rules.maxSupplierPrice !== undefined && supplier.price > rules.maxSupplierPrice) {
    return { price: null, quantity: 0, expectedProfit: null, reason: "supplier price above limit" };
  }
  const cost = supplier.price + supplier.shippingCost + rules.extraCost;
  const targetProfit = Math.max(rules.minProfit, supplier.price * rules.markupPercent);
  const raw = (cost + rules.ebayFixedFee + targetProfit) / (1 - rules.ebayFeePercent);
  const price = applyPriceEnding(raw, rules.priceEnding);
  return {
    price,
    quantity: rules.quantityWhenInStock,
    expectedProfit: profitAt(price, supplier, rules),
    reason: "in stock",
  };
}
