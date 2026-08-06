import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  TextInput,
  View,
  useWindowDimensions,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { api } from '@/lib/api';
import { attemptCoachStart, canSendCoachMessage } from '@/lib/coach-flow';
import { getPractice } from '@/lib/practice';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
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
};

/**
 * 코치 대화 — 영상은 위에 고정, 아래 대화는 전체 스레드를 스크롤해서 볼 수 있다.
 * 전체 대화는 practice.turns에도 쌓여 리포트 생성에 쓰인다.
 * 키보드가 올라오면 영상을 접는다 — 안 그러면 화면 위쪽을 영상이 차지한 채 입력칸이 키보드에
 * 가려 자기가 뭘 치는지 안 보인다. 영상은 키보드를 내리면 그대로 돌아온다(플레이어는 유지).
 */
export default function CoachScreen() {
  const router = useRouter();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;
  const { width: windowWidth } = useWindowDimensions();
  const practice = getPractice();
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  const [messages, setMessages] = useState<ChatMessage[]>(() =>
    practice ? practice.turns.map((t) => ({ role: t.role, text: t.text })) : [],
  );
  const [input, setInput] = useState('');
  const [connecting, setConnecting] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 사용자가 올린 원본(또는 서버 재생 URL) 영상을 재생한다 (practice.videoUri).
  const player = useVideoPlayer(practice?.videoUri ?? null, (p) => {
    p.loop = false;
  });

  const startCoach = useCallback(async () => {
    if (!practice || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setConnecting(true);
    setError(null);
    const result = await attemptCoachStart(practice.practiceSessionId, api.coachStart);
    if (mountedRef.current) {
      if (result.ok) {
        const reply = result.response;
        practice.coachSessionId = reply.session_id;
        // 서버는 열린 대화가 있으면 그대로 돌려준다. 앱을 껐다 켜도 하던 대화가
        // 이어지도록 지난 턴을 화면에 복원한다 — 안 하면 빈 화면에서 다시 시작한
        // 것처럼 보이는데 서버는 이어받은 상태라 질문이 중간부터 나온다.
        const restored = reply.turns ?? [];
        practice.turns = [...restored];
        practice.questionCount = restored.filter((turn) => turn.role === 'ai').length;
        setMessages(restored.map((turn) => ({ role: turn.role, text: turn.text })));
        if (reply.message !== null && !restored.some((t) => t.text === reply.message)) {
          practice.turns.push({ role: 'ai', text: reply.message });
          setMessages((m) => [...m, { role: 'ai', text: reply.message as string }]);
        }
        if (reply.status === 'complete') {
          setDone(true);
          // 카드는 대화가 정리되는 순간 응답에 실려 온다(웹과 같은 계약).
          // 따로 확인받지 않고 바로 넘긴다.
          if (reply.report) {
            practice.report = reply.report;
            router.replace('/report');
          }
        }
      } else {
        setError(result.message);
      }
      setConnecting(false);
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

  // 키보드가 올라오면 레이아웃이 줄어드니 마지막 메시지가 가려지지 않게 끝으로 스크롤한다.
  useEffect(() => {
    if (!keyboardVisible) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [keyboardVisible]);

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
      const message = reply.message;
      if (message !== null) {
        practice.turns.push({ role: 'ai', text: message });
        if (reply.status !== 'complete') practice.questionCount += 1;
        setMessages((m) => [...m, { role: 'ai', text: message }]);
      }
      if (reply.status === 'complete') {
        setDone(true);
        if (reply.report) {
          practice.report = reply.report;
          router.replace('/report');
        }
      }
    } catch (err) {
      setError(err instanceof Error ? err.message : '전송에 실패했어요.');
    } finally {
      setWaiting(false);
    }
  };

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen options={{ title: '코치와 되짚기', headerBackVisible: false }} />
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        {/* 영상: 위에 고정 (스크롤 안 됨) */}
        {practice.videoUri && (
          <VideoView
            // 키보드가 뜨면 높이를 0으로 접어 대화와 입력칸에 자리를 내준다.
            style={[styles.video, { height: keyboardVisible ? 0 : (windowWidth * 9) / 16 }]}
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

        </ScrollView>

        {error && (
          <View>
            <Text style={styles.errorText}>{error}</Text>
            {!practice.coachSessionId && !waiting && !connecting && (
              <Pressable style={styles.startRetry} onPress={() => void startCoach()}>
                <Text style={styles.startRetryText}>코치 다시 연결하기</Text>
              </Pressable>
            )}
          </View>
        )}

        {done ? (
          <View>
            {/* status 는 complete 인데 카드가 안 온 경우(막힌 대화 등). 확인 단계를
                따로 두지 않는다 — 웹도 카드가 오면 바로 넘어간다. */}
            <Text style={styles.confirmTitle}>
              오늘 대화는 여기까지예요. 정리가 만들어지면 바로 보여드릴게요.
            </Text>
          </View>
        ) : (
          <View>
            <Text style={styles.composerHint}>막히는 대목을 그대로 적어 주세요.</Text>
            <View style={styles.inputRow}>
              {MicButton && (
                <MicButton
                  onText={setInput}
                  disabled={connecting || waiting || !practice.coachSessionId}
                />
              )}
              <TextInput
                style={styles.input}
                placeholder="떠오르는 대로 편하게 답해보세요"
                placeholderTextColor={palette.textDim}
                value={input}
                onChangeText={setInput}
                multiline
                editable={!connecting && !waiting && !!practice.coachSessionId}
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
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  video: {
    width: '100%',
    backgroundColor: '#111827',
  },
  chat: { padding: 16, gap: 12, flexGrow: 1 },
  aiRow: { alignSelf: 'flex-start', maxWidth: '85%', gap: 6 },
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
  composerHint: {
    paddingHorizontal: 16,
    paddingTop: 8,
    fontSize: 12,
    color: palette.textDim,
  },
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
  confirmTitle: {
    color: palette.text,
    fontSize: 15,
    fontWeight: '800',
    textAlign: 'center',
    marginTop: 12,
  },
});
