/**
 * Conversation thread — inverted message list with cursor-paginated history,
 * optimistic composer (sending/failed states with tap-to-retry), request
 * banners for pending GENERAL conversations, and read-cursor advancement.
 */

import React, { useMemo, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  StyleSheet,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';
import { Ionicons } from '@expo/vector-icons';
import { router, useLocalSearchParams } from 'expo-router';

import { ThemedText } from '@/components/themed-text';
import { ThemedView } from '@/components/themed-view';
import { useTheme } from '@/hooks/use-theme';
import { BorderRadius, Spacing } from '@/shared/theme/spacing';
import { useSession } from '@/core/session/session-provider';
import { useThread, type ThreadItem } from '../hooks/use-thread';
import { timeAgo } from '@/features/feed/utils/time-ago';
import type { MessageView } from '../types/messaging-types';

function Bubble({ item, mine }: { item: ThreadItem; mine: boolean }) {
  const theme = useTheme();
  if (item.kind === 'pending') {
    const p = item.pending;
    const failed = p.status === 'failed';
    return (
      <View style={[styles.bubbleRow, styles.rowMine]}>
        <View style={[
          styles.bubble,
          { backgroundColor: failed ? theme.errorSurface : theme.primary, opacity: failed ? 1 : 0.65 },
        ]}>
          <ThemedText style={[styles.bubbleText, { color: failed ? theme.error : '#fff' }]}>
            {p.body}
          </ThemedText>
          <ThemedText style={[styles.bubbleMeta, { color: failed ? theme.error : '#fff' }]}>
            {failed ? 'Failed — tap to retry' : 'Sending…'}
          </ThemedText>
        </View>
      </View>
    );
  }
  const m: MessageView = item.message;
  return (
    <View style={[styles.bubbleRow, mine ? styles.rowMine : styles.rowTheirs]}>
      <View style={[
        styles.bubble,
        mine
          ? { backgroundColor: theme.primary }
          : { backgroundColor: theme.backgroundElement },
      ]}>
        <ThemedText style={[styles.bubbleText, { color: mine ? '#fff' : theme.text }]}>
          {m.body ?? ''}
        </ThemedText>
        <ThemedText style={[styles.bubbleMeta, { color: mine ? '#fff' : theme.textSecondary }]}>
          {timeAgo(m.createdAt)}
        </ThemedText>
      </View>
    </View>
  );
}

export default function ConversationScreen() {
  const theme = useTheme();
  const { session } = useSession();
  const params = useLocalSearchParams<{ id: string }>();
  const conversationId = String(params.id);
  const viewerId = session?.me.id ?? '';

  const {
    conversation, items, loading, loadingOlder, sending, error,
    loadOlder, send, retry,
  } = useThread(conversationId, viewerId);

  const [draft, setDraft] = useState('');

  const title = conversation?.other.displayName ?? 'Conversation';
  const canSend = conversation?.status === 'ACCEPTED';
  const requestBanner = useMemo(() => {
    if (conversation?.status !== 'REQUESTED') return null;
    return conversation.pendingRequestDirection === 'OUTGOING'
      ? `Waiting for ${conversation.other.displayName} to accept your message request.`
      : `${conversation.other.displayName} wants to message you. Respond from the requests inbox.`;
  }, [conversation]);

  const onSend = () => {
    const text = draft;
    setDraft('');
    void send(text);
  };

  return (
    <ThemedView style={styles.root}>
      <SafeAreaView style={styles.safeArea} edges={['top', 'bottom']}>
        <View style={[styles.header, { borderBottomColor: theme.border }]}>
          <Pressable
            onPress={() => router.back()}
            style={styles.backBtn}
            accessibilityRole="button"
            accessibilityLabel="Back to conversations"
          >
            <Ionicons name="chevron-back" size={24} color={theme.text} />
          </Pressable>
          <View style={styles.headerBody}>
            <ThemedText style={styles.headerTitle} numberOfLines={1}>
              {title}
            </ThemedText>
            {conversation?.other.business && (
              <ThemedText style={styles.headerSub} themeColor="textSecondary">
                Business account
              </ThemedText>
            )}
          </View>
        </View>

        {loading ? (
          <View style={styles.center}>
            <ActivityIndicator color={theme.primary} />
          </View>
        ) : error && items.length === 0 ? (
          <View style={styles.center}>
            <Ionicons name="cloud-offline-outline" size={36} color={theme.textSecondary} />
            <ThemedText themeColor="textSecondary" style={styles.errorText}>
              {error}
            </ThemedText>
          </View>
        ) : (
          <FlatList
            data={items}
            inverted
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
                />
              </Pressable>
            )}
            onEndReached={loadOlder}
            onEndReachedThreshold={0.4}
            contentContainerStyle={styles.listContent}
            ListFooterComponent={
              loadingOlder ? <ActivityIndicator color={theme.primary} style={styles.older} /> : undefined
            }
            ListHeaderComponent={
              requestBanner ? (
                <View style={[styles.banner, { backgroundColor: theme.primarySurface }]}>
                  <ThemedText style={[styles.bannerText, { color: theme.primary }]}>
                    {requestBanner}
                  </ThemedText>
                </View>
              ) : undefined
            }
          />
        )}

        <KeyboardAvoidingView
          behavior={Platform.OS === 'ios' ? 'padding' : undefined}
          keyboardVerticalOffset={0}
        >
          {canSend ? (
            <View style={[styles.composer, { borderTopColor: theme.border }]}>
              <TextInput
                style={[styles.input, {
                  backgroundColor: theme.backgroundElement,
                  color: theme.text,
                }]}
                placeholder="Message…"
                placeholderTextColor={theme.textSecondary}
                value={draft}
                onChangeText={setDraft}
                multiline
                maxLength={10000}
                accessibilityLabel="Message input"
              />
              <Pressable
                style={[styles.sendBtn, {
                  backgroundColor: theme.primary,
                  opacity: draft.trim() && !sending ? 1 : 0.4,
                }]}
                onPress={onSend}
                disabled={!draft.trim() || sending}
                accessibilityRole="button"
                accessibilityLabel="Send message"
              >
                {sending ? (
                  <ActivityIndicator size="small" color="#fff" />
                ) : (
                  <Ionicons name="send" size={18} color="#fff" />
                )}
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
  header: {
    flexDirection: 'row', alignItems: 'center', gap: Spacing.two,
    paddingHorizontal: Spacing.two, paddingVertical: Spacing.two,
    borderBottomWidth: StyleSheet.hairlineWidth,
  },
  backBtn: { padding: Spacing.two },
  headerBody: { flex: 1 },
  headerTitle: { fontSize: 17, fontWeight: '700' },
  headerSub: { fontSize: 12 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: Spacing.three, paddingHorizontal: Spacing.five },
  errorText: { textAlign: 'center', fontSize: 14, lineHeight: 20 },
  listContent: { paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bubbleRow: { flexDirection: 'row', marginVertical: 2 },
  rowMine: { justifyContent: 'flex-end' },
  rowTheirs: { justifyContent: 'flex-start' },
  bubble: { maxWidth: '78%', borderRadius: BorderRadius.lg, paddingHorizontal: Spacing.three, paddingVertical: Spacing.two },
  bubbleText: { fontSize: 15, lineHeight: 20 },
  bubbleMeta: { fontSize: 10, marginTop: 2, opacity: 0.75, alignSelf: 'flex-end' },
  older: { marginVertical: Spacing.three },
  banner: { margin: Spacing.two, borderRadius: 12, padding: Spacing.three },
  bannerText: { fontSize: 13, fontWeight: '600', textAlign: 'center' },
  composer: {
    flexDirection: 'row', alignItems: 'flex-end', gap: Spacing.two,
    paddingHorizontal: Spacing.three, paddingVertical: Spacing.two,
    borderTopWidth: StyleSheet.hairlineWidth,
  },
  input: { flex: 1, borderRadius: 20, paddingHorizontal: Spacing.four, paddingVertical: 10, maxHeight: 120, fontSize: 15 },
  sendBtn: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  closedNote: { flex: 1, textAlign: 'center', fontSize: 13, paddingVertical: Spacing.two },
});
