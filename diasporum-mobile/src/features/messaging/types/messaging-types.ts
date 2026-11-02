/**
 * Messaging API types — mirror MessagingService records exactly.
 * M4: added AttachmentView, extended MessageView with attachments,
 * added typing/presence event types.
 */

export interface ParticipantView {
  side: 'A' | 'B';
  userId: string;
  businessAccountId: string | null;
  displayName: string;
  business: boolean;
}

export type ConversationStatus = 'REQUESTED' | 'ACCEPTED' | 'DECLINED' | 'CLOSED';

export type ConversationContextType =
  | 'GENERAL' | 'PROPERTY_LISTING' | 'VEHICLE_LISTING' | 'BUSINESS_PROFILE'
  | 'EVENT' | 'JOB_LISTING' | 'SPARE_BAG_CONTACT' | 'SERVICE_REQUEST'
  | 'COMMUNITY_HELP_POST';

export interface ConversationView {
  id: string;
  contextType: ConversationContextType;
  contextId: string | null;
  status: ConversationStatus;
  matched: boolean;
  self: ParticipantView;
  other: ParticipantView;
  lastMessageSeq: number;
  lastMessageAt: string | null;
  lastMessagePreview: string | null;
  unreadCount: number;
  archivedAt: string | null;
  mutedUntil: string | null;
  pendingRequestId: string | null;
  pendingRequestDirection: 'INCOMING' | 'OUTGOING' | null;
  createdAt: string;
}

export interface ConversationPage {
  items: ConversationView[];
  nextCursor: string | null;
}

/** M4: metadata for a single attachment. No download URL embedded here —
 * use the dedicated download-url endpoint. */
export interface AttachmentView {
  assetId: string;
  purpose: 'MESSAGE_IMAGE' | 'MESSAGE_DOCUMENT';
  mimeType: string;
  sizeBytes: number | null;
}

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
  /** M4: non-empty when messageType === 'MEDIA'. */
  attachments: AttachmentView[];
}

export interface MessagePage {
  items: MessageView[];
  nextCursor: string | null;
}

export interface UnreadCountView {
  messages: number;
  pendingRequests: number;
  total: number;
}

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

export interface ConversationDetail {
  conversation: ConversationView;
  participants: ParticipantView[];
}

export interface CreateConversationRequest {
  contextType?: ConversationContextType;
  contextId?: string;
  recipientUserId?: string;
  recipientBusinessAccountId?: string;
  actingBusinessAccountId?: string;
  initialMessage?: string;
  clientMessageId?: string;
}

// ---- M4: upload ----

export interface UploadInitResult {
  assetId: string;
  uploadUrl: string;
}

export type UploadStatus = 'idle' | 'uploading' | 'done' | 'failed';

export interface PendingAttachment {
  localId: string;
  uri: string;
  name: string;
  mimeType: string;
  sizeBytes: number;
  purpose: 'MESSAGE_IMAGE' | 'MESSAGE_DOCUMENT';
  status: UploadStatus;
  progress: number;       // 0-1
  assetId: string | null; // set when upload completes
  error: string | null;
}

// ---- M4: typing ----

export type MessagingEventType =
  | 'MESSAGE_CREATED' | 'MESSAGE_READ' | 'CONVERSATION_UPDATED'
  | 'TYPING_STARTED' | 'TYPING_STOPPED'
  | 'PRESENCE_ONLINE' | 'PRESENCE_OFFLINE'
  | 'MATCHMAKING_MATCHED' | 'MATCHMAKING_UNMATCHED';

export interface TypingEvent {
  type: 'TYPING_STARTED' | 'TYPING_STOPPED';
  conversationId: string;
  userId: string;
}

export interface PresenceEvent {
  type: 'PRESENCE_ONLINE' | 'PRESENCE_OFFLINE';
  userId: string;
  online: boolean;
}
