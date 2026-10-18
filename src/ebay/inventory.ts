import type { EbayClient } from "./client.js";

export interface PriceQuantityUpdate {
  sku: string;
  offerId: string;
  quantity: number;
  /** Omit to change only the quantity. */
  price?: number;
}

interface BulkResponse {
  responses: Array<{ sku?: string; offerId?: string; statusCode: number; errors?: Array<{ message: string }> }>;
}

export interface UpdateResult {
  sku: string;
  ok: boolean;
  error?: string;
}

const BATCH = 25; // eBay limit per bulk_update_price_quantity call

export async function updatePriceQuantity(client: EbayClient, updates: PriceQuantityUpdate[], currency: string): Promise<UpdateResult[]> {
  const results: UpdateResult[] = [];
  for (let i = 0; i < updates.length; i += BATCH) {
    const batch = updates.slice(i, i + BATCH);
    const res = await client.request<BulkResponse>("POST", "/sell/inventory/v1/bulk_update_price_quantity", {
      requests: batch.map((u) => ({
        sku: u.sku,
        shipToLocationAvailability: { quantity: u.quantity },
        offers: [
          {
            offerId: u.offerId,
            availableQuantity: u.quantity,
            ...(u.price === undefined ? {} : { price: { value: u.price.toFixed(2), currency } }),
          },
        ],
      })),
    });
    for (const u of batch) {
      const r = res.responses.find((x) => x.sku === u.sku || x.offerId === u.offerId);
      const ok = r !== undefined && r.statusCode >= 200 && r.statusCode < 300;
      results.push({ sku: u.sku, ok, error: ok ? undefined : r?.errors?.map((e) => e.message).join("; ") ?? "no response" });
    }
  }
  return results;
}
