/**
 * Conversation thread — M1-M4.
 * M4 adds: image/document attachments, typing indicator, presence dot,
 * read-receipt ticks, attachment picker bar.
 */
import React, { useCallback, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator, FlatList, KeyboardAvoidingView,
  Platform, Pressable, StyleSheet, TextInput, View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { MatchedBadge } from '@/shared/components/matched-badge';
import { useSession } from '@/core/session/session-provider';
import { createMessagingApi } from '../services/messaging-api';
import { createMediaApi } from '../services/media-api';
import { useThread, type ThreadItem } from '../hooks/use-thread';
import { useAttachments } from '../hooks/use-attachments';
import { timeAgo } from '@/features/feed/utils/time-ago';
import { TypingIndicator } from '../components/typing-indicator';
import { PresenceDot } from '../components/presence-dot';
import { ImageBubble } from '../components/image-bubble';
import { DocumentBubble } from '../components/document-bubble';
import { AttachmentPreviewBar } from '../components/attachment-preview-bar';
import type { AttachmentView, MessageView } from '../types/messaging-types';
import { SpareBagContextHeader } from '@/features/spare-bag/components/spare-bag-context-header';

interface BubbleProps {
  item: ThreadItem;
  mine: boolean;
  fetchAttachmentUrl: (messageId: string, assetId: string) => Promise<string>;
  partnerReadSeq: number;
}

function Bubble({ item, mine, fetchAttachmentUrl, partnerReadSeq }: BubbleProps) {
  const theme = useTheme();

  if (item.kind === 'pending') {
    const p = item.pending;
    const failed = p.status === 'failed';
    return (
      <View style={[styles.bubbleRow, styles.rowMine]}>
        <View style={[styles.bubble, { backgroundColor: failed ? theme.errorSurface : theme.primary, opacity: failed ? 1 : 0.65 }]}>
          {p.body ? <ThemedText style={[styles.bubbleText, { color: failed ? theme.error : '#fff' }]}>{p.body}</ThemedText> : null}
          {p.attachmentIds.length > 0 && (
            <ThemedText style={[styles.bubbleMeta, { color: failed ? theme.error : '#fff' }]}>
              {p.attachmentIds.length} attachment{p.attachmentIds.length > 1 ? 's' : ''}
            </ThemedText>
          )}
          <ThemedText style={[styles.bubbleMeta, { color: failed ? theme.error : '#fff' }]}>
            {failed ? 'Failed — tap to retry' : 'Sending…'}
          </ThemedText>
        </View>
      </View>
    );
  }

  const m: MessageView = item.message;
  const isRead = mine && m.sequenceNo <= partnerReadSeq;

  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[styles.bubble, mine ? { backgroundColor: theme.primary } : { backgroundColor: theme.backgroundElement }]}>
        {m.body ? (
          <ThemedText style={[styles.bubbleText, { color: mine ? '#fff' : theme.text }]}>
            {m.body}
          </ThemedText>
        ) : null}
        {m.attachments?.map((att: AttachmentView) =>
          att.purpose === 'MESSAGE_IMAGE' ? (
            <ImageBubble
              key={att.assetId}
              attachment={att}
              fetchUrl={() => fetchAttachmentUrl(m.id, att.assetId)}
            />
          ) : (
            <DocumentBubble
              key={att.assetId}
              attachment={att}
              fetchUrl={() => fetchAttachmentUrl(m.id, att.assetId)}
            />
          )
        )}
        <View style={styles.metaRow}>
          <ThemedText style={[styles.bubbleMeta, { color: mine ? '#fff' : theme.textSecondary }]}>
            {timeAgo(m.createdAt)}
          </ThemedText>
          {mine && (
            <ThemedText style={[styles.readTick, { color: isRead ? '#a5f3fc' : 'rgba(255,255,255,0.5)' }]}>
              {isRead ? '✓✓' : '✓'}
            </ThemedText>
          )}
        </View>
      </View>
    </View>
  );
}

