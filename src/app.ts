import { config } from "./config.js";
import { type Db, logEvent, openDb } from "./db.js";
import { EbayClient } from "./ebay/client.js";
import { updatePriceQuantity } from "./ebay/inventory.js";
import { fetchOpenOrders, uploadTracking } from "./ebay/orders.js";
import { syncPrices } from "./jobs/sync-prices.js";
import { markTrackingUploaded, ordersAwaitingTrackingUpload, saveOrders } from "./jobs/sync-orders.js";
import { KeepaSupplier } from "./suppliers/keepa.js";
import { ManualSupplier } from "./suppliers/manual.js";
import type { Supplier } from "./suppliers/types.js";

export interface App {
  db: Db;
  ebay: () => EbayClient;
  runPriceSync: () => ReturnType<typeof syncPrices>;
  runOrderSync: () => Promise<{ fetched: number; trackingUploaded: number }>;
}

export function createApp(db: Db = openDb(config.databasePath)): App {
  const ebay = () => new EbayClient(db, config.ebay, config.ebay.marketplaceId);

  const suppliers = (): Supplier[] => {
    const list: Supplier[] = [new ManualSupplier(db)];
    if (process.env.KEEPA_API_KEY) list.push(new KeepaSupplier(config.keepa.apiKey, config.keepa.domain));
    return list;
  };

  return {
    db,
    ebay,
    runPriceSync: () =>
      syncPrices({ db, suppliers: suppliers(), pushUpdates: (u) => updatePriceQuantity(ebay(), u, config.ebay.currency) }),
    async runOrderSync() {
      const client = ebay();
      const fetched = saveOrders(db, await fetchOpenOrders(client));
      let trackingUploaded = 0;
      for (const row of ordersAwaitingTrackingUpload(db)) {
        const items = JSON.parse(row.line_items) as Array<{ lineItemId: string; quantity: number }>;
        try {
          await uploadTracking(client, {
            orderId: row.order_id,
            lineItems: items.map((i) => ({ lineItemId: i.lineItemId, quantity: i.quantity })),
            carrier: row.carrier!,
            trackingNumber: row.tracking_number!,
          });
          markTrackingUploaded(db, row.order_id);
          trackingUploaded++;
        } catch (err) {
          logEvent(db, "error", `tracking ${row.order_id}: ${(err as Error).message}`);
        }
      }
      return { fetched, trackingUploaded };
    },
  };
}
