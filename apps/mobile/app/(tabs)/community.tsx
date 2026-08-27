import Feather from '@expo/vector-icons/Feather';
import { useFocusEffect, useRouter } from 'expo-router';
import { useCallback, useMemo, useState } from 'react';
import {
  ActivityIndicator,
  Pressable,
  RefreshControl,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import {
  authorName,
  bodyPreview,
  categoryChips,
  relativeTime,
  type CommunityCategory,
  type CommunityPost,
} from '@/lib/community';
import { translate as t } from '@/lib/i18n';

/** A4. 게시판 — 카테고리 칩 + 글 목록. 로그인 없이도 읽을 수 있다. */
export default function CommunityScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const [posts, setPosts] = useState<CommunityPost[]>([]);
  const [categories, setCategories] = useState<CommunityCategory[]>([]);
  const [selected, setSelected] = useState('');
  const [loading, setLoading] = useState(true);
  const [refreshing, setRefreshing] = useState(false);
  const [error, setError] = useState<string | null>(null);
  // 상대 시각은 렌더 후에 채운다. 목록을 그리는 시점마다 now가 달라지면 흔들린다.
  const [now, setNow] = useState<number | null>(null);

  const load = useCallback(
    async (category: string) => {
      try {
        const [list, cats] = await Promise.all([
          api.communityPosts(category ? { category } : {}),
          categories.length ? Promise.resolve({ categories }) : api.communityCategories(),
        ]);
        setPosts(list.posts);
        setCategories(cats.categories);
        setNow(Date.now());
        setError(null);
      } catch {
        setError(t('community.loadFail'));
      } finally {
        setLoading(false);
        setRefreshing(false);
      }
    },
    [categories],
  );

  useFocusEffect(
    useCallback(() => {
      void load(selected);
    }, [load, selected]),
  );

  const chips = useMemo(() => categoryChips(categories), [categories]);

  return (
    <SafeAreaView style={styles.safe} edges={['top']}>
      <View style={styles.header}>
        <View style={styles.flex}>
          <Text style={styles.title}>{t('community.title')}</Text>
          <Text style={styles.sub}>{t('community.sub')}</Text>
        </View>
        <Pressable
          style={styles.writeBtn}
          accessibilityRole="button"
          accessibilityLabel={t('community.write')}
          onPress={() => router.push(user ? '/community-new' : '/login')}>
          <Feather name="edit-3" size={16} color="#FFFFFF" />
          <Text style={styles.writeLabel}>{t('community.write')}</Text>
        </Pressable>
      </View>

      <ScrollView
        horizontal
        showsHorizontalScrollIndicator={false}
        style={styles.chipRow}
        contentContainerStyle={styles.chipRowInner}>
        {chips.map((chip) => {
          const active = chip.slug === selected;
          return (
            <Pressable
              key={chip.slug || 'all'}
              onPress={() => {
                setSelected(chip.slug);
                setLoading(true);
              }}
              style={[styles.chip, active && styles.chipActive]}>
              <Text style={[styles.chipText, active && styles.chipTextActive]}>{chip.name}</Text>
            </Pressable>
          );
        })}
      </ScrollView>

      {loading ? (
        <View style={styles.center}>
          <ActivityIndicator color={palette.blue} />
        </View>
      ) : (
        <ScrollView
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={() => {
                setRefreshing(true);
                void load(selected);
              }}
              tintColor={palette.blue}
            />
          }>
          {error && <Text style={styles.error}>{error}</Text>}
          {!error && posts.length === 0 && (
            <View style={styles.empty}>
              <Feather name="message-square" size={28} color={palette.checkOff} />
              <Text style={styles.emptyText}>{t('community.empty')}</Text>
            </View>
          )}
          {posts.map((post) => (
            <Pressable
              key={post.id}
              style={styles.card}
              onPress={() => router.push({ pathname: '/community-post', params: { id: post.id } })}>
              <Text style={styles.category}>{post.category_name}</Text>
              <Text style={styles.postTitle} numberOfLines={2}>
                {post.title}
              </Text>
              {post.body.trim().length > 0 && (
                <Text style={styles.body} numberOfLines={2}>
                  {bodyPreview(post.body)}
                </Text>
              )}
              <View style={styles.metaRow}>
                <Text style={styles.meta}>{authorName(post.author, post.anonymous)}</Text>
                <Text style={styles.metaDot}>·</Text>
                <Text style={styles.meta}>{relativeTime(post.created_at, now)}</Text>
                <View style={styles.flex} />
                <Feather name="heart" size={13} color={palette.textFaint} />
                <Text style={styles.count}>{post.like_count}</Text>
                <Feather
                  name="message-circle"
                  size={13}
                  color={palette.textFaint}
                  style={styles.countIcon}
                />
                <Text style={styles.count}>{post.comment_count}</Text>
              </View>
            </Pressable>
          ))}
          <View style={styles.tabSpacer} />
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bgSoft },
  flex: { flex: 1 },
  header: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingHorizontal: 20,
    paddingTop: 8,
    paddingBottom: 12,
  },
  title: { fontSize: 24, fontWeight: '800', color: palette.text, letterSpacing: -0.5 },
  sub: { marginTop: 2, fontSize: 13, fontWeight: '600', color: palette.textDim },
  writeBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    paddingHorizontal: 14,
    height: 38,
    borderRadius: 19,
    backgroundColor: palette.blue,
  },
  writeLabel: { fontSize: 13, fontWeight: '700', color: '#FFFFFF' },
  chipRow: { flexGrow: 0 },
  chipRowInner: { paddingHorizontal: 20, gap: 8, paddingBottom: 12 },
  chip: {
    paddingHorizontal: 14,
    height: 34,
    borderRadius: 17,
    backgroundColor: palette.card,
    justifyContent: 'center',
    borderWidth: 1,
    borderColor: palette.border,
  },
  chipActive: { backgroundColor: palette.navy, borderColor: palette.navy },
  chipText: { fontSize: 13, fontWeight: '700', color: palette.textDim },
  chipTextActive: { color: '#FFFFFF' },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  list: { paddingHorizontal: 20, gap: 10 },
  card: {
    backgroundColor: palette.card,
    borderRadius: 18,
    padding: 16,
    borderWidth: 1,
    borderColor: palette.border,
  },
  category: { fontSize: 11, fontWeight: '800', color: palette.blue },
  postTitle: {
    marginTop: 6,
    fontSize: 16,
    fontWeight: '700',
    color: palette.text,
    lineHeight: 22,
  },
  body: { marginTop: 6, fontSize: 13, fontWeight: '500', color: palette.textDim, lineHeight: 19 },
  metaRow: { marginTop: 12, flexDirection: 'row', alignItems: 'center', gap: 4 },
  meta: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  metaDot: { fontSize: 12, color: palette.textFaint },
  count: { marginLeft: 3, fontSize: 12, fontWeight: '700', color: palette.textFaint },
  countIcon: { marginLeft: 10 },
  empty: { alignItems: 'center', paddingVertical: 60, gap: 10 },
  emptyText: {
    fontSize: 14,
    fontWeight: '600',
    color: palette.textFaint,
    textAlign: 'center',
    lineHeight: 21,
  },
  error: { paddingVertical: 40, textAlign: 'center', color: palette.danger, fontWeight: '600' },
  // 플로팅 탭바에 마지막 카드가 가리지 않게 띄운다.
  tabSpacer: { height: 110 },
});
