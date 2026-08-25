import Feather from '@expo/vector-icons/Feather';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView, useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  authorName,
  relativeTime,
  type CommunityComment,
  type CommunityPost,
} from '@/lib/community';
import {
  REPORT_REASONS,
  blockableUserId,
  reportPayload,
  type ReportReason,
  type ReportTargetType,
} from '@/lib/moderation';

/** 글 상세 — 본문 + 좋아요 + 댓글. 읽기는 로그인 없이, 쓰기는 로그인 후. */
/** 신고·차단이 붙는 대상 — 글이든 댓글이든 같은 흐름을 탄다. */
type ModerationTarget = {
  type: ReportTargetType;
  id: string;
  author: { id?: string | null } | null | undefined;
  anonymous: boolean;
  mine: boolean;
};

export default function CommunityPostScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const insets = useSafeAreaInsets();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const { id } = useLocalSearchParams<{ id: string }>();
  const [post, setPost] = useState<CommunityPost | null>(null);
  const [comments, setComments] = useState<CommunityComment[]>([]);
  const [draft, setDraft] = useState('');
  const [anonymous, setAnonymous] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [now, setNow] = useState<number | null>(null);

  const load = useCallback(async () => {
    if (!id) return;
    try {
      const [detail, list] = await Promise.all([api.communityPost(id), api.communityComments(id)]);
      setPost(detail);
      setComments(list.comments);
      setNow(Date.now());
    } catch {
      setError('글을 불러오지 못했어요.');
    }
  }, [id]);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggleLike() {
    if (!post) return;
    if (!user) {
      router.push('/login');
      return;
    }
    const next = !post.liked_by_me;
    // 낙관적으로 먼저 바꾼다 — 하트는 즉시 반응해야 눌린 느낌이 난다.
    setPost({
      ...post,
      liked_by_me: next,
      like_count: post.like_count + (next ? 1 : -1),
    });
    try {
      await api.likeCommunityPost(post.id, next);
    } catch {
      setPost(post);
    }
  }

  async function submitComment() {
    if (!post || !draft.trim() || busy) return;
    if (!user) {
      router.push('/login');
      return;
    }
    setBusy(true);
    try {
      const created = await api.createCommunityComment(post.id, {
        body: draft.trim(),
        anonymous,
      });
      setComments((prev) => [...prev, created]);
      setPost({ ...post, comment_count: post.comment_count + 1 });
      setDraft('');
    } catch {
      setError('댓글을 남기지 못했어요.');
    } finally {
      setBusy(false);
    }
  }

  // ---- 신고·차단 (SOMA-444) — 서버·문구는 웹과 동일, UI만 앱 시트로. ----

  const requireLogin = () => {
    if (user) return true;
    router.push('/login');
    return false;
  };

  const doBlock = async (userId: string, targetType: ReportTargetType) => {
    try {
      await api.blockCommunityUser(userId);
      // 글 작성자를 차단했으면 이 글 자체를 더 볼 이유가 없다 — 목록으로 돌아간다.
      if (targetType === 'post') router.back();
      else await load();
    } catch {
      await alert({ title: '차단하지 못했어요', message: '잠시 후 다시 시도해주세요.' });
    }
  };

  const submitReport = async (target: ModerationTarget, reason: ReportReason) => {
    try {
      await api.reportCommunityContent(
        reportPayload({ targetType: target.type, targetId: target.id, reason }),
      );
      const blockable = blockableUserId(target.author, {
        anonymous: target.anonymous,
        mine: target.mine,
      });
      if (blockable) {
        const also = await confirm({
          title: '신고를 접수했어요',
          message:
            '확인하는 데 시간이 걸릴 수 있어요. 이 사람 글을 더 보고 싶지 않다면 차단할 수도 있어요.',
          confirmLabel: '차단하기',
        });
        if (also) await doBlock(blockable, target.type);
      } else {
        await alert({ title: '신고를 접수했어요', message: '확인하는 데 시간이 걸릴 수 있어요.' });
      }
    } catch {
      await alert({
        title: '신고하지 못했어요',
        message: '이미 신고한 내용이거나, 잠시 문제가 있었어요.',
      });
    }
  };

  const askReason = (target: ModerationTarget) => {
    void sheet({
      title: '무엇이 문제인가요?',
      actions: REPORT_REASONS.map((r) => ({
        label: r.label,
        onPress: () => void submitReport(target, r.value),
      })),
    });
  };

  const askBlock = async (target: ModerationTarget, userId: string) => {
    const ok = await confirm({
      title: '이 사람을 차단할까요?',
      message: '차단하면 이 사람의 글과 댓글이 더 이상 보이지 않아요.',
      confirmLabel: '차단',
      destructive: true,
    });
    if (ok) await doBlock(userId, target.type);
  };

  const openModeration = (target: ModerationTarget) => {
    if (!requireLogin()) return;
    const blockable = blockableUserId(target.author, {
      anonymous: target.anonymous,
      mine: target.mine,
    });
    void sheet({
      title: target.type === 'post' ? '이 글' : '이 댓글',
      actions: [
        { label: '신고하기', destructive: true, onPress: () => askReason(target) },
        ...(blockable
          ? [
              {
                label: '작성자 차단하기',
                destructive: true,
                onPress: () => void askBlock(target, blockable),
              },
            ]
          : []),
      ],
    });
  };

  if (!post) {
    return (
      <SafeAreaView style={styles.safe} edges={['top']}>
        <Header onBack={() => router.back()} />
        {dialog}
        <View style={styles.center}>
          {error ? <Text style={styles.error}>{error}</Text> : <ActivityIndicator color={palette.blue} />}
        </View>
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <Header onBack={() => router.back()} />
      {/* KeyboardAvoidingView 는 안드로이드 edge-to-edge에서 계산이 어긋나 입력 바가 키보드에
          가려진다 — 키보드 높이를 직접 받아 그만큼만 올린다([[use-keyboard-height]]). */}
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView contentContainerStyle={styles.body}>
          <Text style={styles.category}>{post.category_name}</Text>
          <Text style={styles.title}>{post.title}</Text>
          <View style={styles.metaRow}>
            <Text style={styles.meta}>{authorName(post.author, post.anonymous)}</Text>
            <Text style={styles.metaDot}>·</Text>
            <Text style={styles.meta}>{relativeTime(post.created_at, now)}</Text>
            <View style={styles.metaSpacer} />
            <Pressable
              hitSlop={10}
              accessibilityRole="button"
              accessibilityLabel="글 메뉴"
              onPress={() =>
                openModeration({
                  type: 'post',
                  id: post.id,
                  author: post.author,
                  anonymous: post.anonymous,
                  mine: !!user && !!post.author?.id && post.author.id === user.id,
                })
              }>
              <Feather name="more-horizontal" size={18} color={palette.textFaint} />
            </Pressable>
          </View>

          <Text style={styles.content}>{post.body}</Text>

          <Pressable style={styles.likeBtn} onPress={toggleLike} accessibilityRole="button">
            <Feather
              name="heart"
              size={16}
              color={post.liked_by_me ? palette.danger : palette.textFaint}
            />
            <Text style={[styles.likeText, post.liked_by_me && styles.likeTextOn]}>
              {post.like_count}
            </Text>
          </Pressable>

          <View style={styles.divider} />

          <Text style={styles.commentHead}>댓글 {post.comment_count}</Text>
          {comments.map((comment) => (
            <View key={comment.id} style={styles.comment}>
              <View style={styles.metaRow}>
                <Text style={styles.commentAuthor}>
                  {authorName(comment.author, comment.anonymous)}
                </Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.meta}>{relativeTime(comment.created_at, now)}</Text>
                <View style={styles.metaSpacer} />
                {!comment.mine && (
                  <Pressable
                    hitSlop={10}
                    accessibilityRole="button"
                    accessibilityLabel="댓글 메뉴"
                    onPress={() =>
                      openModeration({
                        type: 'comment',
                        id: comment.id,
                        author: comment.author,
                        anonymous: comment.anonymous,
                        mine: comment.mine,
                      })
                    }>
                    <Feather name="more-horizontal" size={16} color={palette.textFaint} />
                  </Pressable>
                )}
              </View>
              <Text style={styles.commentBody}>{comment.body}</Text>
            </View>
          ))}
          {comments.length === 0 && <Text style={styles.noComment}>첫 댓글을 남겨보세요.</Text>}
          <View style={styles.spacer} />
        </ScrollView>

        {/* 하단 인셋을 직접 더한다 — SafeArea edges에 bottom을 넣으면 키보드가 올라올 때
            빈 띠가 남아서, 입력창이 홈버튼(제스처 바)에 가리지 않을 만큼만 패딩으로 채운다. */}
        <View style={[styles.composer, { paddingBottom: keyboardVisible ? 10 : 10 + Math.max(insets.bottom, 4) }]}>
          <Pressable
            style={styles.anonRow}
            onPress={() => setAnonymous((was) => !was)}
            accessibilityRole="checkbox"
            accessibilityState={{ checked: anonymous }}>
            <Feather
              name={anonymous ? 'check-square' : 'square'}
              size={16}
              color={anonymous ? palette.blue : palette.checkOff}
            />
            <Text style={[styles.anonText, anonymous && styles.anonTextOn]}>익명</Text>
          </Pressable>
          <TextInput
            style={styles.input}
            value={draft}
            onChangeText={setDraft}
            placeholder={user ? '댓글을 남겨보세요' : '로그인하고 댓글 남기기'}
            placeholderTextColor={palette.textFaint}
            multiline
          />
          <Pressable
            style={[styles.send, (!draft.trim() || busy) && styles.sendOff]}
            onPress={submitComment}
            accessibilityRole="button"
            accessibilityLabel="댓글 등록">
            <Feather name="arrow-up" size={18} color="#FFFFFF" />
          </Pressable>
        </View>
      </View>
      {dialog}
    </SafeAreaView>
  );
}

