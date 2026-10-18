import type { EbayClient } from "./client.js";

/** Subset of the Message API shapes this app uses (commerce/message/v1). */
export interface EbayMessage {
  messageId: string;
  createdDate: string;
  messageBody: string;
  senderUsername: string;
  recipientUsername: string;
  readStatus: boolean;
  subject?: string;
  messageMedia?: Array<{ mediaName?: string; mediaType?: string; mediaUrl?: string }>;
}

export interface EbayConversation {
  conversationId: string;
  conversationStatus: string;
  conversationTitle: string;
  conversationType: string;
  createdDate: string;
  latestMessage: EbayMessage;
  referenceId?: string;
  referenceType?: string;
  unreadCount?: number;
}

interface Page {
  total: number;
  next?: string;
}
interface ConversationsPage extends Page {
  conversations?: EbayConversation[];
}
interface MessagesPage extends Page {
  messages?: EbayMessage[];
}

const BASE = "/commerce/message/v1";
const LIMIT = 50;

/** Fetches buyer conversations with activity after `since`; only reads, nothing is sent. */
export async function fetchConversations(client: EbayClient, since?: Date): Promise<EbayConversation[]> {
  const out: EbayConversation[] = [];
  for (let offset = 0; ; offset += LIMIT) {
    const params = new URLSearchParams({ conversation_type: "FROM_MEMBERS", limit: String(LIMIT), offset: String(offset) });
    if (since) params.set("start_time", since.toISOString());
    const page = await client.request<ConversationsPage>("GET", `${BASE}/conversation?${params}`);
    out.push(...(page.conversations ?? []));
    if (!page.next || out.length >= page.total) return out;
  }
}

/** Fetches every message in one conversation. */
export async function fetchMessages(client: EbayClient, conversationId: string): Promise<EbayMessage[]> {
  const out: EbayMessage[] = [];
  for (let offset = 0; ; offset += LIMIT) {
    const params = new URLSearchParams({ conversation_type: "FROM_MEMBERS", limit: String(LIMIT), offset: String(offset) });
    const page = await client.request<MessagesPage>("GET", `${BASE}/conversation/${encodeURIComponent(conversationId)}?${params}`);
    out.push(...(page.messages ?? []));
    if (!page.next || out.length >= page.total) return out;
  }
}
