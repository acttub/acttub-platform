import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog } from '@/components/app-dialog';
import { Chip } from '@/components/ui/chip';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { LoadingText } from '@/components/ui/loading-text';
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  boardFailure,
  boardFailureMessage,
  bodyPreview,
  categoryChips,
  listThumb,
  metaLine,
  type BoardFailure,
  type CommunityCategory,
  type CommunityPost,
} from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/**
 * 커뮤니티 · 게시판(pen community.board) — 분류 칩 → 광고(community_list_top) → 공지 카드 → 글 목록.
 * 목록 행은 분류 · 제목 · 미리보기 · `이름 · 시간` · 댓글 수만 둔다(좋아요 수는 글 상세에만). 사진이 있으면 오른쪽에 첫 장 64 썸네일,
 * 2장 이상이면 썸네일 오른쪽 아래에 장수 배지. 게스트(403 member_only)·탈퇴 계정은 챌린지 목록처럼 다시 시도 없이 한 줄로 알린다.
 * 네 상태: 불러오는 중 Skeleton 행, 비었음 InlineEmpty + 「첫 글 쓰기」, 실패 InlineError, 채움. 당겨서 새로고침, 끝에서 이어 받기.
 * `onSeen` 은 첫 쪽을 받을 때마다 가장 최근 글 시각을 알린다(「게시판」 빨간 점 끄기).
 */
export function CommunityBoard({
  bottomSpace,
  onWrite,
  onSeen,
}: {
  bottomSpace: number;
  onWrite: () => void;
  onSeen: (latestCreatedAt: string | null) => void;
}) {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [category, setCategory] = useState('');
  const [posts, setPosts] = useState<CommunityPost[] | null>(null);
  const [cursor, setCursor] = useState<string | null>(null);
  const [error, setError] = useState<BoardFailure | null>(null);
  const [refreshing, setRefreshing] = useState(false);
  const [loadingMore, setLoadingMore] = useState(false);
  /** 지금 보이는 분류. 받는 중에 분류를 바꾸면 늦게 온 옛 결과를 버린다. */
  const shown = useRef('');

  useEffect(() => {
    void logEvent('community_board_open');
    void api
      .communityCategories()
      .then((r) => setCategories(r.categories))
      .catch(() => setCategories([]));
  }, []);

  const load = useCallback(
    async (next: string) => {
      shown.current = next;
      setError(null);
      try {
        const result = await api.communityPosts({ category: next || undefined });
        if (shown.current !== next) return;
        setPosts(result.posts);
        setCursor(result.next_cursor ?? null);
        if (!next) onSeen(result.posts[0]?.created_at ?? null);
      } catch (e) {
        if (shown.current !== next) return;
        setPosts(null);
        setCursor(null);
        setError(boardFailure(e));
      }
    },
    [onSeen],
  );

  // 글을 쓰거나 지우고 돌아오면 첫 쪽을 다시 받는다. 받는 동안에는 보던 목록을 그대로 둔다.
  useFocusEffect(
    useCallback(() => {
      void load(shown.current);
    }, [load]),
  );

  const pickCategory = (slug: string) => {
    if (slug === category) return;
    setCategory(slug);
    setPosts(null);
    setCursor(null);
    void logEvent('community_category', { category: slug || 'all' });
    void load(slug);
  };

  const refresh = async () => {
    setRefreshing(true);
    await load(category);
    setRefreshing(false);
  };

  const loadMore = async () => {
    if (!cursor || loadingMore || error !== null) return;
    const asked = category;
    setLoadingMore(true);
    try {
      const result = await api.communityPosts({ category: asked || undefined, cursor });
      if (shown.current !== asked) return;
      setPosts((prev) => {
        const have = new Set((prev ?? []).map((p) => p.id));
        return [...(prev ?? []), ...result.posts.filter((p) => !have.has(p.id))];
      });
      setCursor(result.next_cursor ?? null);
    } catch {
      // 이어 받기 실패는 끝에서 다시 당기면 다시 시도한다.
    } finally {
      setLoadingMore(false);
    }
  };

  const openPost = (post: CommunityPost) => {
    router.push({ pathname: '/community-post', params: { id: post.id } });
  };

  const showRules = () => {
    void logEvent('community_rules_open');
    void alert({ title: t('community.rulesTitle'), message: t('community.rulesBody'), confirmLabel: t('common.confirm') });
  };

  const header = (
    <View style={styles.head}>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {categoryChips(categories).map((c) => (
          <Chip
            key={c.slug || 'all'}
            label={c.name}
            role="radio"
            selected={category === c.slug}
            phLabel={`community_category_${c.slug || 'all'}`}
            onPress={() => pickCategory(c.slug)}
          />
        ))}
      </ScrollView>
      <AdSlot slot="community_list_top" />
      <Pressable
        style={({ pressed }) => [styles.notice, pressed && styles.pressed]}
        onPress={showRules}
        accessibilityRole="button"
        accessibilityLabel={t('community.rulesTitle')}
        ph-label="community_rules">
        <Text style={styles.noticeBadge}>{t('community.noticeBadge')}</Text>
        <Text style={styles.noticeText} numberOfLines={1}>
          {t('community.rulesTitle')}
        </Text>
        <Feather name="chevron-right" size={20} color={palette.iconFaint} />
      </Pressable>
      {error === 'other' ? <InlineError message={boardFailureMessage(error)} onRetry={() => void load(category)} /> : null}
      {error && error !== 'other' ? <InlineErrorLine message={boardFailureMessage(error)} /> : null}
      {posts === null && !error ? <BoardSkeleton /> : null}
      {posts !== null && posts.length === 0 ? (
        <View style={styles.empty}>
          <InlineEmpty title={t('community.empty')} />
          <Pressable
            style={({ pressed }) => [styles.softBtn, pressed && styles.pressed]}
            onPress={onWrite}
            accessibilityRole="button"
            accessibilityLabel={t('community.firstPost')}
            ph-label="community_empty_write">
            <Feather name="plus" size={16} color={palette.blueDeep} />
            <Text style={styles.softText}>{t('community.firstPost')}</Text>
          </Pressable>
        </View>
      ) : null}
    </View>
  );

  return (
    <>
      <FlatList
        data={posts ?? []}
        keyExtractor={(p) => p.id}
        ListHeaderComponent={header}
        renderItem={({ item, index }) => <PostRow post={item} first={index === 0} onPress={() => openPost(item)} />}
        ListFooterComponent={
          loadingMore ? (
            <View style={styles.more}>
              <LoadingText label={t('loadingText.loading')} />
            </View>
          ) : null
        }
        onEndReached={() => void loadMore()}
        onEndReachedThreshold={0.4}
        refreshControl={<RefreshControl refreshing={refreshing} onRefresh={() => void refresh()} tintColor={palette.iconFaint} />}
        contentContainerStyle={[styles.list, { paddingBottom: bottomSpace + space[5] }]}
      />
      {dialog}
    </>
  );
}

