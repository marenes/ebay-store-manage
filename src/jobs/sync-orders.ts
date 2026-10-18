import { type Db, logEvent } from "../db.js";
import type { EbayOrder } from "../ebay/orders.js";

/** Upserts eBay orders; supplier and tracking columns you filled in are kept. */
export function saveOrders(db: Db, orders: EbayOrder[]): number {
  const now = new Date().toISOString();
  const stmt = db.prepare(`
    INSERT INTO orders (order_id, created_at, buyer, total, currency, fulfillment_status, ship_to, line_items, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(order_id) DO UPDATE SET
      fulfillment_status = excluded.fulfillment_status,
      ship_to = excluded.ship_to,
      line_items = excluded.line_items,
      updated_at = excluded.updated_at`);
  for (const o of orders) {
    const total = o.pricingSummary?.total;
    stmt.run(
      o.orderId,
      o.creationDate,
      o.buyer?.username ?? null,
      total ? Number(total.value) : null,
      total?.currency ?? null,
      o.orderFulfillmentStatus,
      JSON.stringify(o.fulfillmentStartInstructions?.[0]?.shippingStep?.shipTo ?? null),
      JSON.stringify(o.lineItems.map((l) => ({ lineItemId: l.lineItemId, sku: l.sku, title: l.title, quantity: l.quantity }))),
      now,
    );
  }
  logEvent(db, "orders", `synced ${orders.length} open orders`);
  return orders.length;
}

export interface OrderRow {
  order_id: string;
  line_items: string;
  tracking_number: string | null;
  carrier: string | null;
  tracking_uploaded_at: string | null;
}

/** Orders that have tracking entered in the panel but not yet sent to eBay. */
export function ordersAwaitingTrackingUpload(db: Db): OrderRow[] {
  return db
    .prepare("SELECT * FROM orders WHERE tracking_number IS NOT NULL AND carrier IS NOT NULL AND tracking_uploaded_at IS NULL")
    .all() as unknown as OrderRow[];
}

export function markTrackingUploaded(db: Db, orderId: string): void {
  db.prepare("UPDATE orders SET tracking_uploaded_at = ?, fulfillment_status = 'FULFILLED' WHERE order_id = ?").run(new Date().toISOString(), orderId);
}
