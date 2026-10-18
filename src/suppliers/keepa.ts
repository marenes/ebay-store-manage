import type { Supplier, SupplierOffer } from "./types.js";

// Indexes into Keepa's stats.current array (https://keepa.com/#!discuss/t/product-object/116).
const AMAZON = 0;
const NEW = 1;

interface KeepaProduct {
  asin: string;
  title?: string;
  stats?: { current?: number[] };
}

interface KeepaResponse {
  products?: KeepaProduct[];
  tokensLeft?: number;
  error?: { message?: string };
}

/** Keepa reports prices in cents and -1/-2 when there is no offer. */
export function parseKeepaProduct(p: KeepaProduct): SupplierOffer {
  const current = p.stats?.current ?? [];
  const candidates = [current[AMAZON], current[NEW]].filter((v): v is number => v !== undefined && v > 0);
  const cents = candidates.length > 0 ? Math.min(...candidates) : null;
  return {
    productId: p.asin,
    title: p.title,
    price: cents === null ? null : cents / 100,
    shippingCost: 0,
    inStock: cents !== null,
  };
}

/** Reads Amazon price and availability through the Keepa API instead of scraping Amazon. */
export class KeepaSupplier implements Supplier {
  readonly name = "amazon";

  constructor(
    private readonly apiKey: string,
    private readonly domain = 1,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async fetchOffers(asins: string[]): Promise<SupplierOffer[]> {
    const offers: SupplierOffer[] = [];
    for (let i = 0; i < asins.length; i += 100) {
      const params = new URLSearchParams({
        key: this.apiKey,
        domain: String(this.domain),
        asin: asins.slice(i, i + 100).join(","),
        stats: "1",
      });
      const res = await this.fetchImpl(`https://api.keepa.com/product?${params}`);
      const body = (await res.json()) as KeepaResponse;
      if (!res.ok || body.error) throw new Error(`Keepa request failed: ${res.status} ${body.error?.message ?? ""}`.trim());
      offers.push(...(body.products ?? []).map(parseKeepaProduct));
    }
    return offers;
  }
}