export function PostRow({ post, first, onPress }: { post: CommunityPost; first?: boolean; onPress: () => void }) {
  const thumb = listThumb(post);
  return (
    <Pressable
      style={({ pressed }) => [styles.row, !first && styles.rowDivider, pressed && styles.pressed]}
      onPress={onPress}
      accessibilityRole="button"
      ph-label="community_post_row">
      <View style={styles.rowText}>
        <Text style={styles.category}>{post.category_name}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {post.title}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {bodyPreview(post.body)}
        </Text>
        <View style={styles.meta}>
          <Text style={styles.metaText} numberOfLines={1}>
            {metaLine(post)}
          </Text>
          <View style={styles.count}>
            <Feather name="message-circle" size={14} color={palette.iconFaint} />
            <Text style={styles.metaText} accessibilityLabel={t('community.commentCountA11y', { count: post.comment_count })}>
              {post.comment_count}
            </Text>
          </View>
        </View>
      </View>
      {thumb ? (
        <View style={styles.thumb}>
          <Image source={{ uri: thumb.url }} style={styles.thumbImage} contentFit="cover" testID="post-row-thumb" />
          {thumb.count > 1 ? (
            <Text style={styles.thumbCount} accessibilityLabel={t('community.imageCountA11y', { count: thumb.count })}>
              {thumb.count}
            </Text>
          ) : null}
        </View>
      ) : null}
    </Pressable>
  );
}

/** 글 행 자리 뼈대 — 분류·제목·미리보기·메타 네 줄. */
function BoardSkeleton() {
  return (
    <SkeletonGroup style={styles.skeleton}>
      {[0, 1, 2, 3].map((i) => (
        <View key={i} style={[styles.skeletonRow, i > 0 && styles.rowDivider]}>
          <SkeletonLine size={type.micro} width={48} />
          <SkeletonLine size={type.body1Bold} width="72%" />
          <SkeletonLine size={type.body2} width="88%" />
          <SkeletonBlock width={120} height={14} radius={radius.xs} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  list: { paddingHorizontal: space.gutter, paddingTop: space[4] },
  head: { gap: space[4] },
  chipScroll: { marginHorizontal: -space.gutter, flexGrow: 0 },
  chips: { gap: space[2], paddingHorizontal: space.gutter },
  pressed: { opacity: 0.7 },
  notice: {
    height: 56,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingLeft: space[4],
    paddingRight: space[3],
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: palette.border,
    backgroundColor: palette.bg,
  },
  noticeBadge: {
    ...type.micro,
    color: palette.blueDeep,
    backgroundColor: palette.blueSoft,
    borderRadius: radius.xs,
    overflow: 'hidden',
    paddingHorizontal: space[1.5],
    paddingVertical: 2,
  },
  noticeText: { ...type.body2, flex: 1, color: palette.text },
  empty: { gap: space[3] },
  softBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: space[1.5],
    backgroundColor: palette.blueSoft,
    borderRadius: radius.md,
    paddingVertical: space[3],
  },
  softText: { ...type.body2Bold, color: palette.blueDeep },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[4] },
  rowText: { flex: 1, minWidth: 0, gap: space[1] },
  thumb: { width: 64, height: 64 },
  thumbImage: { width: 64, height: 64, borderRadius: radius.sm, backgroundColor: palette.bgSoft },
  thumbCount: {
    ...type.micro,
    position: 'absolute',
    right: space[1],
    bottom: space[1],
    minWidth: 20,
    textAlign: 'center',
    color: palette.onAccent,
    backgroundColor: palette.toast,
    borderRadius: radius.full,
    overflow: 'hidden',
    paddingHorizontal: space[1.5],
  },
  rowDivider: { borderTopWidth: 1, borderTopColor: palette.border },
  category: { ...type.micro, color: palette.blueDeep },
  title: { ...type.body1Bold, color: palette.text },
  preview: { ...type.body2, color: palette.textSub },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  metaText: { ...type.caption, color: palette.textMeta, flexShrink: 1 },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  more: { alignItems: 'center', paddingVertical: space[3] },
  skeleton: { gap: 0 },
  skeletonRow: { paddingVertical: space[4], gap: space[2] },
});
