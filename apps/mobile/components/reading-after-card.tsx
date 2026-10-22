import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { recordingCoachOnFromProbe } from '@/lib/reading/recording-coach';

/**
 * 리딩 완료 화면의 다음 걸음(10/21 사용자 확정 배치) — 위에 크게 「방금 녹음으로 코치랑 얘기해 볼래요?」(무료, SOMA-791),
 * 아래 작은 줄 「발음 보고서 보기 PRO」(SOMA-606). 둘 다 서버 스위치를 켠 배포·허용된 사람에게만 보인다 — 꺼져 있으면
 * 아무것도 그리지 않는다. 녹음이 아직 올라가는 중(`ready` 거짓)이면 묻지 않는다(올라가기 전에 채점을 줄 세우지 않게).
 */
export function ReadingAfterCard({ sessionId, ready }: { sessionId: string; ready: boolean }) {
  const router = useRouter();
  const [coachOn, setCoachOn] = useState(false);
  const [reportOn, setReportOn] = useState(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // 시험 목처럼 함수가 없어도 화면이 깨지지 않게 약속으로 감싼다.
    Promise.resolve().then(() => api.probeRecordingCoach()).then(
      () => undefined,
      (error) => {
        if (alive) setCoachOn(recordingCoachOnFromProbe(error));
      },
    );
    Promise.resolve().then(() => api.getPronunciationReport(sessionId)).then(
      () => {
        if (alive) setReportOn(true);
      },
      () => undefined,
    );
    return () => {
      alive = false;
    };
  }, [ready, sessionId]);

  if (!coachOn && !reportOn) return null;
  return (
    <View style={styles.wrap}>
      {coachOn && (
        <View style={styles.card}>
          <Text style={styles.title}>{t('reading.coachCardTitle')}</Text>
          <Text style={styles.sub}>{t('reading.coachCardSub')}</Text>
          <Pressable
            onPress={() => router.push({ pathname: '/reading/coach', params: { sessionId } })}
            accessibilityRole="button"
            accessibilityLabel={t('reading.coachCardCta')}
            ph-label="reading_coach_open"
            style={({ pressed }) => [styles.cta, pressed && styles.pressed]}>
            <Feather name="message-circle" size={16} color={palette.onAccent} />
            <Text style={styles.ctaText}>{t('reading.coachCardCta')}</Text>
          </Pressable>
        </View>
      )}
      {reportOn && (
        <Pressable
          onPress={() => router.push({ pathname: '/reading/pronunciation', params: { sessionId } })}
          accessibilityRole="button"
          accessibilityLabel={t('reading.pronReportRow')}
          ph-label="reading_pron_report_open"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.rowText}>{t('reading.pronReportRow')}</Text>
          <View style={styles.pro}>
            <Text style={styles.proText}>PRO</Text>
          </View>
          <View style={styles.flex} />
          <Feather name="chevron-right" size={16} color={palette.textFaint} />
        </Pressable>
      )}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: { gap: 6, marginTop: 8 },
  card: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 18, gap: 6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  sub: { color: palette.textDim, fontSize: 14, lineHeight: 21 },
  cta: {
    marginTop: 10,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  ctaText: { color: palette.onAccent, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 4 },
  rowText: { color: palette.textDim, fontSize: 15, fontWeight: '600' },
  pro: { backgroundColor: palette.navy, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proText: { color: palette.onAccent, fontSize: 11, fontWeight: '800' },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
});
