import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, canPerform, dDayLabel } from '@/lib/challenge/browse';
import type { ChallengeCard, ChallengeTab } from '@/lib/challenge/types';
import { translate as t } from '@/lib/i18n';
import { limitVideoBuffer, sourceWhileFocused } from '@/lib/video-memory';
import { SkeletonRows } from '@/components/ui/skeleton';

/**
 * C9.16 대사 고르기 — 올릴 대사가 정해지지 않은 영상(대사 없이 찍었거나 갤러리에서 고른 영상)을 어느 챌린지에 올릴지 정한다.
 * 찍은 영상은 recorded-video 저장소에 그대로 두고(챌린지 올리기 화면이 꺼낸다), 고른 대사 id 만 넘긴다.
 */
const TABS: { key: ChallengeTab; label: string }[] = [
  { key: 'popular', label: 'challenges.tabPopular' },
  { key: 'latest', label: 'challenges.tabLatest' },
  { key: 'ended', label: 'challenges.tabEnded' },
  { key: 'mine', label: 'challenges.tabMineShort' },
];

export default function LinePickScreen() {
  const router = useRouter();
  const params = useLocalSearchParams<{ videoId?: string }>();
  const [tab, setTab] = useState<ChallengeTab>('popular');
  const [featured, setFeatured] = useState<ChallengeCard | null>(null);
  const [list, setList] = useState<ChallengeCard[] | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [exampleUrl, setExampleUrl] = useState<string | null>(null);

  useEffect(() => {
    let alive = true;
    setList(null);
    setError(null);
    api
      .listChallenges({ tab })
      .then((result) => {
        if (!alive) return;
        if (tab === 'popular' || tab === 'latest') setFeatured(result.featured);
        setList(result.challenges.filter((c) => c.id !== result.featured?.id));
      })
      .catch((e) => {
        if (!alive) return;
        setList([]);
        setError(browseFailureMessage(browseFailure(e)));
      });
    return () => {
      alive = false;
    };
  }, [tab]);

  const featuredId = featured?.id ?? null;
  const featuredCount = featured?.entry_count ?? 0;
  useEffect(() => {
    setExampleUrl(null);
    if (!featuredId || featuredCount === 0) return;
    let alive = true;
    void api
      .listChallengeEntries(featuredId, { sort: 'likes' })
      .then((r) => alive && setExampleUrl(r.entries.find((e) => e.playback_url)?.playback_url ?? null))
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [featuredId, featuredCount]);

  const choose = useCallback(
    (challenge: ChallengeCard) => {
      if (!canPerform(challenge)) return;
      void logEvent('challenge_line_pick', { id: challenge.id });
      router.replace({
        pathname: '/challenge-upload',
        params: {
          challengeId: challenge.id,
          line: challenge.line,
          work: challenge.work,
          ...(params.videoId ? { videoId: params.videoId } : {}),
        },
      });
    },
    [params.videoId, router],
  );

  const showFeatured = featured && canPerform(featured) && (tab === 'popular' || tab === 'latest');

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('linePick.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {showFeatured && featured && (
          <>
            <Hero challenge={featured} videoUrl={exampleUrl} />
            <PrimaryButton label={t('challenges.performCta')} onPress={() => choose(featured)} />
            <View style={styles.sameHead}>
              <Text style={styles.sameTitle}>{t('challenges.sameLineTitle')}</Text>
              <Text style={styles.meta}>
                {t('challenges.sameLineMeta', { dday: dDayLabel(featured), count: featured.entry_count })}
              </Text>
            </View>
          </>
        )}
        <Text style={styles.ask}>{t('linePick.ask')}</Text>
        <View style={styles.tabs}>
          {TABS.map(({ key, label }) => (
            <Pressable
              key={key}
              hitSlop={6}
              onPress={() => setTab(key)}
              accessibilityRole="button"
              accessibilityState={{ selected: tab === key }}>
              <Text style={[styles.tabText, tab === key && styles.tabTextOn]}>{t(label)}</Text>
            </Pressable>
          ))}
        </View>
        {list === null && !error && <SkeletonRows count={4} avatar={false} card={false} style={{ paddingHorizontal: 0 }} />}
        {error && <Text style={styles.meta}>{error}</Text>}
        {list?.length === 0 && !error && <Text style={styles.meta}>{t('linePick.empty')}</Text>}
        {list?.map((challenge) => {
          const open = canPerform(challenge);
          return (
            <Pressable
              key={challenge.id}
              style={({ pressed }) => [styles.row, !open && styles.rowOff, pressed && open && styles.pressed]}
              onPress={() => choose(challenge)}
              disabled={!open}
              accessibilityRole="button"
              accessibilityLabel={challenge.line}>
              <Text style={styles.rowLine} numberOfLines={2}>
                “{challenge.line}”
              </Text>
              <Text style={styles.meta} numberOfLines={1}>
                {[challenge.work, t('challenges.entryCount', { count: challenge.entry_count }), dDayLabel(challenge)].join(' · ')}
              </Text>
            </Pressable>
          );
        })}
        <Pressable
          style={({ pressed }) => [styles.register, pressed && styles.pressed]}
          onPress={() => router.push('/line-new')}
          accessibilityRole="button"
          ph-label="line_pick_register">
          <Text style={styles.registerText}>+ {t('challenges.registerCta')}</Text>
        </Pressable>
      </ScrollView>
    </SafeAreaView>
  );
}

