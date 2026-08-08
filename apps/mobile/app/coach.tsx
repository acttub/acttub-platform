import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import {
  ActivityIndicator,
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
import { SceneFoldBody, SceneFoldLink } from '@/components/practice-chrome';
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
  const [pastOpen, setPastOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);

  // 영상 재생은 SceneFold(접이식)가 맡는다 — 목업이 질문에 집중하도록 접어 둔다.

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

  const latestQuestion = [...messages].reverse().find((m) => m.role === 'ai')?.text ?? null;
  const answered = messages.filter((m) => m.role === 'actor').length;
  const askedCount = messages.filter((m) => m.role === 'ai').length;
  const past = messages.slice(0, Math.max(0, messages.length - (latestQuestion ? 1 : 0)));
  const canSend = canSendCoachMessage({
    text: input,
    waiting,
    done,
    coachSessionId: practice.coachSessionId,
  });

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{
          title: practice.scene.situation.trim() || '질문 대화',
          headerShadowVisible: false,
        }}
      />
      <View style={styles.statusRow}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{done ? '정리 중' : '질문 중'}</Text>
        </View>
      </View>

      <View style={styles.strip}>
        <View style={styles.stripRow}>
          <View style={styles.stripText}>
            <Text style={styles.stripTitle}>영상과 장면 보기</Text>
            <Text style={styles.stripSub} numberOfLines={1}>
              {practice.scene.situation.trim() || '장면을 적지 않았어요'}
            </Text>
          </View>
          <SceneFoldLink
            open={sceneOpen}
            onToggle={() => setSceneOpen((was) => !was)}
            label=""
          />
        </View>
      </View>
      <SceneFoldBody open={sceneOpen} videoUri={practice.videoUri || practice.playbackUrl} />
      <View style={styles.progressHead}>
        <View style={styles.progressLeft}>
          <View style={styles.dots}>
            {[0, 1, 2, 3].map((i) => (
              <View key={i} style={[styles.dot, i < askedCount && styles.dotOn]} />
            ))}
          </View>
          <Text style={styles.progressText}>{ORDINAL[Math.min(askedCount, 5)] ?? '질문'}</Text>
        </View>
        {past.length > 0 && (
          <Pressable
            onPress={() => setPastOpen((was) => !was)}
            accessibilityRole="button"
            hitSlop={8}>
            <Text style={styles.pastToggle}>
              지난 문답 {Math.floor(past.length / 2)} {pastOpen ? '▴' : '▾'}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView
          ref={scrollRef}
          contentContainerStyle={styles.body}
          keyboardShouldPersistTaps="handled">
          {pastOpen &&
            past.map((message, index) => (
              <View
                key={`${index}-${message.text.slice(0, 8)}`}
                style={message.role === 'ai' ? styles.pastAi : styles.pastMine}>
                <Text style={styles.pastLabel}>
                  {message.role === 'ai' ? '코치' : '나'}
                </Text>
                <Text style={styles.pastText}>{message.text}</Text>
              </View>
            ))}

          {connecting && !latestQuestion ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.blue} />
              <Text style={styles.loadingText}>영상을 마저 정리하고 있어요…</Text>
            </View>
          ) : (
            <View style={styles.questionBlock}>
              {latestQuestion && <Text style={styles.question}>{latestQuestion}</Text>}
            </View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {error && !practice.coachSessionId && !waiting && !connecting && (
            <Pressable style={styles.retry} onPress={() => void startCoach()}>
              <Text style={styles.retryText}>코치 다시 연결하기</Text>
            </Pressable>
          )}

          {done && (
            <Text style={styles.doneText}>
              오늘 대화는 여기까지예요. 정리가 만들어지면 바로 보여드릴게요.
            </Text>
          )}
        </ScrollView>

        {!done && (
          <View style={styles.composer}>
            <View style={styles.composerLabelRow}>
              <Text style={styles.composerLabel}>기억나는 대로 적어 주세요</Text>
              <Text style={styles.counter}>{input.length} / 300</Text>
            </View>
            <View style={styles.inputRow}>
              {MicButton && (
                <MicButton
                  onText={setInput}
                  disabled={connecting || waiting || !practice.coachSessionId}
                />
              )}
              <TextInput
                style={styles.input}
                placeholder="예) 상대 얼굴에서 눈을 못 떼고 계속 보고 있었어요."
                placeholderTextColor={palette.checkOff}
                value={input}
                onChangeText={setInput}
                maxLength={300}
                multiline
                editable={!connecting && !waiting && !!practice.coachSessionId}
              />
            </View>
            <View style={styles.quickRow}>
              {['잘 모르겠어요', '제가 되물을게요'].map((label) => (
                <Pressable
                  key={label}
                  style={styles.quick}
                  disabled={waiting || connecting}
                  onPress={() => setInput(label)}
                  accessibilityRole="button">
                  <Text style={styles.quickText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.send, !canSend && styles.sendOff]}
              disabled={!canSend}
              onPress={() => void send()}
              accessibilityRole="button">
              <Text style={styles.sendText}>
                {waiting ? '답을 듣고 생각 중이에요…' : '이 답으로 다음 질문 →'}
              </Text>
            </Pressable>
            <Text style={styles.endHint}>‘그만’이라고 쓰면 언제든 마칠 수 있어요</Text>
          </View>
        )}
      </View>
    </SafeAreaView>
  );
}

const ORDINAL = ['첫 질문', '첫 질문', '두 번째 질문', '세 번째 질문', '네 번째 질문', '마지막 질문'];

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },

  statusRow: { alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 8 },
  statusChip: {
    backgroundColor: palette.blueSoft,
    borderRadius: 9999,
    paddingVertical: 5,
    paddingHorizontal: 10,
  },
  statusChipText: { fontSize: 11, fontWeight: '900', color: palette.blue },

  stripRow: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  stripText: { flex: 1, gap: 2 },
  stripTitle: { fontSize: 13, fontWeight: '900', color: palette.textStrong },
  stripSub: { fontSize: 11.5, fontWeight: '600', color: palette.textFaint },
  strip: {
    backgroundColor: palette.bgSubtle,
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    paddingVertical: 10,
    paddingHorizontal: 14,
  },

  progressHead: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    borderBottomWidth: 1,
    borderBottomColor: palette.borderSoft,
    paddingVertical: 11,
    paddingHorizontal: 16,
  },
  progressLeft: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  dots: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  dot: { width: 14, height: 3, borderRadius: 9999, backgroundColor: palette.border },
  dotOn: { width: 20, backgroundColor: palette.blue },
  progressText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  pastToggle: { fontSize: 12, fontWeight: '800', color: palette.textFaint },

  body: { paddingTop: 22, paddingHorizontal: 20, paddingBottom: 20, gap: 20 },

  loading: { alignItems: 'center', gap: 12, paddingTop: 24 },
  loadingText: { fontSize: 13.5, fontWeight: '600', color: palette.textFaint },

  questionBlock: { gap: 14 },
  question: { fontSize: 23, fontWeight: '900', color: palette.text, lineHeight: 33 },

  pastAi: { gap: 4 },
  pastMine: { gap: 4, paddingLeft: 14, borderLeftWidth: 2, borderLeftColor: palette.blueLine },
  pastLabel: { fontSize: 11.5, fontWeight: '800', color: palette.textFaint },
  pastText: { fontSize: 13.5, fontWeight: '600', color: palette.textDim, lineHeight: 22 },

  errorText: { fontSize: 13, fontWeight: '700', color: palette.danger },
  retry: {
    alignSelf: 'flex-start',
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    paddingVertical: 9,
    paddingHorizontal: 16,
  },
  retryText: { fontSize: 13, fontWeight: '800', color: palette.textDim },
  doneText: { fontSize: 14, fontWeight: '600', color: palette.textDim, lineHeight: 23 },

  composer: {
    gap: 10,
    paddingHorizontal: 20,
    paddingTop: 12,
    paddingBottom: 12,
    borderTopWidth: 1,
    borderTopColor: palette.borderSoft,
  },
  composerLabelRow: { flexDirection: 'row', justifyContent: 'space-between' },
  composerLabel: { fontSize: 12.5, fontWeight: '800', color: palette.textMuted },
  counter: { fontSize: 11.5, fontWeight: '600', color: palette.checkOff },
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 8 },
  input: {
    flex: 1,
    minHeight: 112,
    borderRadius: 14,
    borderWidth: 1.5,
    borderColor: palette.blue,
    backgroundColor: palette.bg,
    paddingVertical: 14,
    paddingHorizontal: 16,
    fontSize: 14,
    fontWeight: '600',
    color: palette.text,
    lineHeight: 23,
    textAlignVertical: 'top',
  },
  quickRow: { flexDirection: 'row', gap: 8 },
  quick: {
    flex: 1,
    height: 37,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  send: {
    height: 52,
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
  },
  sendOff: { backgroundColor: palette.blueLine },
  sendText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  endHint: { fontSize: 11.5, fontWeight: '600', color: palette.checkOff, textAlign: 'center' },
});
