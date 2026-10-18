import { describe, expect, it } from "vitest";
import { KeepaSupplier, parseKeepaProduct } from "../src/suppliers/keepa.js";

describe("parseKeepaProduct", () => {
  it("takes the cheaper of Amazon and new offers, in dollars", () => {
    expect(parseKeepaProduct({ asin: "B1", stats: { current: [2599, 2399] } })).toMatchObject({ price: 23.99, inStock: true });
  });

  it("ignores missing offers", () => {
    expect(parseKeepaProduct({ asin: "B1", stats: { current: [-1, 1500] } })).toMatchObject({ price: 15, inStock: true });
    expect(parseKeepaProduct({ asin: "B1", stats: { current: [-1, -1] } })).toMatchObject({ price: null, inStock: false });
    expect(parseKeepaProduct({ asin: "B1" })).toMatchObject({ price: null, inStock: false });
  });
});

describe("KeepaSupplier", () => {
  it("batches ASINs and passes the key", async () => {
    const urls: string[] = [];
    const fake = (async (url: string) => {
      urls.push(url);
      const asins = new URL(url).searchParams.get("asin")!.split(",");
      return new Response(JSON.stringify({ products: asins.map((asin) => ({ asin, stats: { current: [1000] } })) }));
    }) as typeof fetch;
    const asins = Array.from({ length: 150 }, (_, i) => `A${i}`);
    const offers = await new KeepaSupplier("k", 1, fake).fetchOffers(asins);
    expect(urls).toHaveLength(2);
    expect(new URL(urls[0]!).searchParams.get("key")).toBe("k");
    expect(offers).toHaveLength(150);
  });
});
