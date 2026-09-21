import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import type { MicButtonProps } from '@/components/mic-button';
import { SceneFoldBody, SceneFoldLink } from '@/components/practice-chrome';
import { palette } from '@/constants/palette';
import { useExitReview } from '@/hooks/use-exit-review';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { api } from '@/lib/api';
import { translate as t } from '@/lib/i18n';
import {
  COACH_END_WORD,
  answerTooLong,
  buildReplyBody,
  canSendAnswer,
  coachFailure,
  coachFailureMessage,
  helpButtonDraft,
  isClosed,
  nextReplyWraps,
  orderedMessages,
  remainingCoachReplies,
  type HelpButton,
} from '@/lib/practice/coach';
import { clearPractice, getPractice, setContinueOrigin } from '@/lib/practice/session-state';
import type { CoachConversation, CoachMessage } from '@/lib/practice/types';
import { COACH_ANSWER_MAX } from '@/lib/practice/types';
import { newRequestId } from '@/lib/request-id';

// 네이티브 모듈이 없는 빌드(STT 도입 전 dev client)에서도 화면이 뜨도록 가드해서 로드한다.
let MicButton: ComponentType<MicButtonProps> | null = null;
try {
  MicButton = (require('@/components/mic-button') as typeof import('@/components/mic-button')).MicButton;
} catch {
  MicButton = null;
}

/**
 * A11·A11.1 질문 대화(practice.coach).
 *
 * 회차에 대화는 하나다. 앱을 껐다 켜도 같은 대화를 이어 가고, 같은 답을 다시 보내도 같은 요청
 * id 라 메시지가 늘지 않는다. 다른 곳에서 먼저 답이 들어가면(409 conversation_conflict) 쓰던
 * 글을 그대로 두고 최신 대화를 다시 읽는다. 닫힌 대화에는 답할 수 없고 새 회차로 이어 간다.
 * 도움 버튼은 입력을 준비만 하고 배우가 보내야 전송된다.
 */
