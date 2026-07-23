import { useHeaderHeight } from '@react-navigation/elements';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  KeyboardAvoidingView,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { attemptCoachStart, canSendCoachMessage } from '@/lib/coach-flow';
import { getPractice } from '@/lib/practice';
import { palette } from '@/constants/palette';
import type { MicButtonProps } from '@/components/mic-button';

// 네이티브 모듈이 없는 빌드(STT 도입 전 dev client)에서도 화면이 뜨도록 가드해서 로드한다.
let MicButton: ComponentType<MicButtonProps> | null = null;
try {
  MicButton = (require('@/components/mic-button') as typeof import('@/components/mic-button'))
    .MicButton;
} catch {
  MicButton = null;
}

type ChatMessage = {
  role: 'ai' | 'actor';
  text: string;
  focus?: string | null; // ai 메시지가 가리키는 영상 구간 (예: "00:48")
};

/**
 * 코치 대화 — 영상은 위에 고정, 아래 대화는 전체 스레드를 스크롤해서 볼 수 있다.
 * 전체 대화는 practice.turns에도 쌓여 리포트 생성에 쓰인다.
 * 키보드: Android는 softwareKeyboardLayoutMode=resize가 처리하므로 iOS만 padding 보정.
 */
export default function CoachScreen() {
  const router = useRouter();
  const headerHeight = useHeaderHeight();
  const practice = getPractice();
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    practice ? practice.turns.map((t) => ({ role: t.role, text: t.text })) : [],
  );
  const [input, setInput] = useState('');
  const [waiting, setWaiting] = useState(true);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 사용자가 올린 원본(또는 서버 재생 URL) 영상을 재생한다 (practice.videoUri).
  const player = useVideoPlayer(practice?.videoUri ?? null, (p) => {
    p.loop = false;
  });

  const startCoach = useCallback(async () => {
    if (!practice || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setWaiting(true);
    setError(null);
    const result = await attemptCoachStart(practice.summaryId, api.coachStart);
    if (mountedRef.current) {
      if (result.ok) {
        const reply = result.response;
        practice.coachSessionId = reply.session_id;
        practice.questionCount = 1;
        practice.turns.push({ role: 'ai', text: reply.utterance });
        setMessages((m) => [
          ...m,
          { role: 'ai', text: reply.utterance, focus: reply.focus_timestamp },
        ]);
        if (reply.done) {
          practice.closeReason = reply.reason ?? '';
          setDone(true);
        }
      } else {
        setError(result.message);
      }
      setWaiting(false);
    }
    startInFlightRef.current = false;
  }, [practice]);

  useEffect(() => {
    mountedRef.current = true;
    void startCoach();
    return () => {
      mountedRef.current = false;
    };
    // practice는 화면 생애 동안 동일한 모듈 스토어 객체
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 새 메시지가 오거나 대기 표시가 뜨면 맨 아래로 스크롤한다.
  useEffect(() => {
    const t = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(t);
  }, [messages, waiting]);

  if (!practice) {
    return (
      <SafeAreaView style={styles.safe}>
        <Text style={styles.errorText}>진행 중인 연습이 없어요. 홈에서 새로 시작해주세요.</Text>
      </SafeAreaView>
    );
  }

  const send = async () => {
    const text = input.trim();
    const canSend = canSendCoachMessage({
      text,
      waiting,
      done,
      coachSessionId: practice.coachSessionId,
    });
    if (!canSend || !practice.coachSessionId) return;
    setInput('');
    setError(null);
    practice.turns.push({ role: 'actor', text });
    setMessages((m) => [...m, { role: 'actor', text }]);
    setWaiting(true);
    try {
      const reply = await api.coachReply(practice.coachSessionId, text);
      practice.turns.push({ role: 'ai', text: reply.utterance });
      if (!reply.done) practice.questionCount += 1;
      setMessages((m) => [
        ...m,
        { role: 'ai', text: reply.utterance, focus: reply.focus_timestamp },
      ]);
      if (reply.done) {
        practice.closeReason = reply.reason ?? '';
        setDone(true);
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '전송에 실패했어요.');
    } finally {
      setWaiting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: '코치와 되짚기', headerBackVisible: false }} />
      <KeyboardAvoidingView
        style={styles.flex}
        behavior={Platform.OS === 'ios' ? 'padding' : undefined}
        keyboardVerticalOffset={Platform.OS === 'ios' ? headerHeight : 0}>
        {/* 영상: 위에 고정 (스크롤 안 됨) */}
        {practice.videoUri && (
          <VideoView
            style={styles.video}
            player={player}
            nativeControls
            allowsFullscreen
            contentFit="contain"
          />
        )}

        {/* 대화: 아래에서 드래그해 전체 스레드 보기 */}
        <ScrollView
          ref={scrollRef}
          style={styles.flex}
          contentContainerStyle={styles.chat}
          keyboardShouldPersistTaps="handled">
          {messages.map((m, i) =>
            m.role === 'ai' ? (
              <View key={i} style={styles.aiRow}>
                {!!m.focus && (
                  <View style={styles.focusChip}>
                    <Text style={styles.focusChipText}>🎬 영상 {m.focus} 부분</Text>
                  </View>
                )}
                <View style={styles.aiBubble}>
                  <Text style={styles.aiText}>{m.text}</Text>
                </View>
              </View>
            ) : (
              <View key={i} style={styles.actorBubble}>
                <Text style={styles.actorText}>{m.text}</Text>
              </View>
            ),
          )}

          {waiting && (
            <View style={styles.aiRow}>
              <View style={[styles.aiBubble, styles.waitingBubble]}>
                <ActivityIndicator color={palette.blue} size="small" />
                <Text style={styles.waitingText}>
                  {messages.length > 0 ? '답을 듣고 생각 중이에요…' : '영상을 마저 정리하고 있어요…'}
                </Text>
              </View>
            </View>
          )}

          {!waiting && !done && (
            <Text style={styles.hint}>정답은 없어요. 그 순간 어땠는지 떠오르는 대로 답해보세요.</Text>
          )}
        </ScrollView>

        {error && (
          <View>
            <Text style={styles.errorText}>{error}</Text>
            {!practice.coachSessionId && !waiting && (
              <Pressable style={styles.startRetry} onPress={() => void startCoach()}>
                <Text style={styles.startRetryText}>코치 다시 연결하기</Text>
              </Pressable>
            )}
          </View>
        )}

        {done ? (
          <Pressable style={styles.reportButton} onPress={() => router.push('/report')}>
            <Text style={styles.reportButtonText}>피드백 카드 보기</Text>
          </Pressable>
        ) : (
          <View style={styles.inputRow}>
            {MicButton && (
              <MicButton
                onText={setInput}
                disabled={waiting || !practice.coachSessionId}
              />
            )}
            <TextInput
              style={styles.input}
              placeholder="떠오르는 대로 편하게 답해보세요"
              placeholderTextColor={palette.textDim}
              value={input}
              onChangeText={setInput}
              multiline
              editable={!waiting && !!practice.coachSessionId}
            />
            <Pressable
              style={[
                styles.sendButton,
                !canSendCoachMessage({
                  text: input,
                  waiting,
                  done,
                  coachSessionId: practice.coachSessionId,
                }) && styles.sendDisabled,
              ]}
              onPress={send}
              disabled={
                !canSendCoachMessage({
                  text: input,
                  waiting,
                  done,
                  coachSessionId: practice.coachSessionId,
                })
              }>
              <Text style={styles.sendText}>보내기</Text>
            </Pressable>
          </View>
        )}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#111827',
  },
  chat: { padding: 16, gap: 12, flexGrow: 1 },
  aiRow: { alignSelf: 'flex-start', maxWidth: '85%', gap: 6 },
  focusChip: {
    alignSelf: 'flex-start',
    backgroundColor: palette.blueSoft,
    borderRadius: 8,
    paddingHorizontal: 8,
    paddingVertical: 3,
  },
  focusChipText: { fontSize: 12, fontWeight: '700', color: palette.blueDeep },
  aiBubble: {
    backgroundColor: palette.card,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 18,
    borderTopLeftRadius: 6,
    padding: 14,
  },
  aiText: { fontSize: 16, color: palette.text, lineHeight: 24 },
  waitingBubble: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  waitingText: { fontSize: 14, color: palette.textDim },
  actorBubble: {
    alignSelf: 'flex-end',
    maxWidth: '85%',
    backgroundColor: palette.blue,
    borderRadius: 18,
    borderTopRightRadius: 6,
    padding: 12,
  },
  actorText: { color: '#FFFFFF', fontSize: 15, lineHeight: 21 },
  hint: { fontSize: 12, color: palette.textDim, textAlign: 'center', marginTop: 4 },
  errorText: { color: palette.danger, textAlign: 'center', padding: 8 },
  startRetry: { alignSelf: 'center', paddingHorizontal: 16, paddingBottom: 8 },
  startRetryText: { color: palette.blue, fontSize: 14, fontWeight: '700' },
  inputRow: { flexDirection: 'row', padding: 10, gap: 8, alignItems: 'flex-end' },
  input: {
    flex: 1,
    backgroundColor: palette.bgSoft,
    borderRadius: 22,
    paddingHorizontal: 16,
    paddingVertical: 10,
    color: palette.text,
    fontSize: 15,
    maxHeight: 100,
  },
  sendButton: {
    backgroundColor: palette.blue,
    borderRadius: 22,
    paddingHorizontal: 18,
    paddingVertical: 12,
  },
  sendDisabled: { opacity: 0.4 },
  sendText: { color: '#fff', fontWeight: '700' },
  reportButton: {
    margin: 12,
    backgroundColor: palette.blue,
    borderRadius: 16,
    padding: 17,
    alignItems: 'center',
  },
  reportButtonText: { color: '#FFFFFF', fontSize: 16, fontWeight: '800' },
});
