import { describe, expect, it } from "vitest";
import { openDb, setSetting } from "../src/db.js";
import { getAccessToken, needsMessageReconnect } from "../src/ebay/auth.js";
import { EbayClient } from "../src/ebay/client.js";
import { type EbayConversation, type EbayMessage, fetchConversations } from "../src/ebay/messages.js";
import { syncMessages } from "../src/jobs/sync-messages.js";
import { saveOrders } from "../src/jobs/sync-orders.js";

const msg = (id: string, sender: string, recipient: string, body = "where is my order?"): EbayMessage => ({
  messageId: id, createdDate: `2026-10-1${id.slice(-1)}T10:00:00Z`, messageBody: body, senderUsername: sender, recipientUsername: recipient, readStatus: false,
});
const conv = (id: string, latest: EbayMessage): EbayConversation => ({
  conversationId: id, conversationStatus: "UNREAD", conversationTitle: "Order question", conversationType: "FROM_MEMBERS",
  createdDate: "2026-10-10T00:00:00Z", latestMessage: latest, unreadCount: 1,
});

describe("fetchConversations", () => {
  it("pages through buyer conversations with only GET requests", async () => {
    const calls: Array<{ method: string; url: string }> = [];
    const fake = (async (url: string, init: RequestInit) => {
      calls.push({ method: String(init.method), url });
      const offset = Number(new URL(url).searchParams.get("offset"));
      const conversations = offset === 0 ? Array.from({ length: 50 }, (_, i) => conv(`C${i}`, msg("M1", "b", "s"))) : [conv("C50", msg("M1", "b", "s"))];
      return new Response(JSON.stringify({ conversations, total: 51, next: offset === 0 ? "more" : undefined }));
    }) as typeof fetch;
    const db = openDb(":memory:");
    setSetting(db, "ebay.access_token", "t");
    setSetting(db, "ebay.access_token_expires_at", String(Date.now() + 3_600_000));
    const client = new EbayClient(db, { env: "sandbox", clientId: "id", clientSecret: "s", ruName: "r" }, "EBAY_US", fake);
    const list = await fetchConversations(client, new Date("2026-10-01T00:00:00Z"));
    expect(list).toHaveLength(51);
    expect(calls.every((c) => c.method === "GET")).toBe(true);
    const first = new URL(calls[0]!.url);
    expect(first.pathname).toBe("/commerce/message/v1/conversation");
    expect(first.searchParams.get("conversation_type")).toBe("FROM_MEMBERS");
    expect(first.searchParams.get("start_time")).toBe("2026-10-01T00:00:00.000Z");
  });
});

describe("syncMessages", () => {
  it("stores conversations, links the buyer and only refetches changed conversations", async () => {
    const db = openDb(":memory:");
    saveOrders(db, [{ orderId: "O1", creationDate: "2026-10-09T00:00:00Z", orderFulfillmentStatus: "NOT_STARTED", buyer: { username: "john" }, lineItems: [{ lineItemId: "L1", title: "Lamp", quantity: 1 }] }]);
    let thread = [msg("M1", "john", "shop")];
    const fetched: string[] = [];
    const deps = {
      db,
      fetchConversations: async () => [conv("C1", thread.at(-1)!)],
      fetchMessages: async (id: string) => (fetched.push(id), thread),
      now: () => new Date("2026-10-18T12:00:00Z"),
    };

    expect(await syncMessages(deps)).toEqual({ conversations: 1, newMessages: 1 });
    expect(db.prepare("SELECT buyer, unread_count FROM conversations").get()).toEqual({ buyer: "john", unread_count: 1 });

    expect(await syncMessages(deps)).toEqual({ conversations: 1, newMessages: 0 });
    expect(fetched).toEqual(["C1"]);

    thread = [...thread, msg("M2", "shop", "john", "It shipped today")];
    expect(await syncMessages(deps)).toEqual({ conversations: 1, newMessages: 1 });
    expect(db.prepare("SELECT COUNT(*) n FROM messages").get()).toEqual({ n: 2 });
  });

  it("starts from the history window, then from the last sync", async () => {
    const db = openDb(":memory:");
    const seen: Array<Date | undefined> = [];
    const deps = { db, fetchConversations: async (since?: Date) => (seen.push(since), []), fetchMessages: async () => [], historyDays: 30, now: () => new Date("2026-10-18T12:00:00Z") };
    await syncMessages(deps);
    await syncMessages(deps);
    expect(seen[0]!.toISOString()).toBe("2026-09-18T12:00:00.000Z");
    expect(seen[1]!.toISOString()).toBe("2026-10-18T11:00:00.000Z");
  });

  it("uses the seller username to find the buyer when there is no order", async () => {
    const db = openDb(":memory:");
    await syncMessages({ db, sellerUsername: "Shop", fetchConversations: async () => [conv("C1", msg("M1", "shop", "anna"))], fetchMessages: async () => [msg("M1", "shop", "anna")] });
    expect(db.prepare("SELECT buyer FROM conversations").get()).toEqual({ buyer: "anna" });
  });
});

describe("message scope", () => {
  it("keeps refreshing accounts connected before messages with their old scopes", async () => {
    const db = openDb(":memory:");
    setSetting(db, "ebay.refresh_token", "r");
    expect(needsMessageReconnect(db)).toBe(true);
    let scope = "";
    const fake = (async (_url: string, init: RequestInit) => {
      scope = new URLSearchParams(String(init.body)).get("scope")!;
      return new Response(JSON.stringify({ access_token: "a", expires_in: 7200 }));
    }) as typeof fetch;
    await getAccessToken(db, { env: "sandbox", clientId: "id", clientSecret: "s", ruName: "r" }, fake);
    expect(scope).not.toContain("commerce.message");
    expect(scope).toContain("sell.fulfillment");
  });
});
