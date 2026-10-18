import { type Db, getSetting, logEvent, setSetting } from "../db.js";
import type { EbayConversation, EbayMessage } from "../ebay/messages.js";

export interface MessageSyncDeps {
  db: Db;
  /** Injected so the job can run without the network in tests. */
  fetchConversations: (since?: Date) => Promise<EbayConversation[]>;
  fetchMessages: (conversationId: string) => Promise<EbayMessage[]>;
  /** Your eBay username; when unknown the buyer is guessed from orders. */
  sellerUsername?: string;
  /** How far back the very first sync reaches. */
  historyDays?: number;
  now?: () => Date;
}

export interface MessageSyncSummary {
  conversations: number;
  newMessages: number;
}

const OVERLAP_MS = 60 * 60_000;

/** The other party of a conversation: not the seller, preferably someone who bought from us. */
export function buyerOf(db: Db, c: EbayConversation, sellerUsername?: string): string | null {
  const people = [c.latestMessage.senderUsername, c.latestMessage.recipientUsername].filter(Boolean);
  if (sellerUsername) return people.find((p) => p.toLowerCase() !== sellerUsername.toLowerCase()) ?? null;
  const known = db.prepare("SELECT 1 FROM orders WHERE buyer = ? LIMIT 1");
  return people.find((p) => known.get(p)) ?? null;
}

export async function syncMessages(deps: MessageSyncDeps): Promise<MessageSyncSummary> {
  const { db } = deps;
  const now = (deps.now ?? (() => new Date()))();
  const last = getSetting(db, "messages.synced_at");
  const since = last
    ? new Date(new Date(last).getTime() - OVERLAP_MS)
    : new Date(now.getTime() - (deps.historyDays ?? 90) * 86_400_000);

  const conversations = await deps.fetchConversations(since);
  const known = db.prepare("SELECT 1 FROM messages WHERE message_id = ?");
  const upsertConversation = db.prepare(`
    INSERT INTO conversations (conversation_id, buyer, title, status, reference_type, reference_id, unread_count, created_at, last_message_at, last_message_id, updated_at)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(conversation_id) DO UPDATE SET
      buyer = COALESCE(excluded.buyer, conversations.buyer),
      title = excluded.title, status = excluded.status, unread_count = excluded.unread_count,
      last_message_at = excluded.last_message_at, last_message_id = excluded.last_message_id, updated_at = excluded.updated_at`);
  const upsertMessage = db.prepare(`
    INSERT INTO messages (message_id, conversation_id, created_at, sender, recipient, subject, body, is_read, media)
    VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
    ON CONFLICT(message_id) DO UPDATE SET is_read = excluded.is_read`);

  let newMessages = 0;
  for (const c of conversations) {
    // Only open conversations whose latest message we haven't stored yet.
    if (!known.get(c.latestMessage.messageId)) {
      for (const m of await deps.fetchMessages(c.conversationId)) {
        if (!known.get(m.messageId)) newMessages++;
        upsertMessage.run(m.messageId, c.conversationId, m.createdDate, m.senderUsername ?? null, m.recipientUsername ?? null,
          m.subject ?? null, m.messageBody ?? "", m.readStatus ? 1 : 0, m.messageMedia?.length ? JSON.stringify(m.messageMedia) : null);
      }
    }
    upsertConversation.run(c.conversationId, buyerOf(db, c, deps.sellerUsername), c.conversationTitle ?? null, c.conversationStatus ?? null,
      c.referenceType ?? null, c.referenceId ?? null, c.unreadCount ?? 0, c.createdDate, c.latestMessage.createdDate,
      c.latestMessage.messageId, now.toISOString());
  }

  setSetting(db, "messages.synced_at", now.toISOString());
  logEvent(db, "messages", `synced ${conversations.length} conversations, ${newMessages} new messages`);
  return { conversations: conversations.length, newMessages };
}
