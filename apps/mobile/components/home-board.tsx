import Animated, { FadeInDown, useReducedMotion } from 'react-native-reanimated';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { TextButton } from '@/components/ui/buttons';
import { InlineError } from '@/components/ui/inline-error';
import { SkeletonGroup, SkeletonLine } from '@/components/ui/skeleton';
import { motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { bodyPreview, boardFailureMessage, categoryLabel, relativeTime, type BoardFailure, type CommunityPost } from '@/lib/community';
import { HOME_BOARD_CATEGORIES, latestByCategory, popularPosts } from '@/lib/home-board';
import { translate as t } from '@/lib/i18n';

/** 홈이 받은 게시판 첫 쪽. null 은 처음 받는 중이다. 다시 받는 동안에는 보던 값을 그대로 둔다. */
export type HomeBoardState = null | { posts: CommunityPost[] } | { failure: BoardFailure };

export type HomeBoardFrom = 'latest' | 'popular' | 'more';

/**
 * 홈 「게시판」·「인기 글」(에브리타임처럼 커뮤니티가 보이는 홈). 같은 응답 하나로 두 구역을 그린다(lib/home-board).
 * - 게시판: 자유·질문·홍보 칸마다 최신 글 한 줄(칸 이름 · 제목 한 줄 · 지난 시간). 글 없는 칸은 줄째 빼고, 셋 다 없으면 첫 글 권유.
 * - 인기 글: 최근 14일 좋아요+댓글 많은 순 둘. 없으면 구역째 숨긴다.
 * 게스트(403 member_only)·탈퇴 계정은 두 구역 대신 한 줄로 알리고, 그 밖의 실패는 게시판 구역에 다시 시도와 함께 둔다.
 * 줄은 커뮤니티 목록(PostRow)처럼 상자 없이 위 구분선으로 나눈다.
 */
export function HomeBoard({
  board,
  onOpen,
  onMore,
  onWrite,
  onRetry,
}: {
  board: HomeBoardState;
  onOpen: (post: CommunityPost, from: Exclude<HomeBoardFrom, 'more'>) => void;
  onMore: () => void;
  onWrite: () => void;
  onRetry: () => void;
}) {
  const reduceMotion = useReducedMotion();
  const entering = reduceMotion ? undefined : FadeInDown.duration(motion.standard);

  const head = (title: string, more: boolean) => (
    <View style={styles.head}>
      <Text style={styles.headTitle} accessibilityRole="header">
        {title}
      </Text>
      {more ? (
        <Pressable onPress={onMore} hitSlop={8} accessibilityRole="link" accessibilityLabel={t('home.boardMoreA11y', { title })} ph-label="home_board_more">
          <Text style={styles.headMore}>{t('home.boardMore')}</Text>
        </Pressable>
      ) : null}
    </View>
  );

  if (board && 'failure' in board && board.failure !== 'other') {
    // 게시판은 회원 전용이다 — 게스트에게는 두 구역 대신 한 줄만 둔다.
    return (
      <View style={styles.block}>
        {head(t('home.boardTitle'), false)}
        <Text style={styles.note}>{board.failure === 'member_only' ? t('home.boardMemberOnly') : boardFailureMessage(board.failure)}</Text>
      </View>
    );
  }

  if (board === null) {
    return (
      <View style={styles.block}>
        {head(t('home.boardTitle'), true)}
        <BoardRowsSkeleton />
      </View>
    );
  }

  if ('failure' in board) {
    return (
      <View style={styles.block}>
        {head(t('home.boardTitle'), true)}
        <InlineError message={t('home.boardLoadFail')} onRetry={onRetry} />
      </View>
    );
  }

  const latest = latestByCategory(board.posts);
  const popular = popularPosts(board.posts);

  return (
    <>
      <View style={styles.block}>
        {head(t('home.boardTitle'), true)}
        {latest.length === 0 ? (
          <View style={styles.emptyRow}>
            <Text style={styles.note}>{t('home.boardEmpty')}</Text>
            <TextButton label={t('home.boardEmptyWrite')} tone="accent" phLabel="home_board_empty_write" onPress={onWrite} />
          </View>
        ) : (
          <View>
            {latest.map((post, i) => (
              <Animated.View key={post.id} entering={entering}>
                <Pressable
                  onPress={() => onOpen(post, 'latest')}
                  accessibilityRole="button"
                  accessibilityLabel={`${categoryLabel(post.category_slug, post.category_name)} · ${post.title}`}
                  ph-label="home_board_latest"
                  style={({ pressed }) => [styles.latestRow, i > 0 && styles.divider, pressed && styles.pressed]}>
                  <Text style={styles.category}>{categoryLabel(post.category_slug, post.category_name)}</Text>
                  <Text style={styles.latestTitle} numberOfLines={1}>
                    {post.title}
                  </Text>
                  <Text style={styles.time}>{relativeTime(post.created_at)}</Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        )}
      </View>

      {popular.length > 0 ? (
        <View style={styles.block}>
          {head(t('home.popularTitle'), true)}
          <View>
            {popular.map((post, i) => (
              <Animated.View key={post.id} entering={entering}>
                <Pressable
                  onPress={() => onOpen(post, 'popular')}
                  accessibilityRole="button"
                  ph-label="home_board_popular"
                  style={({ pressed }) => [styles.popularRow, i > 0 && styles.divider, pressed && styles.pressed]}>
                  <Text style={styles.popularTitle} numberOfLines={1}>
                    {post.title}
                  </Text>
                  <Text style={styles.preview} numberOfLines={1}>
                    {bodyPreview(post.body)}
                  </Text>
                  <Text style={styles.meta} numberOfLines={1}>
                    {t('home.popularMeta', {
                      category: categoryLabel(post.category_slug, post.category_name),
                      likes: post.like_count,
                      comments: post.comment_count,
                    })}
                  </Text>
                </Pressable>
              </Animated.View>
            ))}
          </View>
        </View>
      ) : null}
    </>
  );
}

/** 칸마다 한 줄인 게시판 줄 자리 — 칸 이름과 제목만 회색. */
function BoardRowsSkeleton() {
  return (
    <SkeletonGroup>
      {HOME_BOARD_CATEGORIES.map((slug, i) => (
        <View key={slug} style={[styles.latestRow, i > 0 && styles.divider]} testID="home-board-skeleton">
          <SkeletonLine size={type.captionBold} width={28} />
          <SkeletonLine size={type.body2} width={i % 2 === 0 ? '62%' : '48%'} style={styles.flex} />
        </View>
      ))}
    </SkeletonGroup>
  );
}

/** 홈 뼈대 화면(데이터를 받기 전)의 게시판 구역 — 실제 구역과 같은 머리에 줄만 회색이다. */
export function HomeBoardSkeleton() {
  return (
    <View style={styles.block}>
      <View style={styles.head}>
        <Text style={styles.headTitle}>{t('home.boardTitle')}</Text>
        <Text style={styles.headMore}>{t('home.boardMore')}</Text>
      </View>
      <BoardRowsSkeleton />
    </View>
  );
}

const styles = StyleSheet.create({
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  block: { gap: space[1] },
  // 홈의 다른 구역 머리(이것도·마감 임박)와 같은 모양.
  head: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingTop: space[2], paddingBottom: space[1] },
  headTitle: { ...type.headline, color: palette.text },
  headMore: { ...type.body2Bold, color: palette.blueDeep },
  divider: { borderTopWidth: 1, borderTopColor: palette.border },
  latestRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  category: { ...type.captionBold, color: palette.blueDeep },
  latestTitle: { ...type.body2, color: palette.text, flex: 1, minWidth: 0 },
  time: { ...type.caption, color: palette.textMeta },
  popularRow: { gap: space[1], paddingVertical: space[3] },
  popularTitle: { ...type.body1Bold, color: palette.text },
  preview: { ...type.body2, color: palette.textSub },
  meta: { ...type.caption, color: palette.textMeta },
  emptyRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: space[3] },
  note: { ...type.body2, color: palette.textSub, flexShrink: 1 },
});
