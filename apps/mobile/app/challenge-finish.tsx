import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT as MASCOTS, MASCOT_SIZE } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { dDayLabel } from '@/lib/challenge/browse';
import { hasFinishedFirstChallenge } from '@/lib/challenge/intro-state';
import type { ChallengeDetail } from '@/lib/challenge/types';
import { resultDay } from '@/lib/challenge/week-result';
import { translate as t, translateList } from '@/lib/i18n';

const MASCOT = MASCOTS.dance;

/**
 * 챌린지 마무리(SOMA-748 Ttlo3) — AI 리포트 다음, 「여기까지 할게요」·「공개하기」 뒤에 온다.
 *
 * 결과 날짜는 마감 시각(ends_at)의 한국 날짜다. 결과 알림은 서버의 challenge_ended 알림이 보낸다(앱이 따로 예약하지 않는다).
 * 「다른 참여작 보기」는 이 챌린지 피드, 「홈으로」는 홈 탭이다.
 */
export default function ChallengeFinishScreen() {
  const router = useRouter();
  const { challengeId } = useLocalSearchParams<{ challengeId?: string }>();
  const [challenge, setChallenge] = useState<ChallengeDetail | null>(null);
  const [showGuide, setShowGuide] = useState(false);

  useEffect(() => {
    void hasFinishedFirstChallenge().then((done) => setShowGuide(!done));
    if (!challengeId) return;
    void api
      .getChallenge(challengeId)
      .then(setChallenge)
      .catch(() => setChallenge(null));
  }, [challengeId]);

  const day = challenge ? resultDay(challenge.ends_at) : null;
  const date = day
    ? t('challengeFinish.date', { month: day.month, day: day.day, weekday: translateList('challengeFinish.weekdays')[day.weekday] ?? '' })
    : null;

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <ScrollView contentContainerStyle={styles.content}>
        <View style={styles.badge}>
          <Feather name="check-circle" size={16} color={palette.green} />
          <Text style={styles.badgeText}>{t('challengeFinish.badge')}</Text>
        </View>
        <View style={styles.titleRow}>
          <Image source={MASCOT} style={styles.mascot} contentFit="contain" accessibilityIgnoresInvertColors />
          <Text style={styles.title}>{date ? t('challengeFinish.title', { date }) : t('challengeFinish.badge')}</Text>
        </View>
        <Text style={styles.sub}>{t('challengeFinish.sub')}</Text>

        {challenge && (
          <View style={styles.lineCard}>
            <Text style={styles.lineLabel}>{t('challengeFinish.lineLabel', { dday: dDayLabel(challenge) })}</Text>
            <Text style={styles.line} numberOfLines={2}>
              “{challenge.line}”
            </Text>
            <Text style={styles.joined}>{t('challengeFinish.joined', { count: challenge.entry_count })}</Text>
          </View>
        )}

        {showGuide && <Text style={styles.guide}>{t('challengeFinish.guide')}</Text>}
      </ScrollView>
      <CtaBar safeBottom={false}>
        <PrimaryButton
          label={t('challengeFinish.seeOthers')}
          disabled={!challengeId}
          onPress={() => {
            void logEvent('challenge_finish_see_others', {});
            router.replace({ pathname: '/challenge-play', params: { id: challengeId as string } });
          }}
        />
        <SecondaryButton label={t('challengeFinish.home')} onPress={() => router.replace('/(tabs)')} />
      </CtaBar>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  content: { paddingHorizontal: 24, paddingTop: 24 },
  badge: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    alignSelf: 'flex-start',
    backgroundColor: palette.greenSoft,
    borderRadius: 999,
    paddingHorizontal: 12,
    paddingVertical: 6,
  },
  badgeText: { fontSize: 13, fontWeight: '800', color: palette.green },
  titleRow: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  mascot: MASCOT_SIZE.sm,
  title: { flex: 1, fontSize: 22, fontWeight: '800', color: palette.text, lineHeight: 30 },
  sub: { fontSize: 14, fontWeight: '600', color: palette.textMuted, lineHeight: 20, marginTop: 6 },
  lineCard: { backgroundColor: palette.bgSoft, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6, marginTop: 18 },
  lineLabel: { fontSize: 12, fontWeight: '800', color: palette.flame },
  line: { fontSize: 16, fontWeight: '800', color: palette.text, lineHeight: 23 },
  joined: { fontSize: 13, fontWeight: '600', color: palette.textMuted, lineHeight: 19 },
  guide: { fontSize: 14, fontWeight: '700', color: palette.blueDeep, lineHeight: 20, marginTop: 14 },
});
