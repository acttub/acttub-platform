import Feather from '@expo/vector-icons/Feather';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Animated,
  FlatList,
  Modal,
  PanResponder,
  Pressable,
  StyleSheet,
  Text,
  TextInput,
  useWindowDimensions,
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
  commentAttemptFor,
  commentAuthorName,
  commentText,
  reactFailure,
  reactFailureMessage,
  type CommentAttempt,
} from '@/lib/challenge/react';
import { COMMENT_MAX, type EntryComment } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { newRequestId } from '@/lib/request-id';
import { postedAtLabel } from '@/lib/time-label';

/**
 * A15.3 댓글(challenge.react) — 영상 위로 올라오는 바텀시트. 릴스처럼 화면 2/3 높이로 올라와 위로는 영상이
 * 비치고, 손잡이를 끌어 내리면 닫힌다. 입력줄은 맨 아래 둥근 칸 하나다 (SOMA-494).
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
  const { height } = useWindowDimensions();
  // 키보드만큼 시트를 들어 올린다 — 모달 안에서는 창이 줄지 않아 입력줄이 키보드 뒤로 숨었다.
  // KeyboardAvoidingView 가 edge-to-edge 에서 어긋나는 까닭은 use-keyboard-height 에 적었다.
  const keyboard = useKeyboardHeight();
  const sheetHeight = keyboard > 0 ? Math.min(height * 0.68, height - keyboard - insets.top - 24) : height * 0.68;
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

  // 시트를 아래로 끌어 닫는다 — 릴스처럼 손잡이·제목 줄을 잡고 내린다.
  const dragY = useRef(new Animated.Value(0)).current;
  const drag = useMemo(
    () =>
      PanResponder.create({
        // 손잡이·제목 줄에는 누를 것이 없다 — 닿는 순간 잡아야 안드로이드 모달에서도 끌린다.
        onStartShouldSetPanResponder: () => true,
        onMoveShouldSetPanResponder: (_, g) => g.dy > 6 && Math.abs(g.dy) > Math.abs(g.dx),
        onPanResponderTerminationRequest: () => false,
        onPanResponderMove: (_, g) => dragY.setValue(Math.max(0, g.dy)),
        onPanResponderRelease: (_, g) => {
          if (g.dy > 120 || g.vy > 1.2) {
            onClose();
            dragY.setValue(0);
          } else {
            Animated.spring(dragY, { toValue: 0, useNativeDriver: true, bounciness: 0 }).start();
          }
        },
      }),
    [dragY, onClose],
  );
  const length = [...draft].length;
  const ready = canSendComment(draft) && !sending;

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      {/* 위쪽은 영상이 비쳐 보이게 옅게만 가린다 — 누르면 닫힌다. */}
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityRole="button" />
      <View style={[styles.kav, { bottom: keyboard }]}>
        <Animated.View
          style={[styles.sheet, { height: sheetHeight, paddingBottom: keyboard > 0 ? 6 : insets.bottom + 6, transform: [{ translateY: dragY }] }]}>
          <View {...drag.panHandlers}>
            <View style={styles.grabber} />
            <Text style={styles.title}>{t('comments.title', { count: comments?.length ?? 0 })}</Text>
          </View>
          <View style={styles.divider} />

          {comments === null && !error && <ActivityIndicator color={palette.blue} style={{ marginVertical: 24 }} />}
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
                    onReport && (
                      <Pressable onPress={() => onReport(item.id)} hitSlop={8} accessibilityRole="button">
                        <Text style={styles.action}>{t('comments.report')}</Text>
                      </Pressable>
                    )
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
                {sending ? (
                  <ActivityIndicator size="small" color="#FFFFFF" />
                ) : (
                  <Feather name="arrow-up" size={18} color="#FFFFFF" />
                )}
              </Pressable>
            </View>
            {/* 글자 수는 한도 가까이 갔을 때만 보인다 — 평소엔 입력줄만. */}
            {length >= COMMENT_MAX - 50 && (
              <Text style={styles.counter}>{t('comments.counter', { count: length, max: COMMENT_MAX })}</Text>
            )}
          </View>
        </Animated.View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { flex: 1, backgroundColor: 'rgba(0,0,0,0.25)' },
  kav: { position: 'absolute', left: 0, right: 0, bottom: 0 },
  sheet: {
    backgroundColor: palette.bg,
    borderTopLeftRadius: 18,
    borderTopRightRadius: 18,
    paddingTop: 8,
  },
  grabber: { alignSelf: 'center', width: 38, height: 4, borderRadius: 2, backgroundColor: palette.border },
  title: { fontSize: 14.5, fontWeight: '800', color: palette.text, textAlign: 'center', paddingVertical: 12 },
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
