import type { EbayClient } from "./client.js";

/** Subset of the Fulfillment API order shape this app uses. */
export interface EbayOrder {
  orderId: string;
  creationDate: string;
  orderFulfillmentStatus: "NOT_STARTED" | "IN_PROGRESS" | "FULFILLED";
  buyer?: { username?: string };
  pricingSummary?: { total?: { value: string; currency: string } };
  fulfillmentStartInstructions?: Array<{
    shippingStep?: { shipTo?: { fullName?: string; contactAddress?: Record<string, string>; primaryPhone?: { phoneNumber?: string } } };
  }>;
  lineItems: Array<{ lineItemId: string; sku?: string; title: string; quantity: number }>;
}

interface OrdersPage {
  orders?: EbayOrder[];
  total: number;
  next?: string;
}

/** Fetches every order that still needs to be shipped. */
export async function fetchOpenOrders(client: EbayClient): Promise<EbayOrder[]> {
  const orders: EbayOrder[] = [];
  const limit = 50;
  for (let offset = 0; ; offset += limit) {
    const filter = encodeURIComponent("orderfulfillmentstatus:{NOT_STARTED|IN_PROGRESS}");
    const page = await client.request<OrdersPage>("GET", `/sell/fulfillment/v1/order?filter=${filter}&limit=${limit}&offset=${offset}`);
    orders.push(...(page.orders ?? []));
    if (!page.next || orders.length >= page.total) return orders;
  }
}

export interface TrackingUpload {
  orderId: string;
  lineItems: Array<{ lineItemId: string; quantity: number }>;
  carrier: string;
  trackingNumber: string;
  shippedDate?: Date;
}

/** Marks the order as shipped on eBay with the supplier's tracking number. */
export async function uploadTracking(client: EbayClient, t: TrackingUpload): Promise<void> {
  await client.request("POST", `/sell/fulfillment/v1/order/${encodeURIComponent(t.orderId)}/shipping_fulfillment`, {
    lineItems: t.lineItems,
    shippedDate: (t.shippedDate ?? new Date()).toISOString(),
    shippingCarrierCode: t.carrier,
    trackingNumber: t.trackingNumber,
  });
}
