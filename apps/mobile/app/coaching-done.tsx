import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, Share, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { KeyboardAwareScroll } from '@/components/keyboard-aware-scroll';
import { KeyboardLift } from '@/components/keyboard-lift';
import { ReportRating } from '@/components/report-rating';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { MASCOT } from '@/components/ui/mascot';
import { palette } from '@/constants/palette';
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
          <Feather name="check-circle" size={16} color={palette.green} />
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
            <Feather name="bell" size={18} color={palette.blueDeep} />
            <Text style={styles.reminderText}>{t('note.doneReminder')}</Text>
          </View>
        )}
        {practiceId && note && (
          <View style={styles.rating}>
            <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />
          </View>
        )}
      </KeyboardAwareScroll>
      <CtaBar safeBottom={false}>
        {/* pen P16.1·P16.2 — 아래 버튼은 「확인」, 누르면 홈. */}
        <PrimaryButton label={t('note.doneConfirm')} onPress={() => router.dismissTo('/(tabs)')} />
        <Pressable style={styles.share} onPress={share} accessibilityRole="button" ph-label="coaching_done_share">
          <Feather name="share-2" size={16} color={palette.blueDeep} />
          <Text style={styles.shareText}>{t('journal.endShare')}</Text>
        </Pressable>
      </CtaBar>
      </KeyboardLift>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, padding: 24, gap: 16 },
  badge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, paddingVertical: 6, paddingHorizontal: 12, borderRadius: 9999, backgroundColor: palette.greenSoft },
  badgeText: { fontSize: 13, fontWeight: '800', color: palette.green },
  head: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  mascot: { width: 52, height: 58 },
  title: { flex: 1, fontSize: 22, fontWeight: '800', lineHeight: 30, color: palette.text },
  nextCard: { gap: 6, paddingVertical: 14, paddingHorizontal: 16, borderRadius: 16, backgroundColor: palette.bgSoft },
  nextLabel: { fontSize: 12, fontWeight: '800', color: palette.textMuted },
  nextText: { fontSize: 16, fontWeight: '800', lineHeight: 23, color: palette.text },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: 10, paddingVertical: 12, paddingHorizontal: 14, borderRadius: 14, backgroundColor: palette.blueSoft },
  reminderText: { flex: 1, fontSize: 14, fontWeight: '700', color: palette.blueDeep },
  rating: { alignSelf: 'stretch', marginTop: 4 },
  share: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12 },
  shareText: { fontSize: 15, fontWeight: '700', color: palette.blueDeep },
});
