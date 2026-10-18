import { loadEnvFile } from "node:process";
import { existsSync } from "node:fs";

if (existsSync(".env")) loadEnvFile(".env");

function env(name: string, fallback?: string): string {
  const value = process.env[name] ?? fallback;
  if (value === undefined || value === "") throw new Error(`Missing environment variable ${name}`);
  return value;
}

export type EbayEnv = "sandbox" | "production";

export const config = {
  port: Number(process.env.PORT ?? 3000),
  databasePath: process.env.DATABASE_PATH ?? "data/app.db",
  messageHistoryDays: Number(process.env.MESSAGE_HISTORY_DAYS ?? 90),
  ebay: {
    get env(): EbayEnv {
      return env("EBAY_ENV", "sandbox") === "production" ? "production" : "sandbox";
    },
    get clientId() { return env("EBAY_CLIENT_ID"); },
    get clientSecret() { return env("EBAY_CLIENT_SECRET"); },
    get ruName() { return env("EBAY_RU_NAME"); },
    get marketplaceId() { return env("EBAY_MARKETPLACE_ID", "EBAY_US"); },
    get currency() { return env("EBAY_CURRENCY", "USD"); },
    get sellerUsername() { return process.env.EBAY_SELLER_USERNAME || undefined; },
  },
  keepa: {
    get apiKey() { return env("KEEPA_API_KEY"); },
    get domain() { return Number(env("KEEPA_DOMAIN", "1")); },
  },
};
