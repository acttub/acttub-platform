import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useEffect, useRef, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';

import { palette } from '@/constants/palette';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { logEvent } from '@/lib/analytics';
import { startPractice } from '@/lib/practice/session-state';
import { newRequestId } from '@/lib/request-id';
import { voiceCoachCardState } from '@/lib/reading/voice-coaching';

/**
 * 리딩 완료 화면의 다음 걸음 — 위에 크게 「방금 읽은 대본으로 코칭도 받아볼까요?」(무료, SOMA-791),
 * 아래 작은 줄 「발음 보고서 보기 PRO」(SOMA-606). 코칭 카드는 서버가 available 을 줄 때만 보인다(404·오류·거짓은 숨김).
 * 누르면 한 번에 시작한다: createPractice({request_id, reading_session_id}) → 코치 화면. 이미 시작한 회차가 있으면 그 회차를 연다.
 * 녹음이 아직 올라가는 중(`ready` 거짓)이면 묻지 않는다.
 */
/** part: 'coach' = 위 큰 카드만, 'report' = 아래 발음 보고서 줄만(pen 완료 화면은 둘을 따로 놓는다). 생략하면 둘 다. */
export function ReadingAfterCard({ sessionId, ready, part }: { sessionId: string; ready: boolean; part?: 'coach' | 'report' }) {
  const wantCoach = part !== 'report';
  const wantReport = part !== 'coach';
  const router = useRouter();
  const [coachOn, setCoachOn] = useState(false);
  const [reportOn, setReportOn] = useState(false);
  const [openPracticeId, setOpenPracticeId] = useState<string | null>(null);
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const requestIdRef = useRef<string | null>(null);
  const lockRef = useRef(false);

  useEffect(() => {
    if (!ready) return;
    let alive = true;
    // 시험 목처럼 함수가 없어도 화면이 깨지지 않게 약속으로 감싼다.
    if (wantCoach) {
      Promise.resolve().then(() => api.getReadingVoiceCoaching(sessionId)).then(
        (result) => {
          const card = voiceCoachCardState(result);
          if (!alive) return;
          setCoachOn(card.show);
          setOpenPracticeId(card.practiceId);
        },
        () => undefined,
      );
    }
    if (wantReport) {
      Promise.resolve().then(() => api.getPronunciationReport(sessionId)).then(
        () => {
          if (alive) setReportOn(true);
        },
        () => undefined,
      );
    }
    return () => {
      alive = false;
    };
  }, [ready, sessionId, wantCoach, wantReport]);

  const startCoaching = async () => {
    if (lockRef.current) return;
    lockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      if (openPracticeId) {
        router.push({ pathname: '/coach', params: { practiceId: openPracticeId } });
        return;
      }
      requestIdRef.current = requestIdRef.current ?? newRequestId();
      const practice = await api.createPractice({ request_id: requestIdRef.current, reading_session_id: sessionId });
      startPractice({
        practiceId: practice.id,
        rootId: practice.root_id,
        ordinal: practice.ordinal,
        conversationId: null,
        scene: { situation: '', character: '', goal: '' },
        videoUri: '',
        playbackUrl: null,
      });
      void logEvent('practice_start', { ordinal: 1, continued: false, without_video: true, from_reading: true });
      // 분석을 기다릴 것이 없어 회차 id 없이 연다 — 코치 화면이 방금 든 회차로 바로 대화한다(talk 와 같은 길).
      router.push({ pathname: '/coach', params: { purpose: 'reading' } });
    } catch (e) {
      const code = (e as { code?: unknown } | null)?.code;
      setError(code === 'reading_voice_not_enough_audio' ? t('reading.voiceCoachNotEnough') : t('reading.voiceCoachFailed'));
    } finally {
      lockRef.current = false;
      setStarting(false);
    }
  };

  if (!(wantCoach && coachOn) && !(wantReport && reportOn)) return null;
  return (
    <View style={styles.wrap}>
      {wantCoach && coachOn && (
        <View style={styles.card}>
          <Text style={styles.title}>{t('reading.voiceCoachTitle')}</Text>
          <Text style={styles.sub}>{t('reading.voiceCoachSub')}</Text>
          <Pressable
            onPress={() => void startCoaching()}
            disabled={starting}
            accessibilityRole="button"
            accessibilityLabel={t('reading.voiceCoachCta')}
            ph-label="reading_voice_coach_open"
            style={({ pressed }) => [styles.cta, (pressed || starting) && styles.pressed]}>
            <Feather name="message-circle" size={16} color={palette.onAccent} />
            <Text style={styles.ctaText}>{starting ? t('reading.voiceCoachStarting') : t('reading.voiceCoachCta')}</Text>
          </Pressable>
          {error ? <Text style={styles.errorText}>{error}</Text> : null}
        </View>
      )}
      {wantReport && reportOn && (
        <Pressable
          onPress={() => router.push({ pathname: '/reading/pronunciation', params: { sessionId } })}
          accessibilityRole="button"
          accessibilityLabel={t('reading.pronReportGet')}
          ph-label="reading_pron_report_open"
          style={({ pressed }) => [styles.row, pressed && styles.pressed]}>
          <Text style={styles.rowText}>{t('reading.pronReportGet')}</Text>
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
  wrap: { alignSelf: 'stretch', gap: 6, marginTop: 8 },
  card: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 20, gap: 6 },
  title: { color: palette.text, fontSize: 17, fontWeight: '700', lineHeight: 24 },
  sub: { color: palette.textDim, fontSize: 14, lineHeight: 21 },
  cta: {
    marginTop: 10,
    minHeight: 44,
    alignSelf: 'flex-start',
    flexDirection: 'row',
    alignItems: 'center',
    gap: 6,
    backgroundColor: palette.blue,
    borderRadius: 12,
    paddingHorizontal: 16,
    paddingVertical: 10,
  },
  errorText: { fontSize: 13, lineHeight: 19, color: palette.textDim },
  ctaText: { color: palette.onAccent, fontSize: 15, fontWeight: '700' },
  row: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 14, paddingHorizontal: 8 },
  rowText: { color: palette.textDim, fontSize: 15, fontWeight: '600' },
  pro: { backgroundColor: palette.navy, borderRadius: 6, paddingHorizontal: 6, paddingVertical: 2 },
  proText: { color: palette.onAccent, fontSize: 11, fontWeight: '800' },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
});
