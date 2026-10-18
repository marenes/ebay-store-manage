export interface SupplierOffer {
  productId: string;
  title?: string;
  /** Current cost in listing currency, or null when there is no buyable offer. */
  price: number | null;
  shippingCost: number;
  inStock: boolean;
}

export interface Supplier {
  readonly name: string;
  /** Returns offers for the given product ids; ids missing from the result are treated as unavailable. */
  fetchOffers(productIds: string[]): Promise<SupplierOffer[]>;
}
