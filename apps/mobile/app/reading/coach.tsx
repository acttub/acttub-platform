import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { KeyboardAvoidingView, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { palette } from '@/constants/palette';
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
  const insets = useSafeAreaInsets();
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

  const failureText = failure ? t(`readingCoach.fail_${failure}`) : null;
  const canSend = !!coach && coach.status === 'asked' && !!input.trim() && input.trim().length <= RECORDING_COACH_REPLY_MAX && !busy;
  const answered = coach?.status === 'answered';

  return (
    <KeyboardAvoidingView style={styles.root} behavior={Platform.OS === 'ios' ? 'padding' : undefined} keyboardVerticalOffset={88}>
      {/* pen R13 — 가운데 「액티와 얘기하기」, 오른쪽 「그만하기」 */}
      <Stack.Screen
        options={{
          title: t('readingCoach.title'),
          headerRight: () => (
            <Pressable onPress={() => router.back()} hitSlop={8} accessibilityRole="button" ph-label="reading_coach_quit" style={styles.quitButton}>
              <Text style={styles.quit}>{t('readingCoach.quit')}</Text>
            </Pressable>
          ),
        }}
      />
      <ScrollView
        ref={scrollRef}
        contentContainerStyle={styles.body}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {!coach && busy && (
          <View style={styles.waiting}>
            <Text style={styles.waitingText}>{t('readingCoach.listening')}</Text>
          </View>
        )}
        {coach?.messages.map((m, i) => (
          <View key={i} style={[styles.bubble, m.role === 'coach' ? styles.coachBubble : styles.actorBubble]}>
            {m.role === 'coach' && <Text style={styles.coachName}>{t('readingCoach.coachName')}</Text>}
            <Text style={[styles.bubbleText, m.role === 'actor' && styles.actorText]}>{m.text}</Text>
          </View>
        ))}
        {coach && busy && (
          <View style={styles.thinking}>
            <Text style={styles.thinkingText}>{t('readingCoach.thinking')}</Text>
          </View>
        )}
        {failureText && (
          <View style={styles.failure}>
            <Text style={styles.failureText}>{failureText}</Text>
            {(failure === 'unavailable' || failure === 'other') && (
              <Pressable onPress={() => void (coach ? send() : start())} hitSlop={8} accessibilityRole="button">
                <Text style={styles.retry}>{t('readingCoach.retry')}</Text>
              </Pressable>
            )}
          </View>
        )}
        {answered && coach?.video_line && (
          <View style={styles.videoCard}>
            <Text style={styles.videoTitle}>{t('readingCoach.videoTitle')}</Text>
            <Text style={styles.videoLine}>{`「${coach.video_line.text}」`}</Text>
          </View>
        )}
      </ScrollView>

      {answered || failure === 'not_enough_audio' || failure === 'gone' ? (
        <View style={[styles.footer, { paddingBottom: insets.bottom + 12 }]}>
          {answered && coach?.video_line ? (
            <>
              <PrimaryButton
                label={t('readingCoach.recordLine')}
                phLabel="reading_coach_record_line"
                onPress={() => router.push({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } })}
              />
              <SecondaryButton label={t('readingCoach.later')} phLabel="reading_coach_later" onPress={() => router.back()} />
            </>
          ) : (
            <SecondaryButton label={t('readingCoach.close')} phLabel="reading_coach_close" onPress={() => router.back()} />
          )}
        </View>
      ) : coach ? (
        <View style={[styles.composer, { paddingBottom: insets.bottom + 10 }]}>
          <TextInput
            style={styles.input}
            value={input}
            onChangeText={setInput}
            placeholder={t('readingCoach.inputPh')}
            placeholderTextColor={palette.textFaint}
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
            <Text style={styles.sendText}>{t('readingCoach.send')}</Text>
          </Pressable>
        </View>
      ) : null}
    </KeyboardAvoidingView>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  body: { paddingHorizontal: 24, paddingVertical: 20, gap: 14 },
  // 글자 버튼도 아이콘 칸(NavIconButton)처럼 높이 44·좌우 10 을 둬 화면 끝에서 떨어뜨린다(SOMA-837).
  quitButton: { height: 44, paddingHorizontal: 10, justifyContent: 'center' },
  quit: { color: palette.textMuted, fontSize: 15, fontWeight: '600' },
  waiting: { alignItems: 'center', gap: 12, paddingVertical: 48 },
  waitingText: { color: palette.textDim, fontSize: 15, lineHeight: 22, textAlign: 'center' },
  bubble: { maxWidth: '88%', borderRadius: 18, paddingHorizontal: 16, paddingVertical: 12, gap: 4 },
  coachBubble: { alignSelf: 'flex-start', backgroundColor: palette.bgSoft },
  actorBubble: { alignSelf: 'flex-end', backgroundColor: palette.blue },
  coachName: { color: palette.coachName, fontSize: 12, fontWeight: '700' },
  bubbleText: { color: palette.text, fontSize: 16, lineHeight: 24 },
  actorText: { color: palette.onAccent },
  thinking: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  thinkingText: { color: palette.textMuted, fontSize: 14 },
  failure: { gap: 8, paddingVertical: 4 },
  failureText: { color: palette.textDim, fontSize: 15, lineHeight: 22 },
  retry: { color: palette.blueDeep, fontSize: 15, fontWeight: '700' },
  videoCard: { backgroundColor: palette.blueSoft, borderRadius: 18, padding: 20, gap: 8, marginTop: 6 },
  videoTitle: { color: palette.blueDeep, fontSize: 14, fontWeight: '700' },
  videoLine: { color: palette.text, fontSize: 17, fontWeight: '600', lineHeight: 25 },
  footer: { paddingHorizontal: 24, paddingTop: 10, gap: 8, backgroundColor: palette.bg },
  composer: { flexDirection: 'row', alignItems: 'flex-end', gap: 8, paddingHorizontal: 16, paddingTop: 8, backgroundColor: palette.bg },
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 140,
    borderRadius: 22,
    backgroundColor: palette.bgSoft,
    paddingHorizontal: 16,
    paddingTop: 11,
    paddingBottom: 11,
    fontSize: 16,
    color: palette.text,
  },
  send: { height: 44, borderRadius: 22, paddingHorizontal: 16, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.blue },
  sendOff: { backgroundColor: palette.border },
  sendText: { color: palette.onAccent, fontSize: 15, fontWeight: '700' },
});
