/**
 * Messaging API types — mirror MessagingService records exactly.
 * Verified against DirectConversationController, DirectMessageController,
 * MessageRequestController and MessagingService.java (v10.12 M1).
 */

/** MessagingService.ParticipantView — one canonical side of a conversation. */
export interface ParticipantView {
  side: 'A' | 'B';
  /** Canonical endpoint user id (for business sides: the representative). */
  userId: string;
  /** Non-null when this side is a Business Account. */
  businessAccountId: string | null;
  displayName: string;
  business: boolean;
}

export type ConversationStatus = 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';

export type ConversationContextType =
  | 'GENERAL'
  | 'PROPERTY_LISTING'
  | 'VEHICLE_LISTING'
  | 'BUSINESS_PROFILE'
  | 'EVENT'
  | 'JOB_LISTING'
  | 'SPARE_BAG_CONTACT'
  | 'SERVICE_REQUEST'
  | 'COMMUNITY_HELP_POST';

/** MessagingService.ConversationView — inbox row and thread header shape. */
export interface ConversationView {
  id: string;
  contextType: ConversationContextType;
  contextId: string | null;
  status: ConversationStatus;
  self: ParticipantView;
  other: ParticipantView;
  lastMessageSeq: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  archivedAt: string | null;
  mutedUntil: string | null;
  pendingRequestId: string | null;
  /** INCOMING when the pending request was sent to me, OUTGOING when sent by me. */
  pendingRequestDirection: 'INCOMING' | 'OUTGOING' | null;
  createdAt: string;
}

export interface ConversationPage {
  items: ConversationView[];
  nextCursor: string | null;
}

/** MessagingService.MessageView — a durable direct message. */
export interface MessageView {
  id: string;
  conversationId: string;
  sequenceNo: number;
  senderId: string;
  senderBusinessAccountId: string | null;
  body: string | null;
  messageType: 'TEXT' | 'SYSTEM' | 'MEDIA';
  replyToMessageId: string | null;
  createdAt: string;
  editedAt: string | null;
}

export interface MessagePage {
  items: MessageView[];
  /** Cursor for the next page of older messages (a sequence number). */
  nextCursor: string | null;
}

export interface UnreadCountView {
  messages: number;
  pendingRequests: number;
  total: number;
}

/** MessagingService.MessageRequestView — an incoming GENERAL first-contact request. */
export interface MessageRequestView {
  id: string;
  conversationId: string;
  status: ConversationStatus;
  sender: ParticipantView;
  recipient: ParticipantView;
  initialMessage: string | null;
  createdAt: string;
  respondedAt: string | null;
}

/** GET /conversations/{id} response — conversation + both side identities. */
export interface ConversationDetail {
  conversation: ConversationView;
  participants: ParticipantView[];
}

/** POST /conversations request body — exactly one recipient identity. */
export interface CreateConversationRequest {
  contextType?: ConversationContextType;
  contextId?: string;
  recipientUserId?: string;
  recipientBusinessAccountId?: string;
  actingBusinessAccountId?: string;
  initialMessage?: string;
  clientMessageId?: string;
}
