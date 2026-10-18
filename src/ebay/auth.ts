import type { EbayEnv } from "../config.js";
import { type Db, getSetting, setSetting } from "../db.js";

export const EBAY_SCOPES = [
  "https://api.ebay.com/oauth/api_scope",
  "https://api.ebay.com/oauth/api_scope/sell.inventory",
  "https://api.ebay.com/oauth/api_scope/sell.fulfillment",
  "https://api.ebay.com/oauth/api_scope/sell.account",
];

export interface EbayCredentials {
  env: EbayEnv;
  clientId: string;
  clientSecret: string;
  ruName: string;
}

export const apiBase = (env: EbayEnv) => (env === "production" ? "https://api.ebay.com" : "https://api.sandbox.ebay.com");
const authBase = (env: EbayEnv) => (env === "production" ? "https://auth.ebay.com" : "https://auth.sandbox.ebay.com");

export function authorizationUrl(creds: EbayCredentials, state: string): string {
  const params = new URLSearchParams({
    client_id: creds.clientId,
    redirect_uri: creds.ruName,
    response_type: "code",
    scope: EBAY_SCOPES.join(" "),
    state,
  });
  return `${authBase(creds.env)}/oauth2/authorize?${params}`;
}

interface TokenResponse {
  access_token: string;
  expires_in: number;
  refresh_token?: string;
  refresh_token_expires_in?: number;
}

async function requestToken(creds: EbayCredentials, body: URLSearchParams, fetchImpl: typeof fetch): Promise<TokenResponse> {
  const basic = Buffer.from(`${creds.clientId}:${creds.clientSecret}`).toString("base64");
  const res = await fetchImpl(`${apiBase(creds.env)}/identity/v1/oauth2/token`, {
    method: "POST",
    headers: { Authorization: `Basic ${basic}`, "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
  if (!res.ok) throw new Error(`eBay token request failed: ${res.status} ${await res.text()}`);
  return (await res.json()) as TokenResponse;
}

/** Exchanges the code from the OAuth callback and stores the tokens. */
export async function exchangeCode(db: Db, creds: EbayCredentials, code: string, fetchImpl: typeof fetch = fetch): Promise<void> {
  const token = await requestToken(
    creds,
    new URLSearchParams({ grant_type: "authorization_code", code, redirect_uri: creds.ruName }),
    fetchImpl,
  );
  if (!token.refresh_token) throw new Error("eBay did not return a refresh token");
  setSetting(db, "ebay.refresh_token", token.refresh_token);
  storeAccessToken(db, token);
}

function storeAccessToken(db: Db, token: TokenResponse): void {
  setSetting(db, "ebay.access_token", token.access_token);
  setSetting(db, "ebay.access_token_expires_at", String(Date.now() + token.expires_in * 1000));
}

export function isConnected(db: Db): boolean {
  return getSetting(db, "ebay.refresh_token") !== undefined;
}

/** Returns a valid user access token, refreshing it when it is about to expire. */
export async function getAccessToken(db: Db, creds: EbayCredentials, fetchImpl: typeof fetch = fetch): Promise<string> {
  const current = getSetting(db, "ebay.access_token");
  const expiresAt = Number(getSetting(db, "ebay.access_token_expires_at") ?? 0);
  if (current && expiresAt - Date.now() > 60_000) return current;

  const refreshToken = getSetting(db, "ebay.refresh_token");
  if (!refreshToken) throw new Error("eBay account is not connected. Open /auth/ebay in the panel first.");
  const token = await requestToken(
    creds,
    new URLSearchParams({ grant_type: "refresh_token", refresh_token: refreshToken, scope: EBAY_SCOPES.join(" ") }),
    fetchImpl,
  );
  storeAccessToken(db, token);
  return token.access_token;
}
