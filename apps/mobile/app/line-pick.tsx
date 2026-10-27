import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import Feather from '@expo/vector-icons/Feather';

import { Button, PrimaryButton } from '@/components/ui/buttons';
import { Chip } from '@/components/ui/chip';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError } from '@/components/ui/inline-error';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
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
  const [attempt, setAttempt] = useState(0);

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
  }, [tab, attempt]);

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
            <Chip key={key} size="sm" role="radio" label={t(label)} selected={tab === key} onPress={() => setTab(key)} phLabel="line_pick_tab" />
          ))}
        </View>
        {list === null && !error && <SkeletonRows count={4} avatar={false} card={false} style={styles.skeleton} />}
        {error && <InlineError message={error} onRetry={() => setAttempt((n) => n + 1)} />}
        {list?.length === 0 && !error && <InlineEmpty title={t('linePick.empty')} />}
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
        <Button
          size="sm"
          label={t('challenges.registerCta')}
          icon={<Feather name="plus" size={16} color={palette.blueDeep} />}
          onPress={() => router.push('/line-new')}
          phLabel="line_pick_register"
          style={styles.register}
        />
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
  content: { paddingHorizontal: space.gutter, paddingTop: space[3], paddingBottom: space[8], gap: space[2] },
  hero: { height: 220, borderRadius: radius.lg, overflow: 'hidden', backgroundColor: palette.blue, justifyContent: 'flex-end', padding: space[4], marginBottom: space[1] },
  scrim: { ...StyleSheet.absoluteFillObject, backgroundColor: palette.scrim },
  chip: { position: 'absolute', top: space[3], left: space[3], backgroundColor: palette.scrim, borderRadius: radius.full, paddingHorizontal: space[2], paddingVertical: space[1] },
  chipText: { ...type.micro, color: palette.onAccent },
  heroLine: { ...type.title2, color: palette.onAccent },
  sameHead: { marginTop: space[2], gap: space[1] },
  sameTitle: { ...type.headline, color: palette.text },
  meta: { ...type.caption, color: palette.textMeta },
  ask: { ...type.headline, color: palette.text, marginTop: space[2] },
  tabs: { flexDirection: 'row', flexWrap: 'wrap', gap: space[2], marginBottom: space[1] },
  skeleton: { paddingHorizontal: 0 },
  row: { paddingVertical: space[3], gap: space[1] },
  rowOff: { opacity: 0.5 },
  rowLine: { ...type.body1Bold, color: palette.text },
  register: { height: 48, marginTop: space[4] },
  pressed: { opacity: 0.85 },
});
