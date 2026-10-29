import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import { ScrollView, StyleSheet, View } from 'react-native';

import { CoachingLimitSheet } from '@/components/pro-ui';
import { CoachBubble } from '@/components/ui/mascot-bubble';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineErrorLine } from '@/components/ui/inline-error';
import { SelectCard } from '@/components/ui/select-card';
import { palette } from '@/constants/palette';
import { space } from '@/constants/tokens';
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
  // 첫 항목을 미리 골라 둔다(UX 가이드 5절, 10/23).
  const [picked, setPicked] = useState<TalkPurpose | null>(TALK_PURPOSES[0] ?? null);
  const [starting, setStarting] = useState<TalkPurpose | null>(null);
  const [error, setError] = useState<string | null>(null);
  // 무료 코칭 하루 3회를 다 썼다(SOMA-818) — pen a5y1Qr 시트.
  const [freeLimit, setFreeLimit] = useState(false);
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
      if (failure.kind === 'free_limit') {
        setFreeLimit(true);
        return;
      }
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
      setError(failure.kind === 'offline' ? t('start.offline') : failure.kind === 'in_progress' ? t('talk.inProgressMissing') : t('talk.failed'));
    } finally {
      lockRef.current = false;
      setStarting(null);
    }
  };

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ title: t('talk.title'), headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <CoachBubble title={t('talk.bubble')} guide={t('talk.guide')} />
        <View style={styles.choices}>
          {TALK_PURPOSES.map((item) => (
            <SelectCard
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
        {error ? <InlineErrorLine message={error} /> : null}
      </ScrollView>
      <CoachingLimitSheet visible={freeLimit} onClose={() => setFreeLimit(false)} />
      <CtaBar>
        <PrimaryButton
          label={t('talk.next')}
          phLabel="talk_next"
          disabled={!picked}
          loading={starting !== null}
          loadingLabel={t('loadingText.starting')}
          onPress={() => picked && void start(picked)}
        />
      </CtaBar>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { flexGrow: 1, paddingTop: space[4], paddingHorizontal: space.gutter, paddingBottom: space[6], gap: space[3] },
  choices: { gap: space[3] },
});