export default function ConversationScreen() {
  const theme = useTheme();
  const { session, apiClient } = useSession();
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = String(params.id);
  const viewerId = session?.me.id ?? '';

  const api = useMemo(() => createMessagingApi(apiClient), [apiClient]);
  const mediaApiObj = useMemo(() => createMediaApi(apiClient), [apiClient]);

  const {
    conversation, items, loading, loadingOlder, sending, error,
    loadOlder, send, retry, anyoneTyping, partnerOnline, partnerReadSeqs,
    notifyTyping,
  } = useThread(conversationId, viewerId);

  const atts = useAttachments(mediaApiObj);
  const [draft, setDraft] = useState('');
  const typingTimer = useRef<ReturnType<typeof setTimeout> | null>(null);

  const partnerReadSeq = useMemo(() => {
    const entries = Object.values(partnerReadSeqs);
    return entries.length > 0 ? Math.max(...entries) : 0;
  }, [partnerReadSeqs]);

  const fetchAttachmentUrl = useCallback(
    (messageId: string, assetId: string) =>
      api.attachmentDownloadUrl(conversationId, messageId, assetId).then(r => r.downloadUrl),
    [api, conversationId]
  );

  const title = conversation?.other.displayName ?? 'Conversation';
  const canSend = conversation?.status === 'ACCEPTED';

  const requestBanner = useMemo(() => {
    if (conversation?.status !== 'REQUESTED') return null;
    return conversation.pendingRequestDirection === 'OUTGOING'
      ? `Waiting for ${conversation.other.displayName} to accept your message request.`
      : `${conversation.other.displayName} wants to message you.`;
  }, [conversation]);

  const onDraftChange = (text: string) => {
    setDraft(text);
    if (typingTimer.current) clearTimeout(typingTimer.current);
    if (text.length > 0) {
      notifyTyping(true);
      typingTimer.current = setTimeout(() => notifyTyping(false), 5000);
    } else {
      notifyTyping(false);
    }
  };

  const onSend = () => {
    if (typingTimer.current) clearTimeout(typingTimer.current);
    notifyTyping(false);
    const text = draft;
    const attachmentIds = atts.readyAssetIds;
    setDraft('');
    atts.clearAll();
    void send(text, attachmentIds);
  };

  const canSubmit = (draft.trim().length > 0 || atts.readyAssetIds.length > 0)
    && !sending && !atts.isUploading;

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable onPress={() => router.back()} style={styles.backBtn} accessibilityRole="button" accessibilityLabel="Back">
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerBody}>
            <View style={styles.headerNameRow}>
              <ThemedText style={styles.headerTitle} numberOfLines={1}>{title}</ThemedText>
              {conversation?.matched ? <MatchedBadge compact /> : null}
              <PresenceDot online={partnerOnline} size={9} />
            </View>
            {conversation?.other.business && (
              <ThemedText style={styles.headerSub} themeColor="textSecondary">Business account</ThemedText>
            )}
          </View>
        </View>

        {conversation?.contextType === 'SPARE_BAG_CONTACT' && conversation.contextId ? (
          <SpareBagContextHeader client={apiClient} contactId={conversation.contextId} />
        ) : null}

        <KeyboardAvoidingView style={styles.flex}
          behavior={Platform.OS === 'ios' ? 'padding' : 'height'} keyboardVerticalOffset={0}>
        {loading ? (
          <View style={styles.center}><ActivityIndicator color={theme.primary} /></View>
        ) : error && items.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={36} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.errorText}>{error}</ThemedText>
          </View>
        ) : (
          <FlatList
            data={items}
            inverted
            style={styles.flex}
            keyExtractor={(item) => item.kind === 'server' ? item.message.id : item.pending.localId}
            renderItem={({ item }) => (
              <Pressable
                disabled={item.kind !== 'pending' || item.pending.status !== 'failed'}
                onPress={() => item.kind === 'pending' && retry(item.pending.localId)}
              >
                <Bubble
                  item={item}
                  mine={item.kind === 'pending'
                    ? item.pending.senderId === viewerId
                    : item.message.senderId === viewerId}
                  fetchAttachmentUrl={fetchAttachmentUrl}
                  partnerReadSeq={partnerReadSeq}
                />
              </Pressable>
            )}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={loadingOlder ? <ActivityIndicator color={theme.primary} style={styles.older} /> : undefined}
            ListHeaderComponent={
              <>
                <TypingIndicator visible={anyoneTyping} />
                {requestBanner ? (
                  <View style={[styles.banner, { backgroundColor: theme.primarySurface }]}>
                    <ThemedText style={[styles.bannerText, { color: theme.primary }]}>{requestBanner}</ThemedText>
                  </View>
                ) : null}
              </>
            }
          />
        )}

        <AttachmentPreviewBar
          attachments={atts.pending}
          onRemove={atts.removeAttachment}
          onRetry={atts.retryAttachment}
        />
          {canSend ? (
            <View style={[styles.composer, { borderTopColor: theme.border }]}>
              <Pressable onPress={atts.addImageFromGallery} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Add image">
                <Ionicons name="image-outline" size={22} color={theme.textSecondary} />
              </Pressable>
              <Pressable onPress={atts.addDocument} style={styles.iconBtn} accessibilityRole="button" accessibilityLabel="Add document">
                <Ionicons name="document-outline" size={22} color={theme.textSecondary} />
              </Pressable>
              <TextInput
                style={[styles.input, { backgroundColor: theme.backgroundElement, color: theme.text }]}
                placeholder="Message…"
                placeholderTextColor={theme.textSecondary}
                value={draft}
                onChangeText={onDraftChange}
                multiline
                maxLength={10000}
                accessibilityLabel="Message input"
              />
              <Pressable
                style={[styles.sendBtn, { backgroundColor: theme.primary, opacity: canSubmit ? 1 : 0.4 }]}
                onPress={onSend}
                disabled={!canSubmit}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                {sending || atts.isUploading
                  ? <ActivityIndicator size="small" color="#fff" />
                  : <Ionicons name="send" size={18} color="#fff" />}
              </Pressable>
            </View>
          ) : conversation ? (
            <View style={[styles.composer, { borderTopColor: theme.border }]}>
              <ThemedText style={styles.closedNote} themeColor="textSecondary">
                {conversation.status === 'REQUESTED'
                  ? 'You can send another message once the request is accepted.'
                  : 'This conversation is closed.'}
              </ThemedText>
            </View>
          ) : null}
        </KeyboardAvoidingView>
      </SafeAreaView>
    </ThemedView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1 },
  safeArea: { flex: 1 },
  flex: { flex: 1 },
  header: { flexDirection: 'row', alignItems: 'center', gap: Spacing.two, paddingHorizontal: Spacing.two, paddingVertical: Spacing.two, borderBottomWidth: StyleSheet.hairlineWidth },
  backBtn: { padding: Spacing.two },
  headerBody: { flex: 1 },
  headerNameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.five },
  errorText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  listContent: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, gap: 4 },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  metaRow: { flexDirection: 'row', alignItems: 'center', gap: 4, alignSelf: 'flex-end' },
  bubbleMeta: { fontSize: 10, opacity: 0.75 },
  readTick: { fontSize: 11, fontWeight: '700' },
  older: { marginVertical: Spacing.three },
  banner: { margin: Spacing.two, borderRadius: 12, padding: Spacing.three },
  bannerText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two, borderTopWidth: StyleSheet.hairlineWidth },
  iconBtn: { padding: 6 },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: Spacing.four, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  closedNote: { flex: 1, textAlign: 'center', fontSize: 13, paddingVertical: Spacing.two },
});
