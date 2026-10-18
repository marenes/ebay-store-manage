import { type Db, getSetting, logEvent } from "../db.js";
import type { PriceQuantityUpdate, UpdateResult } from "../ebay/inventory.js";
import { decideListing, defaultRules, type PricingRules } from "../pricing/rules.js";
import type { Supplier } from "../suppliers/types.js";

interface ProductRow {
  sku: string;
  ebay_offer_id: string | null;
  supplier: string;
  supplier_product_id: string;
  rule_set: string;
  listing_price: number | null;
  listing_quantity: number | null;
}

export interface PriceSyncDeps {
  db: Db;
  suppliers: Supplier[];
  /** Pushes changes to eBay; injected so the job can run without the network in tests or dry runs. */
  pushUpdates: (updates: PriceQuantityUpdate[]) => Promise<UpdateResult[]>;
}

export function rulesFor(db: Db, ruleSet: string): PricingRules {
  const stored = getSetting(db, `rules.${ruleSet}`);
  return { ...defaultRules, ...(stored ? (JSON.parse(stored) as Partial<PricingRules>) : {}) };
}

export interface PriceSyncSummary {
  checked: number;
  changed: number;
  failed: number;
}

export async function syncPrices({ db, suppliers, pushUpdates }: PriceSyncDeps): Promise<PriceSyncSummary> {
  const products = db.prepare("SELECT * FROM products").all() as unknown as ProductRow[];
  const now = new Date().toISOString();
  const updates: PriceQuantityUpdate[] = [];
  const pending = new Map<string, { price: number | null; quantity: number }>();
  let failed = 0;

  for (const supplier of suppliers) {
    const mine = products.filter((p) => p.supplier === supplier.name);
    if (mine.length === 0) continue;
    let offers;
    try {
      offers = await supplier.fetchOffers(mine.map((p) => p.supplier_product_id));
    } catch (err) {
      failed += mine.length;
      logEvent(db, "error", `${supplier.name}: ${(err as Error).message}`);
      continue;
    }
    const byId = new Map(offers.map((o) => [o.productId, o]));

    for (const p of mine) {
      const offer = byId.get(p.supplier_product_id) ?? { productId: p.supplier_product_id, price: null, shippingCost: 0, inStock: false };
      const decision = decideListing(offer, rulesFor(db, p.rule_set));
      db.prepare("UPDATE products SET supplier_price = ?, supplier_in_stock = ?, last_checked_at = ?, last_error = NULL WHERE sku = ?")
        .run(offer.price, offer.inStock ? 1 : 0, now, p.sku);

      const priceChanged = decision.price !== null && decision.price !== p.listing_price;
      const qtyChanged = decision.quantity !== p.listing_quantity;
      if (!p.ebay_offer_id || (!priceChanged && !qtyChanged)) continue;
      updates.push({ sku: p.sku, offerId: p.ebay_offer_id, quantity: decision.quantity, price: priceChanged ? decision.price! : undefined });
      pending.set(p.sku, { price: decision.price ?? p.listing_price, quantity: decision.quantity });
    }
  }

  const results = updates.length > 0 ? await pushUpdates(updates) : [];
  let changed = 0;
  for (const r of results) {
    if (r.ok) {
      const next = pending.get(r.sku)!;
      db.prepare("UPDATE products SET listing_price = ?, listing_quantity = ? WHERE sku = ?").run(next.price, next.quantity, r.sku);
      changed++;
    } else {
      failed++;
      db.prepare("UPDATE products SET last_error = ? WHERE sku = ?").run(r.error ?? "update failed", r.sku);
    }
  }
  logEvent(db, "prices", `checked ${products.length}, changed ${changed}, failed ${failed}`);
  return { checked: products.length, changed, failed };
}
