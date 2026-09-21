import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  FlatList,
  KeyboardAvoidingView,
  Modal,
  Platform,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { avatarLetter } from '@/lib/challenge/browse';
import {
  buildCommentBody,
  canDeleteComment,
  canSendComment,
  commentAttemptFor,
  commentAuthorName,
  commentText,
  reactFailure,
  reactFailureMessage,
  type CommentAttempt,
} from '@/lib/challenge/react';
import { COMMENT_MAX, type EntryComment } from '@/lib/challenge/types';
import { relativeDayLabel } from '@/lib/archive-format';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';

/**
 * A15.3 댓글(challenge.react) — 영상 위로 올라오는 바텀시트.
 *
 * 최신순 20개씩 이어 받고, 공백 정리 뒤 1~500자만 보낸다. 같은 댓글의 재전송은 같은 요청 id 라
 * 행이 늘지 않는다. 본인 댓글만 지울 수 있고, 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로
 * 보인다. 작성자가 탈퇴하면 이름만 "탈퇴한 사용자"로 바뀐다. 댓글 좋아요·답글은 1.0.0에 없다.
 */
export function ChallengeCommentsSheet({
  visible,
  entryId,
  onClose,
  onReport,
}: {
  visible: boolean;
  entryId: string | null;
  onClose: () => void;
  onReport?: (commentId: string) => void;
}) {
  const insets = useSafeAreaInsets();
  const [comments, setComments] = useState<EntryComment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<CommentAttempt | null>(null);

  const load = useCallback(async () => {
    if (!entryId) return;
    setError(null);
    try {
      const result = await api.listComments(entryId);
      setComments(result.comments);
      setCursor(result.next_cursor);
    } catch (e) {
      setComments([]);
      setError(reactFailureMessage(reactFailure(e)));
    }
  }, [entryId]);

  useEffect(() => {
    if (visible) void load();
  }, [load, visible]);

  const loadMore = async () => {
    if (!entryId || !cursor) return;
    const result = await api.listComments(entryId, cursor).catch(() => null);
    if (!result) return;
    setComments((prev) => [...(prev ?? []), ...result.comments]);
    setCursor(result.next_cursor);
  };

  const send = async () => {
    if (!entryId || !canSendComment(draft) || sending) return;
    setSending(true);
    setError(null);
    const body = buildCommentBody('pending', draft);
    const next = commentAttemptFor(attempt, body.body, newRequestId);
    setAttempt(next);
    try {
      const created = await api.createComment(entryId, { ...body, request_id: next.requestId });
      setComments((prev) => [created, ...(prev ?? [])]);
      setDraft('');
      setAttempt(null);
    } catch (e) {
      setError(reactFailureMessage(reactFailure(e)));
    } finally {
      setSending(false);
    }
  };

  const remove = async (comment: EntryComment) => {
    try {
      await api.deleteComment(comment.id);
      setComments((prev) => (prev ?? []).filter((c) => c.id !== comment.id));
    } catch (e) {
      setError(reactFailureMessage(reactFailure(e)));
    }
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <KeyboardAvoidingView behavior={Platform.OS === 'ios' ? 'padding' : undefined} style={styles.kav}>
        <View style={[styles.sheet, { paddingBottom: insets.bottom + 8 }]}>
          <View style={styles.grabber} />
          <View style={styles.header}>
            <Text style={styles.title}>{t('comments.title', { count: comments?.length ?? 0 })}</Text>
            <Pressable onPress={onClose} hitSlop={10} accessibilityRole="button">
              <Feather name="x" size={22} color={palette.textDim} />
            </Pressable>
          </View>

          {comments === null && !error && <ActivityIndicator color={palette.blue} style={{ marginVertical: 24 }} />}
          {!!error && <Text style={styles.error}>{error}</Text>}

          <FlatList
            data={comments ?? []}
            keyExtractor={(c) => c.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={comments !== null && !error ? <Text style={styles.empty}>{t('comments.empty')}</Text> : null}
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{avatarLetter(commentAuthorName(item))}</Text>
                </View>
                <View style={styles.body}>
                  <View style={styles.nameRow}>
                    <Text style={styles.name}>{commentAuthorName(item)}</Text>
                    <Text style={styles.ago}>{relativeDayLabel(item.created_at)}</Text>
                  </View>
                  <Text style={[styles.text, item.status === 'hidden' && styles.hidden]}>{commentText(item)}</Text>
                </View>
                {canDeleteComment(item) ? (
                  <Pressable onPress={() => void remove(item)} hitSlop={8} accessibilityRole="button">
                    <Text style={styles.action}>{t('comments.delete')}</Text>
                  </Pressable>
                ) : (
                  onReport && (
                    <Pressable onPress={() => onReport(item.id)} hitSlop={8} accessibilityRole="button">
                      <Feather name="flag" size={16} color={palette.checkOff} />
                    </Pressable>
                  )
                )}
              </View>
            )}
          />

          <View style={styles.inputRow}>
            <TextInput
              style={styles.input}
              placeholder={t('comments.placeholder')}
              placeholderTextColor={palette.textFaint}
              value={draft}
              onChangeText={setDraft}
              maxLength={COMMENT_MAX}
              multiline
            />
            <Pressable
              style={[styles.send, (!canSendComment(draft) || sending) && styles.sendOff]}
              onPress={() => void send()}
              disabled={!canSendComment(draft) || sending}
              accessibilityRole="button">
              <Text style={styles.sendText}>{t('comments.send')}</Text>
            </Pressable>
          </View>
          <Text style={styles.counter}>{t('comments.counter', { count: [...draft].length, max: COMMENT_MAX })}</Text>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.4)' },
  kav: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 20,
    borderTopRightRadius: 20,
    paddingHorizontal: 16,
    paddingTop: 8,
    maxHeight: '80%',
  },
  grabber: { alignSelf: 'center', width: 40, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 10 },
  header: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingBottom: 8 },
  title: { fontSize: 15, fontWeight: '900', color: palette.text },
  error: { color: palette.danger, fontSize: 13, fontWeight: '700', paddingVertical: 8 },
  list: { maxHeight: 360 },
  listContent: { paddingBottom: 8, gap: 14 },
  empty: { color: palette.textFaint, fontSize: 13.5, textAlign: 'center', paddingVertical: 28 },
  row: { flexDirection: 'row', gap: 10, alignItems: 'flex-start' },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '900', color: palette.blueDeep },
  body: { flex: 1, gap: 3 },
  nameRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  name: { fontSize: 13, fontWeight: '800', color: palette.text },
  ago: { fontSize: 11.5, color: palette.textFaint },
  text: { fontSize: 14, lineHeight: 21, color: palette.textDim },
  hidden: { fontStyle: 'italic', color: palette.textFaint },
  action: { fontSize: 12.5, fontWeight: '700', color: palette.textFaint },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingTop: 8 },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 120,
    borderRadius: 12,
    backgroundColor: palette.bgSoft,
    paddingHorizontal: 14,
    paddingVertical: 10,
    fontSize: 14,
    color: palette.text,
  },
  send: { height: 44, borderRadius: 12, backgroundColor: palette.blue, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: palette.blueLine },
  sendText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  counter: { fontSize: 11, color: palette.textFaint, textAlign: 'right', paddingTop: 4 },
});
