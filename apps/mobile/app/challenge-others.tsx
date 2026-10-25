import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, canPerform, dDayLabel } from '@/lib/challenge/browse';
import type { ChallengeDetail, EntryCard, EntrySort } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { limitVideoBuffer, sourceWhileFocused } from '@/lib/video-memory';

/** 한 번에 그리는 칸 수 — 칸마다 플레이어가 하나라 6~9칸으로 묶고 「더 보기」로 늘린다. */
export const GRID_PAGE = 8;

/** C1.17 같은 대사, 다른 연기 — 이번 주 대사 참여작을 격자로 보여 주고, 칸을 누르면 그 참여작부터 피드로 간다. */
export default function ChallengeOthersScreen() {
  const router = useRouter();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [sort, setSort] = useState<EntrySort>('likes');
  const [entries, setEntries] = useState<EntryCard[] | null>(null);
  const [shown, setShown] = useState(GRID_PAGE);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    api.getChallenge(id).then(setChallenge).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setEntries(null);
    setError(null);
    setShown(GRID_PAGE);
    api
      .listChallengeEntries(id, { sort })
      .then((r) => alive && setEntries(r.entries.filter((e) => e.playback_url)))
      .catch((e) => {
        if (!alive) return;
        setEntries([]);
        setError(browseFailureMessage(browseFailure(e)));
      });
    return () => {
      alive = false;
    };
  }, [id, sort]);

  const perform = () => {
    if (!challenge || !canPerform(challenge)) return;
    router.push({
      pathname: '/record-video',
      params: { mode: 'challenge', challengeId: challenge.id, line: challenge.line, work: challenge.work },
    });
  };
  const open = (entry: EntryCard) => {
    void logEvent('challenge_others_open', { id: id ?? '', entry: entry.id });
    router.push({ pathname: '/challenge-play', params: { id: id ?? entry.challenge_id, entryId: entry.id } });
  };

  const visible = (entries ?? []).slice(0, shown);
  const more = (entries?.length ?? 0) > shown;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('challenges.sameLineTitle') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {challenge && (
          <>
            <Text style={styles.line}>“{challenge.line}”</Text>
            <Text style={styles.meta}>{t('challengeOthers.meta', { count: challenge.entry_count, dday: dDayLabel(challenge) })}</Text>
          </>
        )}
        <View style={styles.tabs}>
          {(
            [
              ['likes', 'challenges.tabPopular'],
              ['latest', 'challenges.tabLatest'],
            ] as const
          ).map(([key, label]) => (
            <Pressable
              key={key}
              style={[styles.pill, sort === key && styles.pillOn]}
              onPress={() => setSort(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: sort === key }}>
              <Text style={[styles.pillText, sort === key && styles.pillTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
        {entries?.length === 0 && <Text style={styles.empty}>{error ?? t('challengeOthers.empty')}</Text>}
        <View style={styles.grid}>
          {visible.map((entry) => (
            <Tile key={entry.id} entry={entry} onPress={() => open(entry)} />
          ))}
        </View>
        {more && (
          <Pressable style={styles.more} onPress={() => setShown((n) => n + GRID_PAGE)} accessibilityRole="button">
            <Text style={styles.moreText}>{t('challengeOthers.more')}</Text>
          </Pressable>
        )}
      </ScrollView>
      {challenge && canPerform(challenge) && (
        <CtaBar safeBottom={false}>
          <PrimaryButton label={t('challenges.performCta')} onPress={perform} />
        </CtaBar>
      )}
    </SafeAreaView>
  );
}

/** 재생 없이 첫 장면만 멈춰 보여 주는 칸. */
function Tile({ entry, onPress }: { entry: EntryCard; onPress: () => void }) {
  const { width } = useWindowDimensions();
  const size = (width - 48 - 12) / 2;
  const focused = useIsFocused();
  const player = useVideoPlayer(sourceWhileFocused(entry.playback_url, focused), (p) => {
    p.muted = true;
    p.loop = false;
    limitVideoBuffer(p);
    p.pause();
  });
  return (
    <Pressable
      style={[styles.tile, { width: size, height: size * 1.4 }]}
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={entry.author.name}>
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} pointerEvents="none" />
      <View style={styles.tileInfo} pointerEvents="none">
        <Text style={styles.tileName} numberOfLines={1}>
          {entry.author.name}
        </Text>
        <Text style={styles.tileName}>♡ {entry.like_count}</Text>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 24, gap: 8 },
  line: { fontSize: 22, fontWeight: '800', lineHeight: 30, color: palette.text },
  meta: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: palette.textFaint },
  tabs: { flexDirection: 'row', gap: 8, marginVertical: 8 },
  pill: { paddingHorizontal: 14, height: 34, borderRadius: 17, backgroundColor: '#F1F2F4', alignItems: 'center', justifyContent: 'center' },
  pillOn: { backgroundColor: palette.text },
  pillText: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  pillTextOn: { color: '#fff' },
  empty: { fontSize: 14, color: palette.textFaint, textAlign: 'center', marginTop: 40 },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: 12 },
  tile: { borderRadius: 16, overflow: 'hidden', backgroundColor: '#222', justifyContent: 'flex-end' },
  tileInfo: { flexDirection: 'row', justifyContent: 'space-between', padding: 10, backgroundColor: 'rgba(0,0,0,0.25)' },
  tileName: { color: '#fff', fontSize: 13, fontWeight: '700' },
  more: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: 8 },
  moreText: { fontSize: 14, fontWeight: '700', color: palette.blue },
});
