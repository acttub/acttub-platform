import { useNavigation, usePreventRemove } from '@react-navigation/native';
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
import { attemptCoachStart, canSendCoachMessage, coachCompletionNext } from '@/lib/coach-flow';
import { clearPractice, getPractice } from '@/lib/practice';
import { palette } from '@/constants/palette';
import { SceneFoldBody, SceneFoldLink } from '@/components/practice-chrome';
import { useAppDialog } from '@/components/app-dialog';
import { useExitReview } from '@/hooks/use-exit-review';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import type { MicButtonProps } from '@/components/mic-button';
import { translate as t, translateList } from '@/lib/i18n';

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
  const navigation = useNavigation();
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
  // 리포트로 넘어가거나 마치는 이동은 "나가기"가 아니다 — 가로채기를 풀고 간다.
  // 대화가 끝났어도(done) 리포트로 못 간 채 뒤로가기로 나가는 건 나가기다.
  const [leaveAllowed, setLeaveAllowed] = useState(false);
  // usePreventRemove 는 렌더된 값을 보므로, 풀린 상태가 반영된 다음 틱에 이동해야 다시 안 막힌다.
  const leaveThen = useCallback((go: () => void) => {
    setLeaveAllowed(true);
    setTimeout(() => {
      // 타이머 안의 throw 는 어떤 try/catch 에도 안 잡혀 릴리스 앱을 그대로 죽인다.
      // 스택 상태가 어긋나 전환이 실패해도 앱은 살리고, 화면에 남게만 한다.
      try {
        go();
      } catch {
        // no-op
      }
    }, 0);
  }, []);
  const exitReview = useExitReview('leave', 'coach', practice?.practiceSessionId);
  const finishReview = useExitReview('finish', 'coach', practice?.practiceSessionId);
  const [noteSkipped, setNoteSkipped] = useState(false);
  const [pastOpen, setPastOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const { confirm, dialog } = useAppDialog();

  // 영상 재생은 SceneFold(접이식)가 맡는다 — 목업이 질문에 집중하도록 접어 둔다.

  // 리포트 화면으로 넘어간다. 정리(report)가 아직 없어도 간다 — 그 화면이 직접 만들고,
  // 실패하면 재시도·홈으로 버튼을 준다. 여기 남겨 두면 버튼 하나 없이 갇힌다.
  const goToReport = useCallback(() => {
    leaveThen(() => router.replace('/report'));
  }, [leaveThen, router]);

  // 코치가 대화를 끝냈을 때. status==='complete' 여도 report 는 없을 수 있다.
  const completeConversation = useCallback(
    (reply: {
      status: 'continue' | 'complete';
      report: NonNullable<typeof practice>['report'];
    }) => {
      const next = coachCompletionNext(reply);
      if (next === 'continue' || !practice) return;
      setDone(true);
      if (reply.report) practice.report = reply.report;
      if (next === 'note-skipped') {
        // replace 로 넘기면 coach 라우트가 사라져서 리포트 화면의 '대화로 돌아가기'가
        // 갈 곳을 잃고, 세션은 이미 닫혀 있어 더 답할 수도 없다. 여기서 마치게 한다.
        setNoteSkipped(true);
      } else {
        goToReport();
      }
    },
    [goToReport, practice],
  );

  // 노트 없이 끝난 대화를 마친다 — 세션 마칠 때 한 번 한줄평을 묻는다(SOMA-433).
  const finishWithoutNote = () => {
    void finishReview.offer(() => {
      clearPractice();
      leaveThen(() => router.dismissAll());
    });
  };

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
        // 카드는 대화가 정리되는 순간 응답에 실려 온다(웹과 같은 계약).
        // 따로 확인받지 않고 바로 넘긴다.
        completeConversation(reply);
      } else {
        setError(result.message);
      }
      setConnecting(false);
    }
    startInFlightRef.current = false;
  }, [practice, completeConversation]);

  // 대화 중에 뒤로가기(헤더·제스처·하드웨어)로 나가면 한 번만 한줄평을 묻는다(SOMA-433).
  // 이미 물어본 사람은 그냥 나간다. 대화가 끝나 리포트로 넘어갈 때는 묻지 않는다.
  // beforeRemove 를 직접 걸면 iOS 네이티브 스택이 먼저 화면을 빼 버린다(헤더 뒤로가기·스와이프).
  // usePreventRemove 는 네이티브 쪽까지 막아 준다.
  usePreventRemove(!leaveAllowed, ({ data }) => {
    void exitReview.offer(() => leaveThen(() => navigation.dispatch(data.action)));
  });

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
        <Text style={styles.errorText}>{t('coach.noPractice')}</Text>
      </SafeAreaView>
    );
  }

  const sendText = async (text: string) => {
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
      completeConversation(reply);
    } catch (err) {
      setError(err instanceof Error ? err.message : t('coach.sendFail'));
    } finally {
      setWaiting(false);
    }
  };

  const send = () => sendText(input.trim());

  // '그만'을 타이핑하지 않아도 버튼으로 마칠 수 있게 한다(SOMA-444).
  // 서버는 '그만'을 받으면 대화를 정리한다 — 보내는 내용은 타이핑과 동일하다.
  const endConversation = async () => {
    const ok = await confirm({
      title: t('coach.endTitle'),
      message: t('coach.endMsg'),
      confirmLabel: t('coach.endConfirm'),
    });
    if (ok) await sendText('그만');
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
          title: practice.scene.situation.trim() || t('coach.fallbackTitle'),
          headerShadowVisible: false,
        }}
      />
      <View style={styles.statusRow}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{done ? t('coach.statusDone') : t('coach.statusAsking')}</Text>
        </View>
      </View>

      <View style={styles.strip}>
        <View style={styles.stripRow}>
          <View style={styles.stripText}>
            <Text style={styles.stripTitle}>{t('coach.stripTitle')}</Text>
            <Text style={styles.stripSub} numberOfLines={1}>
              {practice.scene.situation.trim() || t('coach.noScene')}
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
          <Text style={styles.progressText}>{ORDINAL[Math.min(askedCount, 5)] ?? t('coach.ordinalFallback')}</Text>
        </View>
        {past.length > 0 && (
          <Pressable
            onPress={() => setPastOpen((was) => !was)}
            accessibilityRole="button"
            hitSlop={8}>
            <Text style={styles.pastToggle}>
              {t('coach.pastToggle', { count: Math.floor(past.length / 2) })} {pastOpen ? '▴' : '▾'}
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
                  {message.role === 'ai' ? t('coach.roleCoach') : t('coach.roleMe')}
                </Text>
                <Text style={styles.pastText}>{message.text}</Text>
              </View>
            ))}

          {connecting && !latestQuestion ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.blue} />
              <Text style={styles.loadingText}>{t('coach.wrapping')}</Text>
            </View>
          ) : (
            <View style={styles.questionBlock}>
              {latestQuestion && <Text style={styles.question}>{latestQuestion}</Text>}
            </View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {error && !practice.coachSessionId && !waiting && !connecting && (
            <Pressable style={styles.retry} onPress={() => void startCoach()}>
              <Text style={styles.retryText}>{t('coach.reconnect')}</Text>
            </Pressable>
          )}

          {done && (
            <>
              <Text style={styles.doneText}>
                {noteSkipped ? t('coach.doneShort') : t('coach.doneNormal')}
              </Text>
              <Pressable
                style={styles.retry}
                onPress={noteSkipped ? finishWithoutNote : goToReport}
                accessibilityRole="button">
                <Text style={styles.retryText}>
                  {noteSkipped ? t('coach.finishBtn') : t('coach.seeSummary')}
                </Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        {!done && (
          <View style={styles.composer}>
            <View style={styles.composerLabelRow}>
              <Text style={styles.composerLabel}>{t('coach.composerLabel')}</Text>
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
                placeholder={t('coach.composerPh')}
                placeholderTextColor={palette.checkOff}
                value={input}
                onChangeText={setInput}
                maxLength={300}
                multiline
                editable={!connecting && !waiting && !!practice.coachSessionId}
              />
            </View>
            <View style={styles.quickRow}>
              {[t('coach.quickDontKnow'), t('coach.quickAskBack')].map((label) => (
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
                {waiting ? t('coach.thinking') : t('coach.nextQuestion')}
              </Text>
            </Pressable>
            <Pressable
              style={styles.endBtn}
              disabled={waiting || connecting}
              onPress={() => void endConversation()}
              accessibilityRole="button">
              <Text style={styles.endHint}>{t('coach.endHint')}</Text>
            </Pressable>
          </View>
        )}
      </View>
      {dialog}
      {exitReview.element}
      {finishReview.element}
    </SafeAreaView>
  );
}

const ORDINAL = translateList('coach.ordinal');

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
  endHint: { fontSize: 12, fontWeight: '800', color: palette.textFaint, textAlign: 'center' },
  endBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
});
