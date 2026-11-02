import Feather from '@expo/vector-icons/Feather';
import MaterialCommunityIcons from '@expo/vector-icons/MaterialCommunityIcons';
import { useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View, type GestureResponderEvent } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog, type DialogAction } from '@/components/app-dialog';
import { CommunityReportPage } from '@/components/community/community-report-page';
import { KeyboardLift } from '@/components/keyboard-lift';
import { pt } from '@/components/ui/anchored-menu';
import { DefaultAvatar } from '@/components/ui/default-avatar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { NavBackButton, NavHeader, NavIconButton } from '@/components/ui/nav-header';
import { SkeletonDetail } from '@/components/ui/skeleton';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { useReadableInput } from '@/hooks/use-readable-input';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { errorStatus } from '@/lib/api-request';
import { useAuth } from '@/lib/auth';
import {
  COMMENT_MAX,
  authorId,
  avatarSeed,
  displayName,
  isHiddenPost,
  isMine,
  isPostAuthor,
  postWriteFailure,
  relativeTime,
  type CommunityComment,
  type CommunityPost,
  type CommunityReportReason,
} from '@/lib/community';
import { translate as t } from '@/lib/i18n';

type Target = { type: 'post' | 'comment'; id: string; authorId: string | null };

/**
 * 게시판 글 상세(pen community-post.menu-open) — NavHeader 44 「게시판」 + 오른쪽 ⋯.
 * ⋯ 는 바로 아래 Menu: 남의 글은 신고하기·이 사람 차단하기, 내 글은 수정하기·삭제(맨 아래 danger, 확인 다이얼로그).
 * 본문 → 좋아요·댓글 수 → 댓글(기본 얼굴 28, 글쓴이 배지). 아래는 TextField 모양 입력칸 + 「등록」, 키보드 위로 올라온다.
 * 신고로 가려진 내 글은 위에 「다른 사람에게는 보이지 않아요」를 둔다.
 */