export default function CoachScreen() {
  const router = useRouter();
  const navigation = useNavigation();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;
  const [practice] = useState(() => getPractice());
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  /** 이번 답의 요청 id — 같은 답을 다시 보내면 그대로 쓴다(메시지가 늘지 않는다). */
  const attemptRef = useRef<{ text: string; requestId: string } | null>(null);
  const startRequestIdRef = useRef<string>(newRequestId());

  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const [messages, setMessages] = useState<CoachMessage[]>([]);
  const [input, setInput] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [askingCoach, setAskingCoach] = useState(false);
  const [connecting, setConnecting] = useState(true);
  const [waiting, setWaiting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [leaveAllowed, setLeaveAllowed] = useState(false);
  const { confirm, dialog } = useAppDialog();

  const closed = isClosed(conversation);

  // usePreventRemove 는 렌더된 값을 보므로, 풀린 상태가 반영된 다음 틱에 이동해야 다시 안 막힌다.
  const leaveThen = useCallback((go: () => void) => {
    setLeaveAllowed(true);
    setTimeout(() => {
      try {
        go();
      } catch {
        // 스택 상태가 어긋나 전환이 실패해도 앱은 살린다.
      }
    }, 0);
  }, []);

  const exitReview = useExitReview('back', 'coach', practice?.practiceId);
  const finishReview = useExitReview('leave', 'coach', practice?.practiceId);

  const goToNote = useCallback(() => {
    leaveThen(() => router.replace('/report'));
  }, [leaveThen, router]);

  const applyResult = useCallback(
    (result: { conversation: CoachConversation; note: unknown }) => {
      setConversation(result.conversation);
      setMessages(orderedMessages(result.conversation));
      if (practice) {
        practice.conversationId = result.conversation.id;
        if (result.note) practice.note = result.note as NonNullable<typeof practice.note>;
      }
      return isClosed(result.conversation);
    },
    [practice],
  );

  const startConversation = useCallback(async () => {
    if (!practice || startInFlightRef.current) return;
    startInFlightRef.current = true;
    setConnecting(true);
    setError(null);
    try {
      const result = await api.startConversation(practice.practiceId, startRequestIdRef.current);
      if (!mountedRef.current) return;
      if (applyResult(result)) goToNote();
    } catch (e) {
      if (mountedRef.current) setError(coachFailureMessage(coachFailure(e)));
    } finally {
      if (mountedRef.current) setConnecting(false);
      startInFlightRef.current = false;
    }
  }, [applyResult, goToNote, practice]);

  /** 충돌 뒤 최신 대화를 다시 읽는다. 쓰던 글은 건드리지 않는다. */
  const reloadConversation = useCallback(async () => {
    const id = conversation?.id ?? practice?.conversationId;
    if (!id) return;
    const latest = await api.getConversation(id).catch(() => null);
    if (latest && mountedRef.current) {
      setConversation(latest);
      setMessages(orderedMessages(latest));
    }
  }, [conversation?.id, practice?.conversationId]);

  const sendText = useCallback(
    async (text: string) => {
      if (!practice || !conversation) return;
      const trimmed = text.trim();
      if (!canSendAnswer({ text: trimmed, waiting, closed, conversationId: conversation.id })) {
        if (answerTooLong(trimmed)) setError(t('coach.answerTooLong'));
        return;
      }
      // 같은 답의 재전송은 같은 요청 id 다 — 본문이 바뀌면 새로 만든다.
      const attempt =
        attemptRef.current?.text === trimmed
          ? attemptRef.current
          : { text: trimmed, requestId: newRequestId() };
      attemptRef.current = attempt;
      setWaiting(true);
      setError(null);
      try {
        const result = await api.replyToCoach(
          buildReplyBody({ conversation, requestId: attempt.requestId, text: trimmed }),
        );
        if (!mountedRef.current) return;
        attemptRef.current = null;
        setInput('');
        if (applyResult(result)) goToNote();
      } catch (e) {
        if (!mountedRef.current) return;
        const failure = coachFailure(e);
        setError(coachFailureMessage(failure));
        // 충돌이면 입력을 보존한 채 최신 대화를 다시 읽는다.
        if (failure.kind === 'conflict') await reloadConversation();
        if (failure.kind === 'closed') await reloadConversation();
        if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      } finally {
        if (mountedRef.current) setWaiting(false);
      }
    },
    [applyResult, closed, conversation, goToNote, practice, reloadConversation, waiting],
  );

  /** 닫힌 대화에서 다시 코칭하려면 새 회차다. */
  const continueWithNewRound = () => {
    if (!practice) return;
    setContinueOrigin({ kind: 'group', rootId: practice.rootId, practiceId: practice.practiceId });
    clearPractice();
    leaveThen(() => router.replace('/upload'));
  };

  // 대화 중에 뒤로가기로 나가면 한 번만 한 줄을 묻는다(practice.feedback, trigger back).
  usePreventRemove(!leaveAllowed && !!practice, ({ data }) => {
    void exitReview.offer(() => leaveThen(() => navigation.dispatch(data.action)));
  });

  useEffect(() => {
    mountedRef.current = true;
    void startConversation();
    return () => {
      mountedRef.current = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages, waiting]);

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

  const endConversation = async () => {
    const ok = await confirm({
      title: t('coach.endTitle'),
      message: t('coach.endMsg'),
      confirmLabel: t('coach.endConfirm'),
    });
    if (ok) await sendText(COACH_END_WORD);
  };

  const finishWithoutNote = () => {
    void finishReview.offer(() => {
      clearPractice();
      leaveThen(() => router.dismissAll());
    });
  };

  const pressHelp = (button: HelpButton) => {
    const draft = helpButtonDraft(button);
    setAskingCoach(button === 'ask_back');
    if (draft) setInput(draft);
    inputRef.current?.focus();
  };

  const latestQuestion = [...messages].reverse().find((m) => m.role === 'coach')?.text ?? null;
  const askedCount = messages.filter((m) => m.role === 'coach').length;
  const past = messages.slice(0, Math.max(0, messages.length - (latestQuestion ? 1 : 0)));
  const canSend = canSendAnswer({ text: input, waiting, closed, conversationId: conversation?.id ?? null });
  const remaining = conversation ? remainingCoachReplies(conversation) : null;
  const wrapping = conversation ? nextReplyWraps(conversation) : false;

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{ title: practice.scene.situation.trim() || t('coach.fallbackTitle'), headerShadowVisible: false }}
      />
      <View style={styles.statusRow}>
        <View style={styles.statusChip}>
          <Text style={styles.statusChipText}>{closed ? t('coach.statusDone') : t('coach.statusAsking')}</Text>
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
          <SceneFoldLink open={sceneOpen} onToggle={() => setSceneOpen((was) => !was)} label="" />
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
          <Text style={styles.progressText}>
            {wrapping ? t('coach.wrapNext') : remaining !== null ? t('coach.remaining', { count: remaining }) : ''}
          </Text>
        </View>
        {past.length > 0 && (
          <Pressable onPress={() => setPastOpen((was) => !was)} accessibilityRole="button" hitSlop={8}>
            <Text style={styles.pastToggle}>
              {t('coach.pastToggle', { count: Math.floor(past.length / 2) })} {pastOpen ? '▴' : '▾'}
            </Text>
          </Pressable>
        )}
      </View>

      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {pastOpen &&
            past.map((message) => (
              <View key={message.turn_index} style={message.role === 'coach' ? styles.pastAi : styles.pastMine}>
                <Text style={styles.pastLabel}>
                  {message.role === 'coach' ? t('coach.roleCoach') : t('coach.roleMe')}
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
            <View style={styles.questionBlock}>{latestQuestion && <Text style={styles.question}>{latestQuestion}</Text>}</View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {error && !conversation && !waiting && !connecting && (
            <Pressable style={styles.retry} onPress={() => void startConversation()}>
              <Text style={styles.retryText}>{t('coach.reconnect')}</Text>
            </Pressable>
          )}

          {closed && (
            <>
              <Text style={styles.doneText}>{practice.note ? t('coach.doneNormal') : t('coach.doneShort')}</Text>
              <Pressable style={styles.retry} onPress={practice.note ? goToNote : finishWithoutNote} accessibilityRole="button">
                <Text style={styles.retryText}>{practice.note ? t('coach.seeSummary') : t('coach.finishBtn')}</Text>
              </Pressable>
              <Pressable style={styles.retry} onPress={continueWithNewRound} accessibilityRole="button">
                <Text style={styles.retryText}>{t('coach.continueNew')}</Text>
              </Pressable>
            </>
          )}
        </ScrollView>

        {!closed && (
          <View style={styles.composer}>
            <View style={styles.composerLabelRow}>
              <Text style={styles.composerLabel}>{t('coach.composerLabel')}</Text>
              <Text style={styles.counter}>
                {input.length} / {COACH_ANSWER_MAX}
              </Text>
            </View>
            <View style={styles.inputRow}>
              {MicButton && <MicButton onText={setInput} disabled={connecting || waiting || !conversation} />}
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder={t(askingCoach ? 'coach.questionPh' : 'coach.composerPh')}
                placeholderTextColor={palette.checkOff}
                value={input}
                onChangeText={setInput}
                maxLength={COACH_ANSWER_MAX}
                multiline
                editable={!connecting && !waiting && !!conversation}
              />
            </View>
            <View style={styles.quickRow}>
              {(
                [
                  ['explain', t('coach.quickExplain')],
                  ['ask_back', t('coach.quickAskBack')],
                  ['later', t('coach.quickLater')],
                ] as const
              ).map(([button, label]) => (
                <Pressable
                  key={button}
                  style={styles.quick}
                  disabled={waiting || connecting || !conversation}
                  onPress={() => pressHelp(button)}
                  accessibilityRole="button">
                  <Text style={styles.quickText}>{label}</Text>
                </Pressable>
              ))}
            </View>
            <Pressable
              style={[styles.send, !canSend && styles.sendOff]}
              disabled={!canSend}
              onPress={() => void sendText(input)}
              accessibilityRole="button">
              <Text style={styles.sendText}>{waiting ? t('coach.thinking') : t('coach.nextQuestion')}</Text>
            </Pressable>
            <Pressable style={styles.endBtn} disabled={waiting || connecting} onPress={() => void endConversation()} accessibilityRole="button">
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

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },

  statusRow: { alignItems: 'flex-end', paddingHorizontal: 16, paddingBottom: 8 },
  statusChip: { backgroundColor: palette.blueSoft, borderRadius: 9999, paddingVertical: 5, paddingHorizontal: 10 },
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
  quickRow: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  quick: {
    flex: 1,
    minHeight: 40,
    minWidth: 96,
    paddingHorizontal: 8,
    paddingVertical: 8,
    borderRadius: 9999,
    borderWidth: 1,
    borderColor: palette.border,
    alignItems: 'center',
    justifyContent: 'center',
  },
  quickText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  send: { height: 52, borderRadius: 14, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center' },
  sendOff: { backgroundColor: palette.blueLine },
  sendText: { fontSize: 15, fontWeight: '900', color: palette.bg },
  endHint: { fontSize: 12, fontWeight: '800', color: palette.textFaint, textAlign: 'center' },
  endBtn: { alignSelf: 'center', paddingVertical: 8, paddingHorizontal: 16 },
});
