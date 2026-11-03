import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Share, StyleSheet, Text, View } from 'react-native';

import { AdSlot } from '@/components/ad-slot';
import { ReportRating } from '@/components/report-rating';
import { TextButton } from '@/components/ui/buttons';
import { DoneScreen } from '@/components/ui/done-screen';
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
 * 디자인 시스템 DoneScreen 틀 — 마스코트 · 제목 · 「다음에 해 볼 것」 카드 · 저녁 알림 안내(알림이 켜져 있을 때만) · 평가 · 아래 「홈으로 가기」.
 * 코칭 평가는 배우 일지에서 이 화면으로 옮겼다(pen 메모, 10/19 시안) — 평가는 지금처럼 그 회차의 노트에
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
    <>
      <Stack.Screen options={{ headerShown: false, gestureEnabled: false }} />
      <DoneScreen
        mascotTop
        title={t(nextTake ? 'note.doneTitle' : 'note.doneTitleNoNext')}
        onHome={() => router.dismissTo('/(tabs)')}
        footer={
          <>
            {/* 광고 칸(SOMA-876) — 연습 중 칸, 아래 버튼 묶음 바로 위. */}
            <AdSlot slot="coaching_done" />
            <TextButton label={t('journal.endShare')} phLabel="coaching_done_share" onPress={share} />
          </>
        }>
        <View style={styles.content}>
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
          {practiceId && note && <ReportRating practiceId={practiceId} initial={note.my_rating} key={note.id} />}
        </View>
      </DoneScreen>
    </>
  );
}

const styles = StyleSheet.create({
  content: { gap: space[4], paddingTop: space[3] },
  nextCard: { gap: space[2], padding: space[4], borderRadius: radius.lg, borderWidth: 1, borderColor: palette.border, backgroundColor: palette.bg },
  nextLabel: { ...type.captionBold, color: palette.blueDeep },
  nextText: { ...type.headline, color: palette.text },
  reminder: { flexDirection: 'row', alignItems: 'center', gap: space[2], padding: space[3], borderRadius: radius.md, backgroundColor: palette.bgSubtle },
  reminderText: { flex: 1, ...type.caption, color: palette.textSub },
});
