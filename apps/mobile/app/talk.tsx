import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { CoachBubble } from '@/components/ui/mascot-bubble';
import { IconOptionRow as ChoiceRow } from '@/components/ui/option-card';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import { DEFAULT_TALK_PURPOSE, TALK_PURPOSES, type TalkPurpose } from '@/lib/practice/session-purpose';
import { startPractice } from '@/lib/practice/session-state';
import { inProgressPracticeId, startFailure } from '@/lib/practice/start';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';

const PURPOSE_ICON: Record<TalkPurpose, 'unlock' | 'book-open' | 'message-circle'> = {
  stuck: 'unlock',
  character: 'book-open',
  concern: 'message-circle',
};

/**
 * 세션 목적 · 영상 없이(pen 「목적 · 영상 없이」, SOMA-745).
 *
 * 코칭 탭의 「영상 없이 말로 코칭 받기」가 연다. 단계 표시가 없고, 목적 한 줄을 누르면 「다음」 없이 바로 영상 없이 시작해
 * 코치 대화로 간다(준비 화면 P3.1 의 목적 줄과 같은 모양). 막힌 곳 풀기가 기본 강조다. 서버는 분석 없이 대화 단계 회차를 만든다.
 */
export default function TalkScreen() {
  const router = useRouter();
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
        <CoachBubble title={t('talk.bubble')} guide={null} />
        <View style={styles.choices}>
          {TALK_PURPOSES.map((item) => (
            <ChoiceRow
              key={item}
              icon={PURPOSE_ICON[item]}
              title={t(`talk.purpose.${item}`)}
              sub={t(`talk.purposeSub.${item}`)}
              highlight={item === DEFAULT_TALK_PURPOSE}
              selected={starting === item}
              disabled={starting !== null}
              mark="none"
              phLabel={`talk_purpose_${item}`}
              onPress={() => void start(item)}
            />
          ))}
        </View>
        {error ? <Text style={styles.errorText}>{error}</Text> : null}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 21, paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  choices: { gap: 4 },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },
});
