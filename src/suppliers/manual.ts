import type { Db } from "../db.js";
import type { Supplier, SupplierOffer } from "./types.js";

/**
 * Supplier whose cost and stock you maintain yourself (a wholesaler's price list, CSV import...).
 * Values are read from the products table, so the panel or an import script keeps them current.
 */
export class ManualSupplier implements Supplier {
  readonly name = "manual";

  constructor(private readonly db: Db) {}

  async fetchOffers(productIds: string[]): Promise<SupplierOffer[]> {
    const stmt = this.db.prepare(
      "SELECT supplier_product_id AS id, supplier_price AS price, supplier_in_stock AS inStock FROM products WHERE supplier = 'manual' AND supplier_product_id = ?",
    );
    return productIds.flatMap((id) => {
      const row = stmt.get(id) as { id: string; price: number | null; inStock: number | null } | undefined;
      return row ? [{ productId: row.id, price: row.price, shippingCost: 0, inStock: row.inStock === 1 }] : [];
    });
  }
}
