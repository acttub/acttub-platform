import Feather from '@expo/vector-icons/Feather';
import { Image } from 'expo-image';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';

import { KeyboardLift } from '@/components/keyboard-lift';
import { PrimaryButton, SecondaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InlineError } from '@/components/ui/inline-error';
import { MASCOT, MASCOT_SIZE } from '@/components/ui/mascot';
import { StatusScreen } from '@/components/ui/status-screen';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import {
  RECORDING_COACH_REPLY_MAX,
  recordingCoachFailure,
  type RecordingCoach,
  type RecordingCoachFailure,
} from '@/lib/reading/recording-coach';

/**
 * 리딩 녹음 코치(SOMA-791, 실험·무료) — 리딩 완료 화면 카드에서 온다. 코치가 녹음에서 들린 것 하나와 질문 하나를 하고,
 * 배우가 답하면 둘째 차례에서 그 한 줄을 영상으로 찍어 보자고 권한다(`video_line`). 대화는 회차마다 하나라 다시 열면
 * 같은 대화가 나온다. 모델을 요청 안에서 불러 첫 차례·둘째 차례 모두 수십 초 걸릴 수 있다.
 */
export default function ReadingCoachScreen() {
  const router = useRouter();
  const { sessionId } = useLocalSearchParams<{ sessionId?: string }>();
  const [coach, setCoach] = useState<RecordingCoach | null>(null);
  const [failure, setFailure] = useState<RecordingCoachFailure | null>(null);
  const [busy, setBusy] = useState(false);
  const [input, setInput] = useState('');
  const mounted = useRef(true);
  const scrollRef = useRef<ScrollView>(null);

  const start = useCallback(async () => {
    if (!sessionId) return;
    setBusy(true);
    setFailure(null);
    try {
      const next = await api.startRecordingCoach(sessionId);
      if (mounted.current) setCoach(next);
    } catch (error) {
      if (mounted.current) setFailure(recordingCoachFailure(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  }, [sessionId]);

  useEffect(() => {
    mounted.current = true;
    void start();
    return () => {
      mounted.current = false;
    };
  }, [start]);

  const send = async () => {
    const text = input.trim();
    if (!coach || !text || text.length > RECORDING_COACH_REPLY_MAX || busy) return;
    setBusy(true);
    setFailure(null);
    try {
      const next = await api.replyRecordingCoach(coach.id, text);
      if (!mounted.current) return;
      setCoach(next);
      setInput('');
    } catch (error) {
      if (mounted.current) setFailure(recordingCoachFailure(error));
    } finally {
      if (mounted.current) setBusy(false);
    }
  };

  const canSend = !!coach && coach.status === 'asked' && !!input.trim() && input.trim().length <= RECORDING_COACH_REPLY_MAX && !busy;
  const answered = coach?.status === 'answered';
  const close = () => router.back();
  const screenFailure = failure && (!coach || failure === 'not_enough_audio' || failure === 'gone') ? failure : null;
  const retryable = failure === 'unavailable' || failure === 'other';

  const header = (
    <Stack.Screen
      options={{
        title: t('readingCoach.title'),
        headerRight: () => (
          <Pressable onPress={close} hitSlop={8} accessibilityRole="button" ph-label="reading_coach_quit" style={styles.quitButton}>
            <Text style={styles.quit}>{t('readingCoach.quit')}</Text>
          </Pressable>
        ),
      }}
    />
  );

  if (!sessionId || screenFailure) {
    const kind = screenFailure ?? 'gone';
    return (
      <>
        {header}
        <StatusScreen
          kind={retryable && screenFailure ? 'error' : 'empty'}
          mascot={retryable && screenFailure ? MASCOT.dizzy : MASCOT.coach}
          title={t(`readingCoach.fail_${kind}`)}
          body={sessionId ? t(`readingCoach.failBody_${kind}`) : t('readingCoach.noSessionBody')}
          primary={retryable && screenFailure ? { label: t('readingCoach.retry'), onPress: () => void start(), loading: busy } : undefined}
          secondary={retryable && screenFailure ? undefined : { label: t('readingCoach.close'), onPress: close }}
        />
      </>
    );
  }

  return (
    <KeyboardLift style={styles.root} aboveSafeBottom>
      {header}
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        keyboardShouldPersistTaps="handled"
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {!coach && busy && (
          <View style={styles.waiting}>
            <Image source={MASCOT.coach} style={MASCOT_SIZE.lg} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.waitingText}>{t('readingCoach.listening')}</Text>
          </View>
        )}
        {coach?.messages.map((m, i) =>
          m.role === 'coach' ? (
            <View key={i} style={styles.coachRow}>
              <Image source={MASCOT.coach} style={MASCOT_SIZE.chat} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
              <View style={styles.coachCol}>
                <Text style={styles.coachName}>{t('readingCoach.coachName')}</Text>
                <View style={[styles.bubble, styles.coachBubble]}>
                  <Text style={styles.bubbleText}>{m.text}</Text>
                </View>
              </View>
            </View>
          ) : (
            <View key={i} style={[styles.bubble, styles.actorBubble]}>
              <Text style={[styles.bubbleText, styles.actorText]}>{m.text}</Text>
            </View>
          ),
        )}
        {coach && busy && <Text style={styles.thinkingText}>{t('readingCoach.thinking')}</Text>}
        {coach && failure && !busy && (
          <InlineError message={t('readingCoach.replyFailed')} onRetry={() => void send()} />
        )}
        {answered && coach?.video_line && (
          <View style={styles.videoCard}>
            <Text style={styles.videoTitle}>{t('readingCoach.videoTitle')}</Text>
            <Text style={styles.videoLine}>{`「${coach.video_line.text}」`}</Text>
          </View>
        )}
      </ScrollView>

      {answered ? (
        <CtaBar>
          {coach?.video_line ? (
            <>
              <TextButton label={t('readingCoach.later')} phLabel="reading_coach_later" onPress={close} />
              <PrimaryButton
                label={t('readingCoach.recordLine')}
                phLabel="reading_coach_record_line"
                onPress={() => router.push({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } })}
              />
            </>
          ) : (
            <SecondaryButton label={t('readingCoach.close')} phLabel="reading_coach_close" onPress={close} />
          )}
        </CtaBar>
      ) : coach ? (
        <CtaBar style={styles.composer}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('readingCoach.inputPh')}
            placeholderTextColor={palette.textMeta}
            accessibilityLabel={t('readingCoach.inputPh')}
            multiline
            maxLength={RECORDING_COACH_REPLY_MAX}
            editable={!busy}
          />
          <Pressable
            onPress={() => void send()}
            disabled={!canSend}
            accessibilityRole="button"
            accessibilityLabel={t('readingCoach.send')}
            ph-label="reading_coach_send"
            style={[styles.send, !canSend && styles.sendOff]}>
            <Feather name="arrow-up" size={20} color={canSend ? palette.onAccent : palette.textDisabled} />
          </Pressable>
        </CtaBar>
      ) : null}
    </KeyboardLift>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: space.gutter, paddingVertical: space[4], gap: space[3] },
  quitButton: { height: 44, paddingHorizontal: space[2], justifyContent: 'center' },
  quit: { ...type.body2Bold, color: palette.textSub },
  waiting: { alignItems: 'center', gap: space[4], paddingTop: 96 },
  waitingText: { ...type.body2, color: palette.textSub, textAlign: 'center' },
  coachRow: { flexDirection: 'row', alignItems: 'flex-start', gap: space[2], maxWidth: '85%' },
  coachCol: { flexShrink: 1, gap: space[1] },
  coachName: { ...type.captionBold, color: palette.text },
  bubble: { borderRadius: radius.lg, paddingVertical: space[3], paddingHorizontal: space[4] },
  coachBubble: { backgroundColor: palette.bgSoft, borderTopLeftRadius: radius.xs },
  actorBubble: { alignSelf: 'flex-end', maxWidth: '85%', backgroundColor: palette.blueDeep, borderTopRightRadius: radius.xs },
  bubbleText: { ...type.body1, color: palette.text },
  actorText: { color: palette.onAccent },
  thinkingText: { ...type.body2, color: palette.textMeta },
  videoCard: { backgroundColor: palette.blueSoft, borderRadius: radius.lg, padding: space[4], gap: space[2] },
  videoTitle: { ...type.body2Bold, color: palette.blueDeep },
  videoLine: { ...type.headline, color: palette.text },
  composer: { flexDirection: 'row', alignItems: 'flex-end' },
  input: { flex: 1, ...type.body1, minHeight: 44, maxHeight: 140, borderRadius: radius.full, backgroundColor: palette.bgSoft, paddingHorizontal: space[4], paddingTop: space[3] - 2, paddingBottom: space[3] - 2, color: palette.text },
  send: { width: 40, height: 40, marginBottom: 2, borderRadius: radius.full, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blue },
  sendOff: { backgroundColor: palette.border },
});
