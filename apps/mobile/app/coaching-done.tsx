import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { KeyboardLift } from '@/components/keyboard-lift';
import { ReportRating } from '@/components/report-rating';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { DEFAULT_NOTIFICATION_SETTINGS } from '@/lib/push-policy';
import { translate as t } from '@/lib/i18n';
import { readOptionalPracticeNote } from '@/lib/practice/note';
import type { PracticeNote } from '@/lib/practice/types';
import { markFirstUseGraduated } from '@/lib/practice/first-use-graduation';

/**
 * 오늘 코칭 끝(pen ⑧ 「오늘 코칭 끝」 TFZ59, SOMA-720) — 배우 일지에서 「저장하기」를 누른 뒤 한 번 보인다.
 *
 * pen P16.1/P16.2(10/24): 「오늘 코칭 끝!」 배지 · 기쁜 액티 + 제목 · 「다음에 해 볼 것」 카드 · 저녁 알림 안내(알림이 켜져 있을 때만).
 * 아래 설명은 이전 기록이다 — 기쁜 액티 · 「일지에 저장했어요」 · 「이 코칭 어땠어요?」(도움 됐어요/아쉬웠어요) · 「홈으로 가기」 ·
 * 「SNS에 공유하기」. 코칭 평가는 배우 일지에서 이 화면으로 옮겼다(pen 메모, 10/19 시안) — 평가는 지금처럼 그 회차의 노트에
 * 남겨(PUT …/note/rating) ops 코칭 노트 평가 집계가 그대로 이어진다. 노트가 없는 회차는 평가 칸을 두지 않는다.
 */
export default function CoachingDoneScreen() {
  const router = useRouter();
  // 코칭을 노트·일지·마무리까지 가 봤으면 첫 사용자 화면은 졸업이다(SOMA-827).
  useEffect(() => {
    void markFirstUseGraduated();
  }, []);
  const params = useLocalSearchParams<{ practiceId?: string; saved?: string; next?: string }>();
  const practiceId = params.practiceId?.trim() || null;
  const [note, setNote] = useState<PracticeNote | null>(null);
  const [reminderOn, setReminderOn] = useState(DEFAULT_NOTIFICATION_SETTINGS.evening_reminder);

  useEffect(() => {
    if (!practiceId) return;
    let alive = true;
    readOptionalPracticeNote(api.getPracticeNote, practiceId)
      .then((found) => {
        if (alive) setNote(found);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [practiceId]);

  // 저녁 알림 안내는 알림이 켜져 있을 때만 보인다(pen P16.2). 설정을 못 읽으면 기본값(켜짐)을 쓴다.
  useEffect(() => {
    let alive = true;
    Promise.resolve()
      .then(() => api.notificationSettings())
      .then((s) => {
        if (alive) setReminderOn(s.evening_reminder);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, []);

  const share = () => {
    void Share.share({ message: t('journal.shareText') }).catch(() => {});
  };

  const nextTake = params.next?.trim() || note?.next_take?.trim() || null;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      {/* 평가 한 줄을 쓸 때 입력칸과 「홈으로」가 키보드 위에 남게 한다. */}
      <KeyboardLift aboveSafeBottom>
      <KeyboardAwareScroll contentContainerStyle={styles.body}>
        <View style={styles.badge}>
          <Feather name="check-circle" size={12} color={palette.green} />
          <Text style={styles.badgeText}>{t('note.doneBadge')}</Text>
        </View>
        <View style={styles.head}>
          <Image source={MASCOT.jump} style={styles.mascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <Text style={styles.title} accessibilityRole="header">
            {t(nextTake ? 'note.doneTitle' : 'note.doneTitleNoNext')}
          </Text>
        </View>
        {nextTake && (
          <View style={styles.nextCard}>
            <Text style={styles.nextLabel}>{t('note.doneNextLabel')}</Text>
            <Text style={styles.nextText}>{nextTake}</Text>
          </View>
        )}
        {reminderOn && (
          <View style={styles.reminder}>
            <Feather name="bell" size={16} color={palette.iconFaint} />
            <Text style={styles.reminderText}>{t('note.doneReminder')}</Text>
          </View>
        )}
        {practiceId && note && (
          <View style={styles.rating}>
            <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />
          </View>
        )}
      </KeyboardAwareScroll>
      {/* 광고 칸(SOMA-876) — 연습 중 칸, 아래 버튼 묶음 바로 위(CtaBar 위 여백 12 + 12 = 24). */}
      <AdSlot slot="coaching_done" style={styles.ad} />
      <CtaBar safeBottom={false}>
        {/* pen P16.1·P16.2 — 아래 버튼은 「확인」, 누르면 홈. */}
        <Pressable style={styles.share} onPress={share} accessibilityRole="button" ph-label="coaching_done_share">
          <Feather name="share-2" size={16} color={palette.textSub} />
          <Text style={styles.shareText}>{t('journal.endShare')}</Text>
        </Pressable>
        <PrimaryButton label={t('note.doneConfirm')} onPress={() => router.dismissTo('/(tabs)')} />
      </CtaBar>
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, paddingHorizontal: space.gutter, paddingTop: space[6], paddingBottom: space[6], gap: space[4] },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: space[1], paddingVertical: space[1], paddingHorizontal: space[2], borderRadius: radius.full, backgroundColor: palette.greenSoft },
  badgeText: { ...type.micro, color: palette.green },
  head: { flexDirection: 'row', alignItems: 'center', gap: space[3] },
  mascot: { width: 52, height: 58 },
  title: { flex: 1, ...type.title2, color: palette.text },
  nextCard: { gap: space[1], padding: space[4], borderRadius: radius.lg, backgroundColor: palette.blueSoft },
  nextLabel: { ...type.micro, color: palette.blueDeep },
  nextText: { ...type.body2Bold, color: palette.text },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: palette.bgSubtle },
  reminderText: { flex: 1, ...type.caption, color: palette.textSub },
  rating: { alignSelf: 'stretch', marginTop: space[2] },
  ad: { marginHorizontal: space.gutter, marginBottom: space[3] },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: space[1.5], height: 40 },
  shareText: { ...type.body2Bold, color: palette.textSub },
});
