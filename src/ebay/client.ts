import type { Db } from "../db.js";
import { apiBase, type EbayCredentials, getAccessToken } from "./auth.js";

export class EbayApiError extends Error {
  constructor(readonly status: number, readonly body: string, path: string) {
    super(`eBay API ${path} failed with ${status}: ${body}`);
  }
}

export class EbayClient {
  constructor(
    private readonly db: Db,
    private readonly creds: EbayCredentials,
    private readonly marketplaceId: string,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  async request<T>(method: string, path: string, body?: unknown): Promise<T> {
    const token = await getAccessToken(this.db, this.creds, this.fetchImpl);
    const res = await this.fetchImpl(`${apiBase(this.creds.env)}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${token}`,
        "Content-Type": "application/json",
        Accept: "application/json",
        "X-EBAY-C-MARKETPLACE-ID": this.marketplaceId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    const text = await res.text();
    if (!res.ok) throw new EbayApiError(res.status, text, path);
    return (text ? JSON.parse(text) : undefined) as T;
  }
}
