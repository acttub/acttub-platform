import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachBubble } from '@/components/ui/mascot-bubble';
import { ChoiceCard } from '@/components/choice-card';
import { PrimaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { TALK_PURPOSES, type TalkPurpose } from '@/lib/practice/session-purpose';
import { startPractice } from '@/lib/practice/session-state';
import { inProgressPracticeId, startFailure } from '@/lib/practice/start';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';

/**
 * 세션 목적 · 영상 없이(pen 「목적 · 영상 없이」, SOMA-745).
 *
 * 코칭 탭의 「영상 없이 말로 코칭 받기」가 연다. 단계 표시가 없고, 목적 한 줄을 고르고(기본 선택 없음) 아래 「다음」을 누르면 영상 없이 시작해
 * 코치 대화로 간다(선택 규칙). 서버는 분석 없이 대화 단계 회차를 만든다.
 */
export default function TalkScreen() {
  const router = useRouter();
  const [picked, setPicked] = useState<TalkPurpose | null>(null);
  const [starting, setStarting] = useState<TalkPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const lockRef = useRef(false);

  const start = async (purpose: TalkPurpose) => {
    if (lockRef.current) return;
    lockRef.current = true;
    setStarting(purpose);
    setError(null);
    try {
      // 같은 목적을 다시 누르면(이중 탭·재시도) 같은 요청 id 라 회차가 하나만 생긴다.
      const attempt = attemptFor(attemptRef.current, purpose, newRequestId);
      attemptRef.current = attempt;
      const practice = await api.createPractice({ request_id: attempt.requestId, session_purpose: purpose });
      startPractice({
        practiceId: practice.id,
        rootId: practice.root_id,
        ordinal: practice.ordinal,
        conversationId: null,
        scene: { situation: '', character: '', goal: '' },
        videoUri: '',
        playbackUrl: null,
      });
      void logEvent('practice_start', { ordinal: 1, continued: false, without_video: true });
      // 분석을 기다릴 것이 없어 회차 id 없이 연다 — 코치 화면이 방금 든 회차로 바로 대화한다.
      router.replace('/coach');
    } catch (e) {
      const failure = startFailure(e);
      if (failure.kind === 'in_progress') {
        const open = await api
          .listPracticeGroups('all')
          .then(({ groups }) => inProgressPracticeId(groups))
          .catch(() => null);
        if (open) {
          router.replace({ pathname: '/coach', params: { practiceId: open } });
          return;
        }
      }
      setError(failure.kind === 'offline' ? t('start.offline') : t('talk.failed'));
    } finally {
      lockRef.current = false;
      setStarting(null);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('talk.title'), headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <CoachBubble title={t('talk.bubble')} guide={t('talk.guide')} />
        <View style={styles.choices}>
          {TALK_PURPOSES.map((item) => (
            <ChoiceCard
              key={item}
              title={t(`talk.purpose.${item}`)}
              sub={t(`talk.purposeSub.${item}`)}
              selected={picked === item}
              disabled={starting !== null}
              phLabel={`talk_purpose_${item}`}
              onPress={() => setPicked(item)}
            />
          ))}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
      <View style={styles.footer}>
        <PrimaryButton label={t('talk.next')} phLabel="talk_next" disabled={!picked || starting !== null} onPress={() => picked && void start(picked)} />
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, paddingTop: 16, paddingHorizontal: 24, paddingBottom: 24, gap: 14 },
  choices: { gap: 8, marginTop: 14 },
  footer: { paddingHorizontal: 24, paddingBottom: 12 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
});
