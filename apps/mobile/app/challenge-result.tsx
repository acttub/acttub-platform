import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { ChallengeNotice } from '@/components/challenge-notice';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineEmpty } from '@/components/ui/inline-empty';
import { InlineError, InlineErrorLine } from '@/components/ui/inline-error';
import { SkeletonDetail, SkeletonRows } from '@/components/ui/skeleton';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, canRetryBrowse, rankingNotice, ranksHidden, type BrowseFailure } from '@/lib/challenge/browse';
import type { ChallengeDetail, EntryCard, MyEntryCard } from '@/lib/challenge/types';
import { periodLabel, pickedEntries } from '@/lib/challenge/week-result';
import { translate as t } from '@/lib/i18n';

/**
 * 지난주 결과(SOMA-748 ljrKJM) — 끝난 공식 챌린지의 선정작 셋과 내 참여작.
 *
 * 선정작은 서버 확정 순위(rank) 3위 안의 참여작이다. 확정 전(집계 중)이면 순위를 보이지 않는다. 상품 발표·지급 기록은 서버에 없어(C)
 * 보이지 않는다. 내 참여작은 내 참여작 목록(P03)의 첫 쪽에서 이 챌린지 것을 찾는다.
 */
export default function ChallengeResultScreen() {
  const router = useRouter();
  const { id, nextId } = useLocalSearchParams<{ id?: string; nextId?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [picked, setPicked] = useState<EntryCard[] | null>(null);
  const [mine, setMine] = useState<MyEntryCard | null | undefined>(undefined);
  const [error, setError] = useState<BrowseFailure | null>(null);
  const [reload, setReload] = useState(0);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    setError(null);
    void (async () => {
      try {
        const [detail, list] = await Promise.all([api.getChallenge(id), api.listChallengeEntries(id, { sort: 'likes' })]);
        if (!alive) return;
        setChallenge(detail);
        setPicked(ranksHidden(detail) ? [] : pickedEntries(list.entries));
      } catch (e) {
        if (alive) setError(browseFailure(e));
      }
      try {
        const my = await api.listMyChallengeEntries();
        if (alive) setMine(my.entries.find((entry) => entry.challenge.id === id) ?? null);
      } catch {
        if (alive) setMine(null);
      }
    })();
    return () => {
      alive = false;
    };
  }, [id, reload]);

  const seeWeek = () => {
    void logEvent('challenge_result_see_week', {});
    if (nextId) router.replace({ pathname: '/challenge-detail', params: { id: nextId } });
    else router.back();
  };

  const notice = challenge ? rankingNotice(challenge) : null;
  const mineLabel = mine
    ? mine.category === 'under_review'
      ? t('challengeResult.mineReview')
      : mine.visibility === 'public'
        ? t('challengeResult.minePublic')
        : t('challengeResult.minePrivate')
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('challengeResult.title') }} />
      <ScrollView contentContainerStyle={styles.content}>
        {!challenge && !error && <SkeletonDetail lines={3} style={styles.flush} />}
        {error && !canRetryBrowse(error) && <InlineErrorLine message={browseFailureMessage(error)} />}
        {error && canRetryBrowse(error) && (
          <InlineError message={browseFailureMessage(error)} onRetry={() => setReload((n) => n + 1)} />
        )}

        {challenge && (
          <>
            <View style={styles.lineHead}>
              <Text style={styles.period}>
                {t('challengeResult.period', { period: periodLabel(challenge.starts_at, challenge.ends_at) })}
              </Text>
              <Text style={styles.line}>“{challenge.line}”</Text>
            </View>

            <Text style={styles.section}>{t('challengeResult.picked', { count: picked?.length ?? 0 })}</Text>
            {!!notice && ranksHidden(challenge) && <ChallengeNotice message={notice} />}
            {picked === null && <SkeletonRows count={2} avatar card={false} style={styles.flush} />}
            {picked?.length === 0 && !ranksHidden(challenge) && (
              <InlineEmpty title={t('challengeResult.noPicked')} />
            )}
            {picked?.map((entry) => (
              <Pressable
                key={entry.id}
                style={({ pressed }) => [styles.row, pressed && styles.pressed]}
                onPress={() => router.push({ pathname: '/challenge-play', params: { id: challenge.id, entryId: entry.id } })}
                accessibilityRole="button"
                accessibilityLabel={entry.author.name}>
                <Text style={styles.rank}>{entry.rank}</Text>
                <View style={styles.rowBody}>
                  <Text style={styles.name} numberOfLines={1}>
                    {entry.author.name}
                  </Text>
                  <Text style={styles.sub} numberOfLines={1}>
                    {t('challengeResult.pickedSub', { count: entry.final_like_count ?? entry.like_count })}
                  </Text>
                </View>
                <Feather name="chevron-right" size={20} color={palette.iconFaint} />
              </Pressable>
            ))}

            <View style={styles.mine}>
              <Text style={styles.section}>{t('challengeResult.mine')}</Text>
              {mine === undefined ? (
                <View />
              ) : mine ? (
                <Pressable
                  style={styles.mineRow}
                  onPress={() => router.push('/challenge-entries')}
                  accessibilityRole="button">
                  <View style={styles.rowBody}>
                    <Text style={styles.name}>{mineLabel}</Text>
                    <Text style={styles.sub}>
                      {[t('challengeResult.pickedSub', { count: mine.final_like_count ?? mine.like_count }), mine.rank ? t('challengeResult.rank', { rank: mine.rank }) : null]
                        .filter(Boolean)
                        .join(' · ')}
                    </Text>
                  </View>
                  <Feather name="chevron-right" size={20} color={palette.iconFaint} />
                </Pressable>
              ) : (
                <Text style={styles.sub}>{t('challengeResult.mineNone')}</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <CtaBar safeBottom={false}>
        {nextId ? <TextButton label={t('challengeResult.seeChallenges')} onPress={() => router.dismissTo('/challenges')} /> : null}
        <PrimaryButton label={t(nextId ? 'challengeResult.seeWeek' : 'challengeResult.seeChallenges')} onPress={seeWeek} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flush: { paddingHorizontal: 0 },
  pressed: { opacity: 0.7 },
  content: { paddingHorizontal: space.gutter, paddingTop: space[4], paddingBottom: space[6], gap: space[3] },
  lineHead: { gap: space[2], padding: space[5], borderRadius: radius.lg, backgroundColor: palette.text },
  period: { ...type.caption, color: palette.onMediaSub },
  line: { ...type.headline, fontWeight: '700', color: palette.onAccent },
  section: { ...type.headline, color: palette.text, marginTop: space[2] },
  row: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
  rank: { width: 24, ...type.headline, color: palette.blueDeep, textAlign: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: space[1] },
  name: { ...type.body1Bold, color: palette.text },
  sub: { ...type.caption, color: palette.textMeta },
  mine: { gap: space[3] },
  mineRow: { flexDirection: 'row', alignItems: 'center', gap: space[3], paddingVertical: space[3] },
});
