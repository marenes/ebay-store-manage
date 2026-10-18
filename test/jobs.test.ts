import { describe, expect, it } from "vitest";
import { openDb, setSetting } from "../src/db.js";
import { syncPrices } from "../src/jobs/sync-prices.js";
import { ordersAwaitingTrackingUpload, saveOrders } from "../src/jobs/sync-orders.js";
import type { PriceQuantityUpdate } from "../src/ebay/inventory.js";
import type { Supplier } from "../src/suppliers/types.js";

const supplier = (prices: Record<string, number | null>): Supplier => ({
  name: "amazon",
  fetchOffers: async (ids) => ids.map((id) => ({ productId: id, price: prices[id] ?? null, shippingCost: 0, inStock: prices[id] != null })),
});

function seed() {
  const db = openDb(":memory:");
  const insert = db.prepare("INSERT INTO products (sku, ebay_offer_id, supplier, supplier_product_id, listing_price, listing_quantity) VALUES (?, ?, 'amazon', ?, ?, ?)");
  insert.run("SKU1", "OF1", "B001", 10, 3);
  insert.run("SKU2", "OF2", "B002", 30, 3);
  return db;
}

describe("syncPrices", () => {
  it("reprices in-stock items and zeroes out-of-stock ones", async () => {
    const db = seed();
    const pushed: PriceQuantityUpdate[] = [];
    const summary = await syncPrices({
      db,
      suppliers: [supplier({ B001: 20, B002: null })],
      pushUpdates: async (u) => (pushed.push(...u), u.map((x) => ({ sku: x.sku, ok: true }))),
    });
    expect(summary).toEqual({ checked: 2, changed: 2, failed: 0 });
    expect(pushed.find((u) => u.sku === "SKU1")).toMatchObject({ quantity: 3 });
    expect(pushed.find((u) => u.sku === "SKU1")!.price).toBeGreaterThan(20);
    expect(pushed.find((u) => u.sku === "SKU2")).toMatchObject({ quantity: 0, price: undefined });
    const row = db.prepare("SELECT listing_quantity FROM products WHERE sku = 'SKU2'").get() as { listing_quantity: number };
    expect(row.listing_quantity).toBe(0);
  });

  it("uses stored rule sets", async () => {
    const db = seed();
    setSetting(db, "rules.default", JSON.stringify({ quantityWhenInStock: 7 }));
    const pushed: PriceQuantityUpdate[] = [];
    await syncPrices({ db, suppliers: [supplier({ B001: 20, B002: 20 })], pushUpdates: async (u) => (pushed.push(...u), u.map((x) => ({ sku: x.sku, ok: true }))) });
    expect(pushed.every((u) => u.quantity === 7)).toBe(true);
  });

  it("keeps the old listing when eBay rejects an update", async () => {
    const db = seed();
    const summary = await syncPrices({ db, suppliers: [supplier({ B001: 20, B002: 20 })], pushUpdates: async (u) => u.map((x) => ({ sku: x.sku, ok: false, error: "nope" })) });
    expect(summary.failed).toBe(2);
    const row = db.prepare("SELECT listing_price, last_error FROM products WHERE sku = 'SKU1'").get() as { listing_price: number; last_error: string };
    expect(row).toEqual({ listing_price: 10, last_error: "nope" });
  });
});

describe("saveOrders", () => {
  it("upserts without losing tracking entered by the user", () => {
    const db = openDb(":memory:");
    const order = { orderId: "O1", creationDate: "2026-10-01T00:00:00Z", orderFulfillmentStatus: "NOT_STARTED" as const, lineItems: [{ lineItemId: "L1", sku: "SKU1", title: "Lamp", quantity: 1 }] };
    saveOrders(db, [order]);
    db.prepare("UPDATE orders SET tracking_number = '1Z', carrier = 'UPS' WHERE order_id = 'O1'").run();
    saveOrders(db, [{ ...order, orderFulfillmentStatus: "IN_PROGRESS" }]);
    expect(ordersAwaitingTrackingUpload(db)).toHaveLength(1);
    expect(ordersAwaitingTrackingUpload(db)[0]).toMatchObject({ tracking_number: "1Z", carrier: "UPS" });
  });
});