function Header({ onBack }: { onBack: () => void }) {
  return (
    <View style={styles.header}>
      <Pressable onPress={onBack} accessibilityRole="button" accessibilityLabel="뒤로">
        <Feather name="chevron-left" size={24} color={palette.text} />
      </Pressable>
      <Text style={styles.headerTitle}>게시판</Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    paddingVertical: 10,
  },
  headerTitle: { fontSize: 15, fontWeight: '700', color: palette.text },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  body: { paddingHorizontal: 20, paddingTop: 6 },
  category: { fontSize: 12, fontWeight: '800', color: palette.blue },
  title: {
    marginTop: 8,
    fontSize: 21,
    fontWeight: '800',
    color: palette.text,
    lineHeight: 29,
    letterSpacing: -0.4,
  },
  metaRow: { marginTop: 8, flexDirection: 'row', alignItems: 'center', gap: 5 },
  metaSpacer: { flex: 1 },
  meta: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  metaDot: { fontSize: 12, color: palette.textFaint },
  content: {
    marginTop: 18,
    fontSize: 15,
    fontWeight: '500',
    color: palette.text,
    lineHeight: 24,
  },
  likeBtn: {
    marginTop: 22,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 36,
    borderRadius: 18,
    borderWidth: 1,
    borderColor: palette.border,
  },
  likeText: { fontSize: 13, fontWeight: '700', color: palette.textFaint },
  likeTextOn: { color: palette.danger },
  divider: { marginTop: 22, height: 1, backgroundColor: palette.border },
  commentHead: { marginTop: 18, fontSize: 14, fontWeight: '800', color: palette.text },
  comment: { marginTop: 16 },
  commentAuthor: { fontSize: 13, fontWeight: '700', color: palette.text },
  commentBody: {
    marginTop: 5,
    fontSize: 14,
    fontWeight: '500',
    color: palette.textDim,
    lineHeight: 21,
  },
  noComment: { marginTop: 16, fontSize: 13, fontWeight: '600', color: palette.textFaint },
  spacer: { height: 24 },
  composer: {
    flexDirection: 'row',
    alignItems: 'flex-end',
    gap: 8,
    paddingHorizontal: 16,
    paddingTop: 10,
    paddingBottom: 14,
    borderTopWidth: 1,
    borderTopColor: palette.border,
    backgroundColor: palette.card,
  },
  anonRow: { flexDirection: 'row', alignItems: 'center', gap: 4, paddingBottom: 10 },
  anonText: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  anonTextOn: { color: palette.blue },
  input: {
    flex: 1,
    minHeight: 40,
    maxHeight: 110,
    paddingHorizontal: 14,
    paddingTop: 10,
    paddingBottom: 10,
    borderRadius: 20,
    backgroundColor: palette.bgSoft,
    fontSize: 14,
    color: palette.text,
  },
  send: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: palette.checkOff },
  error: { color: palette.danger, fontWeight: '600' },
});
