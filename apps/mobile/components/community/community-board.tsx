import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { Image } from 'expo-image';
import { useCallback, useEffect, useRef, useState } from 'react';
import { FlatList, Pressable, RefreshControl, ScrollView, StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog } from '@/components/app-dialog';
import { Button } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { DefaultAvatar } from '@/components/ui/default-avatar';
import { FloatingAdd } from '@/components/ui/floating-add';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { LoadingText } from '@/components/ui/loading-text';
import { MASCOT } from '@/components/ui/mascot';
import { SkeletonBlock, SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarSeed,
  boardFailure,
  boardFailureMessage,
  bodyPreview,
  categoryChips,
  categoryLabel,
  fallbackCategories,
  listThumb,
  metaLine,
  type BoardFailure,
  type CommunityCategory,
  type CommunityPost,
} from '@/lib/community';
import { seedCommunityPost } from '@/lib/community-post-seed';
import { translate as t } from '@/lib/i18n';

/**
 * 커뮤니티 · 게시판(pen community.board, 11/2 재디자인) — 공지 한 줄 → 분류 칩(sm) → 글 목록, 광고는 탭바 바로 위에 좌우 끝까지
 * 붙인 고정 배너(community_list_top, AdMob 적응형)다. 탭바 안 위 여백(안드 8)과 위 구분선이 광고와 탭 버튼을 떼어 놓는다. 광고가 없으면(Pro·NONE) 그 자리도 사라진다.
 * 목록 행은 분류 배지 · 제목 · 미리보기 · 기본 얼굴 + `이름 · 시간` · 댓글 수만 둔다(좋아요 수는 글 상세에만). 사진이 있으면 오른쪽에
 * 첫 장 64 썸네일, 2장 이상이면 썸네일 오른쪽 아래에 장수 배지. 게스트(403 member_only)·탈퇴 계정은 챌린지 목록처럼 다시 시도 없이
 * 한 줄로 알린다. 네 상태: 불러오는 중 Skeleton 행, 비었음 액티 96 + title2 + 「첫 글 쓰기」, 실패 InlineError, 채움.
 * 당겨서 새로고침, 끝에서 이어 받기.
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
    logEvent('community_board_open');
    void api
      .communityCategories()
      .then((r) => setCategories(r.categories))
      // 못 받으면 앱이 아는 기본 분류로 칩을 그린다(오프라인에서 「전체」만 남던 것, 11/2 폰 QA).
      .catch(() => setCategories(fallbackCategories()));
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
    logEvent('community_category', { category: slug || 'all' });
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
    seedCommunityPost(post);
    router.push({ pathname: '/community-post', params: { id: post.id } });
  };

  const showRules = () => {
    logEvent('community_rules_open');
    void alert({ title: t('community.rulesTitle'), message: t('community.rulesBody'), confirmLabel: t('common.confirm') });
  };

  const header = (
    <View style={styles.head}>
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
        <Feather name="chevron-right" size={16} color={palette.iconFaint} />
      </Pressable>
      <ScrollView horizontal showsHorizontalScrollIndicator={false} contentContainerStyle={styles.chips} style={styles.chipScroll}>
        {categoryChips(categories).map((c) => (
          <Chip
            key={c.slug || 'all'}
            label={c.name}
            size="sm"
            role="radio"
            selected={category === c.slug}
            phLabel={`community_category_${c.slug || 'all'}`}
            onPress={() => pickCategory(c.slug)}
          />
        ))}
      </ScrollView>
      {error === 'other' ? <InlineError message={boardFailureMessage(error)} onRetry={() => void load(category)} /> : null}
      {error && error !== 'other' ? <InlineEmpty title={boardFailureMessage(error)} /> : null}
      {posts === null && !error ? <BoardSkeleton /> : null}
      {posts !== null && posts.length === 0 ? (
        <View style={styles.empty}>
          <Image source={MASCOT.shy} style={styles.emptyMascot} contentFit="contain" cachePolicy="memory-disk" />
          <Text style={styles.emptyTitle}>{t('community.empty')}</Text>
          <Button
            size="md"
            label={t('community.firstPost')}
            icon={<Feather name="plus" size={16} color={palette.onAccent} />}
            phLabel="community_empty_write"
            onPress={onWrite}
          />
        </View>
      ) : null}
    </View>
  );

  return (
    <View style={styles.wrap}>
      <View style={styles.wrap}>
      <FlatList
        style={styles.wrap}
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
        contentContainerStyle={styles.list}
      />
      <FloatingAdd label={t('community.write')} bottom={space[3]} phLabel="community_write" onPress={onWrite} />
      </View>
      {/* 광고는 탭바 바로 위에 좌우 끝까지 붙인 고정 배너 — 칸이 비면 위 구분선까지 사라져 목록이 탭바 위까지 내려온다. */}
      <View style={{ marginBottom: Math.max(bottomSpace - space[3], 0) }}>
        <AdSlot slot="community_list_top" anchored style={styles.adBanner} />
      </View>
      {dialog}
    </View>
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
        <Text style={styles.category}>{categoryLabel(post.category_slug, post.category_name)}</Text>
        <Text style={styles.title} numberOfLines={1}>
          {post.title}
        </Text>
        <Text style={styles.preview} numberOfLines={1}>
          {bodyPreview(post.body)}
        </Text>
        <View style={styles.meta}>
          <DefaultAvatar size={18} radius={9} seed={avatarSeed(post)} />
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
          <SkeletonBlock width={44} height={20} radius={radius.xs} />
          <SkeletonLine size={type.body1Bold} width="72%" />
          <SkeletonLine size={type.body2} width="88%" />
          <View style={styles.meta}>
            <SkeletonBlock width={18} height={18} radius={9} />
            <SkeletonBlock width={120} height={14} radius={radius.xs} />
          </View>
        </View>
      ))}
    </SkeletonGroup>
  );
}

const styles = StyleSheet.create({
  wrap: { flex: 1 },
  list: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: 48 + space[6] },
  head: { gap: space[3] },
  chipScroll: { marginHorizontal: -space.gutter, flexGrow: 0 },
  chips: { gap: space[2], paddingHorizontal: space.gutter },
  pressed: { opacity: 0.7 },
  notice: {
    height: 44,
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[2],
    paddingHorizontal: space[3],
    borderRadius: radius.md,
    backgroundColor: palette.bgSoft,
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
  empty: { alignItems: 'center', gap: space[3], paddingTop: space[8], paddingBottom: space[6] },
  emptyMascot: { width: 96, height: 96 },
  emptyTitle: { ...type.title2, color: palette.text, textAlign: 'center' },
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
  category: {
    ...type.micro,
    alignSelf: 'flex-start',
    color: palette.textSub,
    backgroundColor: palette.bgSoft,
    borderRadius: radius.xs,
    overflow: 'hidden',
    paddingHorizontal: space[1.5],
    paddingVertical: 2,
    marginBottom: space[1],
  },
  title: { ...type.body1Bold, color: palette.text },
  preview: { ...type.body2, color: palette.textSub },
  meta: { flexDirection: 'row', alignItems: 'center', gap: space[1.5], marginTop: space[1] },
  metaText: { ...type.caption, color: palette.textMeta, flexShrink: 1 },
  count: { flexDirection: 'row', alignItems: 'center', gap: space[1], marginLeft: space[1.5] },
  more: { alignItems: 'center', paddingVertical: space[3] },
  adBanner: { borderTopWidth: 1, borderTopColor: palette.border },
  skeleton: { gap: 0 },
  skeletonRow: { paddingVertical: space[4], gap: space[2] },
});