export default function CommunityPostScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [commentCursor, setCommentCursor] = useState<string | null>(null);
  const [failed, setFailed] = useState<'gone' | 'error' | null>(null);
  const [draft, setDraft] = useState('');
  const [sending, setSending] = useState(false);
  const [sendError, setSendError] = useState<string | null>(null);
  const [focused, setFocused] = useState(false);
  const [reportTarget, setReportTarget] = useState<Target | null>(null);
  const [reporting, setReporting] = useState(false);
  /** 글 열기 기록은 처음 받았을 때 한 번만 — 돌아와 다시 받을 때는 남기지 않는다. */
  const opened = useRef(false);
  const changeDraft = useCallback((v: string) => {
    setDraft(v);
    setSendError(null);
  }, []);
  // 허용 범위 밖 글자는 입력 단계에서 뺀다(SOMA-922, 댓글은 strict).
  const readable = useReadableInput(changeDraft);

  const load = useCallback(async () => {
    if (!id) return;
    setFailed(null);
    try {
      const [detail, list] = await Promise.all([api.communityPost(id), api.communityComments(id)]);
      if (!opened.current) {
        opened.current = true;
        void logEvent('community_post_open', { id: detail.id, category: detail.category_slug });
      }
      setPost(detail);
      setComments(list.comments);
      setCommentCursor(list.next_cursor ?? null);
    } catch (e) {
      setFailed(errorStatus(e) === 404 ? 'gone' : 'error');
    }
  }, [id]);

  useFocusEffect(
    useCallback(() => {
      void load();
    }, [load]),
  );

  const requireLogin = () => {
    if (user) return true;
    router.push('/login');
    return false;
  };

  const loadMoreComments = async () => {
    if (!id || !commentCursor) return;
    try {
      const list = await api.communityComments(id, commentCursor);
      setComments((prev) => {
        const have = new Set(prev.map((c) => c.id));
        return [...prev, ...list.comments.filter((c) => !have.has(c.id))];
      });
      setCommentCursor(list.next_cursor ?? null);
    } catch {
      // 다시 누르면 다시 받는다.
    }
  };

  const toggleLike = async () => {
    if (!post || !requireLogin()) return;
    const before = post;
    const next = !post.liked_by_me;
    // 하트는 바로 바뀌어야 눌린 느낌이 난다 — 먼저 바꾸고 서버 답으로 맞춘다.
    setPost({ ...post, liked_by_me: next, like_count: Math.max(0, post.like_count + (next ? 1 : -1)) });
    try {
      const res = await api.likeCommunityPost(post.id, next);
      setPost((p) => (p ? { ...p, like_count: res.like_count, liked_by_me: res.liked_by_me } : p));
    } catch {
      setPost(before);
    }
  };

  const submitComment = async () => {
    const body = draft.trim();
    if (!post || !body || sending || !requireLogin()) return;
    setSending(true);
    setSendError(null);
    try {
      const created = await api.createCommunityComment(post.id, { body });
      setComments((prev) => [...prev, created]);
      setPost((p) => (p ? { ...p, comment_count: p.comment_count + 1 } : p));
      setDraft('');
      void logEvent('community_comment_create', { post_id: post.id });
    } catch (e) {
      setSendError(postWriteFailure(e) === 'contact' ? t('communityNew.contactError') : t('communityPost.commentFail'));
    } finally {
      setSending(false);
    }
  };

  const doBlock = async (target: Target) => {
    if (!target.authorId) return;
    const ok = await confirm({
      title: t('communityPost.blockTitle'),
      message: t('communityPost.blockMsg'),
      confirmLabel: t('communityPost.blockConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.blockCommunityUser(target.authorId);
      void logEvent('community_block', { target: target.type });
      // 글쓴이를 차단했으면 이 글을 더 볼 이유가 없다 — 목록으로 돌아간다.
      if (target.type === 'post') router.back();
      else await load();
    } catch {
      await alert({ title: t('communityPost.blockFail'), message: t('common.tryLater') });
    }
  };

  const submitReport = async (reason: CommunityReportReason, detail: string) => {
    if (!reportTarget || reporting) return;
    setReporting(true);
    try {
      await api.reportCommunityContent({
        target_type: reportTarget.type,
        target_id: reportTarget.id,
        reason,
        ...(detail ? { detail } : {}),
      });
      void logEvent('community_report', { target: reportTarget.type, reason });
      setReportTarget(null);
      await alert({ title: t('communityPost.reportedTitle'), message: t('communityPost.reportedBody') });
    } catch (e) {
      setReportTarget(null);
      await alert({
        title: t('communityPost.reportFailTitle'),
        message: errorStatus(e) === 409 ? t('communityPost.reportDuplicate') : t('common.tryLater'),
      });
    } finally {
      setReporting(false);
    }
  };

  const confirmDelete = async (target: Target) => {
    const isPost = target.type === 'post';
    const ok = await confirm({
      title: isPost ? t('communityPost.deletePostTitle') : t('communityPost.deleteCommentTitle'),
      message: isPost ? t('communityPost.deletePostMsg') : undefined,
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    try {
      if (isPost) {
        await api.deleteCommunityPost(target.id);
        router.back();
      } else {
        await api.deleteCommunityComment(target.id);
        setComments((prev) => prev.filter((c) => c.id !== target.id));
        setPost((p) => (p ? { ...p, comment_count: Math.max(0, p.comment_count - 1) } : p));
      }
    } catch {
      await alert({ title: t('communityPost.deleteFail'), message: t('common.tryLater') });
    }
  };

  const openMenu = (target: Target, mine: boolean, e?: GestureResponderEvent) => {
    if (!requireLogin()) return;
    const actions: DialogAction[] = mine
      ? [
          ...(target.type === 'post'
            ? [{ label: t('communityPost.edit'), onPress: () => router.push({ pathname: '/community-new', params: { id: target.id } }) }]
            : []),
          { label: t('common.delete'), destructive: true, onPress: () => void confirmDelete(target) },
        ]
      : [
          { label: t('communityPost.report'), onPress: () => setReportTarget(target) },
          ...(target.authorId ? [{ label: t('communityPost.blockAuthor'), onPress: () => void doBlock(target) }] : []),
        ];
    void sheet({ anchor: pt(e), actions });
  };

  const back = () => router.back();

  if (failed) {
    return (
      <StatusScreen
        safeArea
        header={t('communityPost.headerTitle')}
        onBack={back}
        title={failed === 'gone' ? t('communityPost.goneTitle') : t('communityPost.loadFail')}
        primary={failed === 'gone' ? { label: t('communityPost.backToList'), onPress: back } : { label: t('common.retry'), onPress: () => void load() }}
      />
    );
  }

  if (!post) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <NavHeader title={t('communityPost.headerTitle')} left={<NavBackButton onPress={back} />} />
        <SkeletonDetail lines={5} />
      </SafeAreaView>
    );
  }

  const postTarget: Target = { type: 'post', id: post.id, authorId: authorId(post) };
  const canSend = draft.trim().length > 0 && !sending;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <NavHeader
        title={t('communityPost.headerTitle')}
        left={<NavBackButton onPress={back} />}
        right={
          <NavIconButton
            icon="more-horizontal"
            label={t('communityPost.menuA11y')}
            phLabel="community_post_menu"
            onPress={(e) => openMenu(postTarget, isMine(post), e)}
          />
        }
      />
      <KeyboardLift aboveSafeBottom>
        <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {isHiddenPost(post) && isMine(post) ? (
            <View style={styles.hidden}>
              <Feather name="eye-off" size={16} color={palette.textSub} />
              <Text style={styles.hiddenText}>{t('communityPost.hiddenNotice')}</Text>
            </View>
          ) : null}
          <Text style={styles.category}>{post.category_name}</Text>
          <Text style={styles.title}>{post.title}</Text>
          <View style={styles.author}>
            <DefaultAvatar size={28} radius={14} seed={avatarSeed(post)} />
            <Text style={styles.authorName} numberOfLines={1}>
              {displayName(post)}
            </Text>
            <Text style={styles.time}>· {relativeTime(post.created_at)}</Text>
          </View>
          <Text style={styles.content} selectable>
            {post.body}
          </Text>
          <View style={styles.divider} />
          <View style={styles.reactions}>
            <Pressable
              style={({ pressed }) => [styles.reaction, pressed && styles.pressed]}
              onPress={() => void toggleLike()}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ selected: post.liked_by_me }}
              accessibilityLabel={t('communityPost.likeA11y', { count: post.like_count })}
              ph-label="community_post_like">
              {post.liked_by_me ? (
                <MaterialCommunityIcons name="heart" size={20} color={palette.danger} testID="liked-heart" />
              ) : (
                <Feather name="heart" size={20} color={palette.textSub} />
              )}
              <Text style={styles.reactionText}>{t('communityPost.likeCount', { count: post.like_count })}</Text>
            </Pressable>
            <View style={styles.reaction}>
              <Feather name="message-circle" size={20} color={palette.textSub} />
              <Text style={styles.reactionText}>{t('communityPost.commentCount', { count: post.comment_count })}</Text>
            </View>
          </View>
          <View style={styles.divider} />

          {comments.length === 0 ? <Text style={styles.noComment}>{t('communityPost.firstComment')}</Text> : null}
          {comments.map((comment) => {
            const mine = isMine(comment);
            return (
              <View key={comment.id} style={styles.comment}>
                <DefaultAvatar size={28} radius={14} seed={avatarSeed(comment)} />
                <View style={styles.commentMain}>
                  <View style={styles.commentHead}>
                    <Text style={styles.commentName} numberOfLines={1}>
                      {displayName(comment)}
                    </Text>
                    {isPostAuthor(post, comment) ? <Text style={styles.authorBadge}>{t('communityPost.authorBadge')}</Text> : null}
                    <Text style={styles.time}>{relativeTime(comment.created_at)}</Text>
                    <View style={styles.flex} />
                    <Pressable
                      hitSlop={10}
                      onPress={(e) => openMenu({ type: 'comment', id: comment.id, authorId: authorId(comment) }, mine, e)}
                      accessibilityRole="button"
                      accessibilityLabel={t('communityPost.commentMenuA11y')}
                      ph-label="community_comment_menu">
                      <Feather name="more-horizontal" size={16} color={palette.iconFaint} />
                    </Pressable>
                  </View>
                  <Text style={styles.commentBody} selectable>
                    {comment.body}
                  </Text>
                </View>
              </View>
            );
          })}
          {commentCursor ? (
            <Pressable style={styles.more} onPress={() => void loadMoreComments()} accessibilityRole="button" ph-label="community_comment_more">
              <Text style={styles.moreText}>{t('communityPost.moreComments')}</Text>
            </Pressable>
          ) : null}
        </ScrollView>

        <View style={styles.bar}>
          {sendError || readable.hint ? <InlineErrorLine message={sendError ?? readable.hint ?? ''} /> : null}
          <View style={styles.barRow}>
            <TextInput
              style={[styles.input, focused && styles.inputFocus]}
              value={draft}
              onChangeText={readable.onChangeText}
              onFocus={() => {
                setFocused(true);
                if (!user) router.push('/login');
              }}
              onBlur={() => setFocused(false)}
              placeholder={t('communityPost.commentPh')}
              placeholderTextColor={palette.textDisabled}
              maxLength={COMMENT_MAX}
              accessibilityLabel={t('communityPost.commentPh')}
              returnKeyType="send"
              onSubmitEditing={() => void submitComment()}
            />
            <Pressable
              onPress={() => void submitComment()}
              disabled={!canSend}
              hitSlop={8}
              accessibilityRole="button"
              accessibilityState={{ disabled: !canSend, busy: sending }}
              accessibilityLabel={t('communityPost.send')}
              ph-label="community_comment_send">
              <Text style={[styles.send, canSend && styles.sendOn]}>{t('communityPost.send')}</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardLift>
      <CommunityReportPage
        visible={!!reportTarget}
        target={reportTarget?.type ?? 'post'}
        busy={reporting}
        onClose={() => setReportTarget(null)}
        onSubmit={(reason, detail) => void submitReport(reason, detail)}
      />
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.6 },
  body: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[6], gap: space[2] },
  hidden: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    padding: space[3],
    borderRadius: radius.md,
    backgroundColor: palette.bgSoft,
    marginBottom: space[2],
  },
  hiddenText: { ...type.caption, flex: 1, color: palette.textSub },
  category: { ...type.micro, color: palette.blueDeep },
  title: { ...type.title2, color: palette.text },
  author: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  authorName: { ...type.body2Bold, color: palette.text, flexShrink: 1 },
  time: { ...type.caption, color: palette.textMeta },
  content: { ...type.body1, color: palette.text, marginTop: space[2], marginBottom: space[2] },
  divider: { height: 1, backgroundColor: palette.border },
  reactions: { flexDirection: 'row', gap: space[4], paddingVertical: space[1] },
  reaction: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], minHeight: 32 },
  reactionText: { ...type.body2Bold, color: palette.textSub },
  noComment: { ...type.body2, color: palette.textMeta, paddingVertical: space[3] },
  comment: { flexDirection: 'row', gap: space[3], paddingVertical: space[3] },
  commentMain: { flex: 1, gap: 2 },
  commentHead: { flexDirection: 'row', alignItems: 'center', gap: space[1.5] },
  commentName: { ...type.body2Bold, color: palette.text, flexShrink: 1 },
  authorBadge: {
    ...type.micro,
    color: palette.blueDeep,
    backgroundColor: palette.blueSoft,
    borderRadius: radius.xs,
    overflow: 'hidden',
    paddingHorizontal: space[1.5],
    paddingVertical: 1,
  },
  commentBody: { ...type.body2, color: palette.text },
  more: { alignItems: 'center', paddingVertical: space[3] },
  moreText: { ...type.body2Bold, color: palette.blueDeep },
  bar: {
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.bg,
    paddingTop: space[3],
    paddingBottom: space[3],
    paddingHorizontal: space.gutter,
    gap: space[2],
  },
  barRow: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  input: {
    flex: 1,
    height: 48,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
    paddingHorizontal: space[4] - 2,
    ...type.body1,
    color: palette.text,
  },
  inputFocus: { borderWidth: 1.5, borderColor: palette.blue, paddingHorizontal: space[4] - 2.5 },
  send: { ...type.body2Bold, color: palette.textMeta },
  sendOn: { color: palette.blueDeep },
});
