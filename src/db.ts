import { DatabaseSync } from "node:sqlite";
import { mkdirSync } from "node:fs";
import { dirname } from "node:path";

export type Db = DatabaseSync;

const schema = `
CREATE TABLE IF NOT EXISTS settings (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);

-- One row per eBay listing linked to a supplier product.
CREATE TABLE IF NOT EXISTS products (
  sku TEXT PRIMARY KEY,
  ebay_offer_id TEXT,
  supplier TEXT NOT NULL,
  supplier_product_id TEXT NOT NULL,
  title TEXT,
  rule_set TEXT NOT NULL DEFAULT 'default',
  supplier_price REAL,
  supplier_in_stock INTEGER,
  listing_price REAL,
  listing_quantity INTEGER,
  last_checked_at TEXT,
  last_error TEXT
);

CREATE TABLE IF NOT EXISTS orders (
  order_id TEXT PRIMARY KEY,
  created_at TEXT NOT NULL,
  buyer TEXT,
  total REAL,
  currency TEXT,
  fulfillment_status TEXT NOT NULL,
  ship_to TEXT,
  line_items TEXT NOT NULL,
  supplier_order_id TEXT,
  tracking_number TEXT,
  carrier TEXT,
  tracking_uploaded_at TEXT,
  updated_at TEXT NOT NULL
);

-- Buyer conversations from the eBay Message API (read-only for now).
CREATE TABLE IF NOT EXISTS conversations (
  conversation_id TEXT PRIMARY KEY,
  buyer TEXT,
  title TEXT,
  status TEXT,
  reference_type TEXT,
  reference_id TEXT,
  unread_count INTEGER NOT NULL DEFAULT 0,
  created_at TEXT NOT NULL,
  last_message_at TEXT,
  last_message_id TEXT,
  updated_at TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS messages (
  message_id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  created_at TEXT NOT NULL,
  sender TEXT,
  recipient TEXT,
  subject TEXT,
  body TEXT NOT NULL,
  is_read INTEGER NOT NULL,
  media TEXT
);
CREATE INDEX IF NOT EXISTS messages_by_conversation ON messages (conversation_id, created_at);

CREATE TABLE IF NOT EXISTS events (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  at TEXT NOT NULL,
  kind TEXT NOT NULL,
  message TEXT NOT NULL
);
`;

export function openDb(path: string): Db {
  if (path !== ":memory:") mkdirSync(dirname(path), { recursive: true });
  const db = new DatabaseSync(path);
  db.exec(schema);
  return db;
}

export function getSetting(db: Db, key: string): string | undefined {
  const row = db.prepare("SELECT value FROM settings WHERE key = ?").get(key) as { value: string } | undefined;
  return row?.value;
}

export function setSetting(db: Db, key: string, value: string): void {
  db.prepare("INSERT INTO settings (key, value) VALUES (?, ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value").run(key, value);
}

export function logEvent(db: Db, kind: string, message: string): void {
  db.prepare("INSERT INTO events (at, kind, message) VALUES (?, ?, ?)").run(new Date().toISOString(), kind, message);
}
