import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { SkeletonDetail, SkeletonRows } from '@/components/ui/skeleton';
import { CtaBar } from '@/components/ui/cta-bar';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { browseFailure, browseFailureMessage, rankingNotice, ranksHidden } from '@/lib/challenge/browse';
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
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!id) return;
    let alive = true;
    void (async () => {
      try {
        const [detail, list] = await Promise.all([api.getChallenge(id), api.listChallengeEntries(id, { sort: 'likes' })]);
        if (!alive) return;
        setChallenge(detail);
        setPicked(ranksHidden(detail) ? [] : pickedEntries(list.entries));
      } catch (e) {
        if (alive) setError(browseFailureMessage(browseFailure(e)));
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
  }, [id]);

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
        {!challenge && !error && <SkeletonDetail lines={3} style={{ paddingHorizontal: 0 }} />}
        {!!error && <Text style={styles.error}>{error}</Text>}

        {challenge && (
          <>
            <View style={styles.lineHead}>
              <Text style={styles.period}>
                {t('challengeResult.period', { period: periodLabel(challenge.starts_at, challenge.ends_at) })}
              </Text>
              <Text style={styles.line}>“{challenge.line}”</Text>
            </View>

            <Text style={[styles.section, styles.sectionDim]}>{t('challengeResult.picked', { count: picked?.length ?? 0 })}</Text>
            {!!notice && ranksHidden(challenge) && <Text style={styles.notice}>{notice}</Text>}
            {picked === null && <SkeletonRows count={2} avatar card={false} style={{ paddingHorizontal: 0 }} />}
            {picked?.length === 0 && !ranksHidden(challenge) && <Text style={styles.muted}>{t('challengeResult.noPicked')}</Text>}
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
                <Feather name="chevron-right" size={20} color={palette.textDisabled} />
              </Pressable>
            ))}

            <View style={styles.mine}>
              <Text style={styles.mineLabel}>{t('challengeResult.mine')}</Text>
              {mine === undefined ? (
                <View />
              ) : mine ? (
                <Pressable
                  style={styles.mineRow}
                  onPress={() => router.push('/challenge-entries')}
                  accessibilityRole="button">
                  <Text style={styles.mineText}>{mineLabel}</Text>
                  <Feather name="chevron-right" size={18} color={palette.iconFaint} />
                </Pressable>
              ) : (
                <Text style={styles.mineText}>{t('challengeResult.mineNone')}</Text>
              )}
            </View>
          </>
        )}
      </ScrollView>
      <CtaBar safeBottom={false}>
        {nextId ? <TextButton label={t('challengeResult.seeChallenges')} tone="accent" onPress={() => router.dismissTo('/challenges')} /> : null}
        <PrimaryButton label={t(nextId ? 'challengeResult.seeWeek' : 'challengeResult.seeChallenges')} onPress={seeWeek} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  pressed: { opacity: 0.85 },
  content: { paddingHorizontal: 24, paddingTop: 16, paddingBottom: 24, gap: 14 },
  error: { color: palette.danger, fontSize: 13.5, fontWeight: '700', textAlign: 'center', paddingVertical: 16 },
  lineHead: { gap: 8, padding: 20, borderRadius: 20, backgroundColor: '#191F28' },
  period: { fontSize: 13, fontWeight: '700', color: 'rgba(255,255,255,0.67)', lineHeight: 20 },
  line: { fontSize: 19, fontWeight: '800', color: '#FFFFFF', lineHeight: 27 },
  section: { fontSize: 15, fontWeight: '800', color: palette.text, marginTop: 8 },
  sectionDim: { color: palette.textSub },
  notice: { fontSize: 12.5, fontWeight: '700', color: palette.amber },
  muted: { fontSize: 14, color: palette.textMeta, lineHeight: 21 },
  row: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 8, paddingHorizontal: 4, borderRadius: 12 },
  rank: { width: 24, fontSize: 16, fontWeight: '800', color: palette.blue, textAlign: 'center' },
  rowBody: { flex: 1, minWidth: 0, gap: 6 },
  name: { fontSize: 16, fontWeight: '800', color: palette.text },
  sub: { fontSize: 13, fontWeight: '600', color: palette.textMeta, lineHeight: 20 },
  mine: { paddingTop: 12, paddingBottom: 6, gap: 6 },
  mineLabel: { fontSize: 14, fontWeight: '800', color: palette.textSub },
  mineRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  mineText: { fontSize: 15, fontWeight: '700', color: palette.text },
});