function Hero({ challenge, videoUrl }: { challenge: ChallengeCard; videoUrl: string | null }) {
  const focused = useIsFocused();
  const player = useVideoPlayer(sourceWhileFocused(videoUrl, focused), (p) => {
    p.loop = true;
    p.muted = true;
    limitVideoBuffer(p);
    p.play();
  });
  /** 첫 장면이 그려지기 전의 VideoView 는 검은 상자다 — 그려질 때까지 숨긴다. */
  const [frameReady, setFrameReady] = useState(false);
  useEffect(() => setFrameReady(false), [videoUrl]);
  return (
    <View style={styles.hero}>
      {!!videoUrl && (
        <VideoView
          style={[StyleSheet.absoluteFill, { opacity: frameReady ? 1 : 0 }]}
          player={player}
          contentFit="cover"
          nativeControls={false}
          onFirstFrameRender={() => setFrameReady(true)}
        />
      )}
      <View style={styles.scrim} pointerEvents="none" />
      {!!videoUrl && (
        <View style={styles.chip}>
          <Text style={styles.chipText}>{t('challenges.exampleChip')}</Text>
        </View>
      )}
      <Text style={styles.heroLine} numberOfLines={4}>
        “{challenge.line}”
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: 24, paddingTop: 12, paddingBottom: 32, gap: 8 },
  hero: { height: 220, borderRadius: 20, overflow: 'hidden', backgroundColor: palette.blue, justifyContent: 'flex-end', padding: 16, marginBottom: 8 },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: 'rgba(0,0,0,0.25)' },
  chip: { position: 'absolute', top: 12, left: 12, backgroundColor: 'rgba(0,0,0,0.5)', borderRadius: 12, paddingHorizontal: 10, paddingVertical: 4 },
  chipText: { color: '#fff', fontSize: 12, fontWeight: '600' },
  heroLine: { color: '#fff', fontSize: 20, fontWeight: '800', lineHeight: 27 },
  sameHead: { marginTop: 16, gap: 6 },
  sameTitle: { fontSize: 18, fontWeight: '800', lineHeight: 24, color: palette.text },
  meta: { fontSize: 13, fontWeight: '500', lineHeight: 19, color: palette.textMeta },
  ask: { fontSize: 16, fontWeight: '700', color: palette.text, marginTop: 20 },
  tabs: { flexDirection: 'row', gap: 14, marginVertical: 8 },
  tabText: { fontSize: 15, fontWeight: '700', color: palette.textMeta },
  tabTextOn: { color: palette.text },
  row: { paddingVertical: 12, gap: 4 },
  rowOff: { opacity: 0.45 },
  rowLine: { fontSize: 16, fontWeight: '700', lineHeight: 23, color: palette.text },
  register: { height: 52, borderRadius: 14, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center', marginTop: 16 },
  registerText: { fontSize: 15, fontWeight: '700', color: palette.blue },
  pressed: { opacity: 0.85 },
});
