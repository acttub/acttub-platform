import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useState } from 'react';
import {
  FlatList,
  Modal,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { api } from '@/lib/api';
import { avatarLetter } from '@/lib/challenge/browse';
import {
  buildCommentBody,
  canDeleteComment,
  canSendComment,
  commentAuthorName,
  commentText,
  reactFailure,
  reactFailureMessage,
} from '@/lib/challenge/react';
import { COMMENT_MAX, type EntryComment } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';
import { postedAtLabel } from '@/lib/time-label';

/**
 * A15.3 댓글(challenge.react) — 아래에서 올라오는 시트 대신 전체 화면 페이지다(SOMA-821, 하단 시트 금지).
 * 위 머리줄에 가운데 「댓글 N」·왼쪽 닫기 X, 입력줄은 맨 아래 둥근 칸 하나다 (SOMA-494).
 *
 * 최신순 20개씩 이어 받고, 공백 정리 뒤 1~500자만 보낸다. 같은 댓글의 재전송은 같은 요청 id 라
 * 행이 늘지 않는다. 본인 댓글만 지울 수 있고, 신고로 숨겨진 내 댓글은 원래 자리에 "확인 중"으로
 * 보인다. 작성자가 탈퇴하면 이름만 "탈퇴한 사용자"로 바뀐다. 댓글 좋아요·답글은 0.1.0에 없다.
 */
export function ChallengeCommentsSheet({
  visible,
  entryId,
  onClose,
  onReport,
  onCountChange,
}: {
  visible: boolean;
  entryId: string | null;
  onClose: () => void;
  onReport: (commentId: string) => void;
  /** 댓글을 쓰거나 지운 직후 뷰어 하단 댓글 수를 바로 맞추도록 알린다(+1 / -1). */
  onCountChange?: (delta: number) => void;
}) {
  const insets = useSafeAreaInsets();
  // 키보드만큼 아래 여백을 늘려 입력줄을 올린다 — 모달 안에서는 창이 줄지 않아 입력줄이 키보드 뒤로 숨었다.
  // KeyboardAvoidingView 가 edge-to-edge 에서 어긋나는 까닭은 use-keyboard-height 에 적었다.
  const keyboard = useKeyboardHeight();
  const [comments, setComments] = useState<EntryComment[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [attempt, setAttempt] = useState<RequestAttempt | null>(null);

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
    const next = attemptFor(attempt, body.body, newRequestId);
    setAttempt(next);
    try {
      const created = await api.createComment(entryId, { ...body, request_id: next.requestId });
      setComments((prev) => [created, ...(prev ?? [])]);
      onCountChange?.(1);
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
      onCountChange?.(-1);
    } catch (e) {
      setError(reactFailureMessage(reactFailure(e)));
    }
  };

  const length = [...draft].length;
  const ready = canSendComment(draft) && !sending;

  return (
    <Modal visible={visible} animationType="fade" onRequestClose={onClose}>
      <View style={[styles.page, { paddingTop: insets.top, paddingBottom: keyboard > 0 ? keyboard + 6 : insets.bottom + 6 }]}>
        <View style={styles.header}>
          <Pressable
            style={styles.close}
            onPress={onClose}
            hitSlop={8}
            accessibilityRole="button"
            accessibilityLabel={t('comments.close')}>
            <Feather name="x" size={22} color={palette.text} />
          </Pressable>
          <Text style={styles.title}>{t('comments.title', { count: comments?.length ?? 0 })}</Text>
        </View>
        <View style={styles.divider} />
          {!!error && <Text style={styles.error}>{error}</Text>}

          <FlatList
            data={comments ?? []}
            keyExtractor={(c) => c.id}
            style={styles.list}
            contentContainerStyle={styles.listContent}
            keyboardShouldPersistTaps="handled"
            onEndReached={() => void loadMore()}
            onEndReachedThreshold={0.3}
            ListEmptyComponent={
              comments !== null && !error ? (
                <View style={styles.emptyBox}>
                  <Text style={styles.emptyTitle}>{t('comments.emptyTitle')}</Text>
                  <Text style={styles.empty}>{t('comments.empty')}</Text>
                </View>
              ) : null
            }
            renderItem={({ item }) => (
              <View style={styles.row}>
                <View style={styles.avatar}>
                  <Text style={styles.avatarText}>{avatarLetter(commentAuthorName(item))}</Text>
                </View>
                <View style={styles.body}>
                  <Text style={styles.meta}>
                    <Text style={styles.name}>{commentAuthorName(item)}</Text>
                    {'  '}
                    {postedAtLabel(item.created_at)}
                  </Text>
                  <Text style={[styles.text, item.status === 'hidden' && styles.hidden]}>{commentText(item)}</Text>
                  {canDeleteComment(item) ? (
                    <Pressable onPress={() => void remove(item)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.action}>{t('comments.delete')}</Text>
                    </Pressable>
                  ) : (
                    <Pressable onPress={() => onReport(item.id)} hitSlop={8} accessibilityRole="button">
                      <Text style={styles.action}>{t('comments.report')}</Text>
                    </Pressable>
                  )}
                </View>
              </View>
            )}
          />

          <View style={styles.inputBar}>
            <View style={styles.inputPill}>
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
                style={[styles.send, !ready && styles.sendOff]}
                onPress={() => void send()}
                disabled={!ready}
                hitSlop={6}
                accessibilityRole="button"
                accessibilityLabel={t('comments.send')}>
                {/* SOMA-828: 작은 원형 버튼이라 문구 대신 아이콘을 그대로 둔다(보내는 동안 비활성) */}
                  <Feather name="arrow-up" size={18} color="#FFFFFF" />
              </Pressable>
            </View>
            {/* 글자 수는 한도 가까이 갔을 때만 보인다 — 평소엔 입력줄만. */}
            {length >= COMMENT_MAX - 50 && (
              <Text style={styles.counter}>{t('comments.counter', { count: length, max: COMMENT_MAX })}</Text>
            )}
          </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  page: { flex: 1, backgroundColor: palette.bg },
  header: { height: 48, justifyContent: 'center' },
  close: { position: 'absolute', left: 12, width: 36, height: 36, alignItems: 'center', justifyContent: 'center', zIndex: 1 },
  title: { fontSize: 15, fontWeight: '800', color: palette.text, textAlign: 'center' },
  divider: { height: StyleSheet.hairlineWidth, backgroundColor: palette.border },
  error: { color: palette.danger, fontSize: 13, fontWeight: '700', paddingVertical: 8, paddingHorizontal: 16 },
  list: { flex: 1 },
  listContent: { paddingHorizontal: 16, paddingTop: 14, paddingBottom: 12, gap: 18 },
  emptyBox: { alignItems: 'center', paddingVertical: 48, gap: 6 },
  emptyTitle: { color: palette.text, fontSize: 17, fontWeight: '800' },
  empty: { color: palette.textFaint, fontSize: 13.5, textAlign: 'center' },
  row: { flexDirection: 'row', gap: 12, alignItems: 'flex-start' },
  avatar: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 13, fontWeight: '900', color: palette.blueDeep },
  body: { flex: 1, gap: 3 },
  meta: { fontSize: 12, color: palette.textFaint },
  name: { fontSize: 12.5, fontWeight: '800', color: palette.text },
  text: { fontSize: 14, lineHeight: 20, color: palette.text },
  hidden: { fontStyle: 'italic', color: palette.textFaint },
  action: { fontSize: 12, fontWeight: '700', color: palette.textFaint, marginTop: 4 },
  inputBar: {
    borderTopWidth: StyleSheet.hairlineWidth,
    borderTopColor: palette.border,
    paddingHorizontal: 12,
    paddingTop: 8,
  },
  inputPill: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    borderRadius: 22,
    borderWidth: 1,
    borderColor: palette.border,
    paddingLeft: 16,
    paddingRight: 5,
    paddingVertical: 5,
  },
  input: { flex: 1, minHeight: 34, maxHeight: 110, paddingVertical: 7, fontSize: 14, color: palette.text },
  send: { width: 34, height: 34, borderRadius: 17, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: palette.blueLine },
  counter: { fontSize: 11, color: palette.textFaint, textAlign: 'right', paddingTop: 4, paddingRight: 6 },
});
