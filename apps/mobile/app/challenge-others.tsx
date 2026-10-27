import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Feather from '@expo/vector-icons/Feather';

import { PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineError } from '@/components/ui/inline-error';
import { SkeletonCards } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { canPerform, dDayLabel } from '@/lib/challenge/browse';
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
  const [failed, setFailed] = useState(false);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    api.getChallenge(id).then(setChallenge).catch(() => undefined);
  }, [id]);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setEntries(null);
    setFailed(false);
    setShown(GRID_PAGE);
    api
      .listChallengeEntries(id, { sort })
      .then((r) => alive && setEntries(r.entries.filter((e) => e.playback_url)))
      .catch(() => {
        if (!alive) return;
        setEntries([]);
        setFailed(true);
      });
    return () => {
      alive = false;
    };
  }, [id, sort, reload]);

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
            <Chip
              key={key}
              label={t(label)}
              role="radio"
              selected={sort === key}
              style={styles.chip}
              phLabel={`challenge_others_sort_${key}`}
              onPress={() => setSort(key)}
            />
          ))}
        </View>
        {entries === null && <SkeletonCards count={4} columns={2} aspectRatio={1 / 1.4} style={styles.flush} />}
        {failed && <InlineError message={t('challengeOthers.loadFail')} onRetry={() => setReload((n) => n + 1)} />}
        {entries?.length === 0 && !failed && (
          <View style={styles.empty}>
            <Text style={styles.emptyTitle}>{t('challenges.emptyEntriesTitle')}</Text>
            <Text style={styles.emptyText}>{t('challenges.emptyEntriesSub')}</Text>
          </View>
        )}
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
          <PrimaryButton
            label={t('challenges.performCta')}
            icon={<Feather name="video" size={18} color={palette.onAccent} />}
            onPress={perform}
          />
        </CtaBar>
      )}
    </SafeAreaView>
  );
}

/** 재생 없이 첫 장면만 멈춰 보여 주는 칸. */
function Tile({ entry, onPress }: { entry: EntryCard; onPress: () => void }) {
  const { width } = useWindowDimensions();
  const size = (width - space.gutter * 2 - space[3]) / 2;
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
        <View style={styles.likes}>
          <Feather name="heart" size={12} color={palette.onAccent} />
          <Text style={styles.tileName}>{entry.like_count}</Text>
        </View>
      </View>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flush: { paddingHorizontal: 0 },
  content: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[6], gap: space[2] },
  line: { ...type.title2, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  tabs: { flexDirection: 'row', gap: space[1.5], marginVertical: space[2] },
  chip: { minHeight: 32, paddingVertical: space[1] },
  empty: { backgroundColor: palette.bgSubtle, borderRadius: radius.md, paddingVertical: space[6], paddingHorizontal: space[4], gap: space[1.5], alignItems: 'center' },
  emptyTitle: { ...type.body2Bold, color: palette.textSub, textAlign: 'center' },
  emptyText: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
  grid: { flexDirection: 'row', flexWrap: 'wrap', gap: space[3] },
  tile: { borderRadius: radius.lg, overflow: 'hidden', backgroundColor: palette.text, justifyContent: 'flex-end' },
  tileInfo: { flexDirection: 'row', justifyContent: 'space-between', alignItems: 'center', padding: space[3], backgroundColor: palette.scrim },
  likes: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  tileName: { ...type.captionBold, color: palette.onAccent },
  more: { height: 44, alignItems: 'center', justifyContent: 'center', marginTop: space[2] },
  moreText: { ...type.body2Bold, color: palette.blueDeep },
});
