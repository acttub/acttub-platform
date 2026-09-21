import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import {
  avatarLetter,
  browseFailure,
  browseFailureMessage,
  canDelete,
  dDayLabel,
  firstBadgeLabel,
  hostLabel,
  isEnded,
  moderationNotice,
  rankEntries,
  rankingNotice,
  ranksHidden,
  type RankedEntry,
} from '@/lib/challenge/browse';
import type { ChallengeDetail, EntrySort } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';

type Ranked = RankedEntry;

/**
 * A17 대사 상세·랭킹(challenge.browse).
 *
 * 좋아요순은 공동 순위이고(좋아요가 같으면 같은 순위, 그 안에서는 최초 공개 시각·id 순),
 * 최신순은 순위 숫자 없이 가장 최근 하나에만 NEW 를 붙인다. 좋아요가 모두 0이면 1위 배지가
 * 없다. 종료된 챌린지는 굳은 값을 보여 주고 확정 전에는 "집계 중"이다. 좋아요 랭킹은 반응 수를
 * 세운 순서이지 연기 점수가 아니다(ADR-005 개정).
 */
export default function ChallengeDetailScreen() {
  const router = useRouter();
  const { alert, confirm, dialog } = useAppDialog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [sort, setSort] = useState<EntrySort>('likes');
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [entries, setEntries] = useState<Ranked[] | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(
    async (nextSort: EntrySort) => {
      if (!id) return;
      setError(null);
      try {
        const [detail, list] = await Promise.all([
          api.getChallenge(id),
          api.listChallengeEntries(id, { sort: nextSort }),
        ]);
        setChallenge(detail);
        setEntries(rankEntries(list.entries, nextSort));
      } catch (e) {
        const failure = browseFailure(e);
        setEntries([]);
        setError(browseFailureMessage(failure));
        // 정렬 기준이 바뀌어 커서가 만료되면 처음부터 다시 읽는다.
        if (failure.kind === 'cursor_expired') void api.listChallengeEntries(id, { sort: nextSort }).then((list) => {
          setEntries(rankEntries(list.entries, nextSort));
          setError(null);
        }).catch(() => undefined);
      }
    },
    [id],
  );

  useEffect(() => {
    void load(sort);
  }, [load, sort]);

  /** 참여작이 없는 자기 챌린지만 지운다. 지우면 목록·상세에서 사라진다(행은 남는다). */
  const remove = async () => {
    if (!challenge) return;
    const ok = await confirm({
      title: t('challenges.deleteTitle'),
      message: t('challenges.deleteBody'),
      confirmLabel: t('challenges.deleteConfirm'),
      destructive: true,
    });
    if (!ok) return;
    try {
      await api.deleteChallenge(challenge.id);
      logEvent('challenge_deleted', { id: challenge.id });
      router.back();
    } catch (e) {
      const failure = browseFailure(e);
      void alert({
        title: t('challenges.deleteTitle'),
        message: failure.kind === 'other' ? t('challenges.deleteHasEntries') : browseFailureMessage(failure),
      });
    }
  };

  const share = () => {
    if (!challenge) return;
    logEvent('challenge_share', { id: challenge.id });
    void Share.share({ message: t('profileTab.shareText', { name: challenge.work, line: challenge.line }) }).catch(() => {});
  };

  const perform = () => {
    if (!challenge) return;
    logEvent('challenge_perform_tap', { id: challenge.id });
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };

  const ended = challenge ? isEnded(challenge) : false;
  const hideRanks = challenge ? ranksHidden(challenge) : false;
  const notice = challenge ? rankingNotice(challenge) : null;
  const moderation = challenge ? moderationNotice(challenge) : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          headerShown: true,
          title: t('challenges.detailTitle'),
          headerRight: () => (
            <View style={styles.headerRight}>
              {challenge && canDelete(challenge) && (
                <Pressable onPress={() => void remove()} accessibilityRole="button" hitSlop={8}>
                  <Feather name="trash-2" size={19} color={palette.textDim} />
                </Pressable>
              )}
              <Pressable onPress={share} accessibilityRole="button" hitSlop={8}>
                <Feather name="share-2" size={20} color={palette.textDim} />
              </Pressable>
            </View>
          ),
        }}
      />
      <ScrollView contentContainerStyle={styles.content}>
        {!challenge && !error && <ActivityIndicator color={palette.blue} style={{ marginTop: 40 }} />}
        {error && <Text style={styles.error}>{error}</Text>}

        {challenge && (
          <>
            <View style={styles.lineCard}>
              <Text style={styles.line}>“{challenge.line}”</Text>
              <Text style={styles.work}>
                {[challenge.work, challenge.character].filter(Boolean).join(' · ')}
              </Text>
              {!!challenge.scene_note && <Text style={styles.note}>{challenge.scene_note}</Text>}
              <Text style={styles.host}>{hostLabel(challenge)}</Text>
              <Text style={styles.stat}>
                {t('challenges.entryCount', { count: challenge.entry_count })} ·{' '}
                {t('challenges.likeSum', { count: challenge.like_sum })} · {dDayLabel(challenge)}
              </Text>
              {!ended && (
                <Pressable style={styles.performBtn} onPress={perform} accessibilityRole="button">
                  <Feather name="video" size={15} color="#FFFFFF" />
                  <Text style={styles.performText}>{t('challenges.performCta2')}</Text>
                </Pressable>
              )}
            </View>

            {!!moderation && <Text style={styles.notice}>{moderation}</Text>}
            {!!notice && <Text style={styles.notice}>{notice}</Text>}

            <View style={styles.tabRow}>
              {(
                [
                  ['likes', 'challenges.tabLikes'],
                  ['latest', 'challenges.tabRecent'],
                ] as const
              ).map(([key, label]) => (
                <Pressable
                  key={key}
                  style={styles.tab}
                  onPress={() => {
                    setSort(key);
                    setEntries(null);
                  }}
                  accessibilityRole="button"
                  accessibilityState={{ selected: sort === key }}>
                  <Text style={[styles.tabText, sort === key && styles.tabTextOn]}>{t(label)}</Text>
                  {sort === key && <View style={styles.tabUnderline} />}
                </Pressable>
              ))}
            </View>

            {entries === null && <ActivityIndicator color={palette.blue} style={{ marginTop: 24 }} />}
            {entries?.map((entry) => (
              <Pressable
                key={entry.id}
                style={styles.entry}
                onPress={() =>
                  router.push({ pathname: '/challenge-play', params: { id: challenge.id, entryId: entry.id } })
                }
                accessibilityRole="button">
                <View style={styles.rankCell}>
                  {!hideRanks && entry.displayRank !== null ? (
                    <Text style={styles.rank}>{entry.displayRank}</Text>
                  ) : (
                    <View style={styles.avatar}>
                      <Text style={styles.avatarText}>{avatarLetter(entry.author.name)}</Text>
                    </View>
                  )}
                </View>
                <View style={styles.entryBody}>
                  <View style={styles.entryHead}>
                    <Text style={styles.author} numberOfLines={1}>
                      {entry.author.name}
                    </Text>
                    {entry.isNew && <Text style={styles.newBadge}>{t('challenges.newBadge')}</Text>}
                  </View>
                  {!!entry.caption && (
                    <Text style={styles.caption} numberOfLines={2}>
                      {entry.caption}
                    </Text>
                  )}
                  {!hideRanks && entry.showsFirstBadge && (
                    <Text style={styles.firstBadge}>{firstBadgeLabel(entry, ended)}</Text>
                  )}
                </View>
                <View style={styles.likeChip}>
                  <Feather name="heart" size={13} color={palette.textFaint} />
                  <Text style={styles.likeText}>{entry.like_count}</Text>
                </View>
              </Pressable>
            ))}

            {entries !== null && entries.length === 0 && !error && (
              <Text style={styles.empty}>{t('challenges.emptyEntries')}</Text>
            )}
          </>
        )}
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { padding: 20, paddingBottom: 60, gap: 10 },
  headerRight: { flexDirection: 'row', alignItems: 'center', gap: 16 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  lineCard: { backgroundColor: palette.navy, borderRadius: 18, padding: 18, gap: 8 },
  line: { fontSize: 19, fontWeight: '900', color: '#FFFFFF', lineHeight: 28 },
  work: { fontSize: 13, fontWeight: '600', color: '#9FB0C9' },
  note: { fontSize: 12.5, color: '#9FB0C9', lineHeight: 19 },
  host: { fontSize: 12, fontWeight: '600', color: '#8FA5FF' },
  stat: { fontSize: 12.5, fontWeight: '600', color: '#9FB0C9' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingVertical: 13,
    marginTop: 6,
  },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  notice: { fontSize: 12.5, fontWeight: '700', color: palette.amber, paddingVertical: 4 },
  tabRow: { flexDirection: 'row', gap: 18, marginTop: 8 },
  tab: { paddingBottom: 8, alignItems: 'center', gap: 8 },
  tabText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  tabTextOn: { color: palette.text },
  tabUnderline: { height: 2, width: '100%', borderRadius: 1, backgroundColor: palette.text },
  entry: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    paddingVertical: 14,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
  },
  rankCell: { width: 28, alignItems: 'center' },
  rank: { fontSize: 16, fontWeight: '900', color: palette.blue },
  avatar: { width: 26, height: 26, borderRadius: 13, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 12, fontWeight: '900', color: palette.blueDeep },
  entryBody: { flex: 1, gap: 3 },
  entryHead: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  author: { fontSize: 14.5, fontWeight: '700', color: palette.text },
  newBadge: { fontSize: 10.5, fontWeight: '900', color: palette.blue },
  caption: { fontSize: 12.5, color: palette.textFaint, lineHeight: 19 },
  firstBadge: { fontSize: 12, fontWeight: '800', color: palette.blueDeep },
  likeChip: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  likeText: { fontSize: 12, fontWeight: '700', color: palette.textFaint },
  empty: { fontSize: 14, color: palette.textDim, textAlign: 'center', paddingVertical: 40, lineHeight: 22 },
});
