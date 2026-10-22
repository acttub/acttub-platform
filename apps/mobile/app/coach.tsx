import Feather from '@expo/vector-icons/Feather';
import { useNavigation, usePreventRemove } from '@react-navigation/native';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState, type ComponentType } from 'react';
import { ActivityIndicator, Platform, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { CoachPurposeCards } from '@/components/coach-purpose-cards';
import { CoachMessage } from '@/components/coach-message';
import { CoachVideoRow } from '@/components/coach-video-row';
import { CoachWaiting } from '@/components/coach-waiting';
import type { MicButtonProps } from '@/components/mic-button';
import { logFoldOpen, SceneFoldBody } from '@/components/practice-chrome';
import { PrimaryButton, SecondaryButton } from '@/components/ui/buttons';
import { CoachNotice } from '@/components/ui/coach-notice';
import { palette } from '@/constants/palette';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { translate as t } from '@/lib/i18n';
import { observedSceneLine } from '@/lib/practice/analysis-summary';
import {
  COACH_END_WORD,
  answerTooLong,
  buildReplyBody,
  canSendAnswer,
  coachFailure,
  coachFailureMessage,
  helpButtonDraft,
  canContinueConversation,
  isClosed,
  loadCoachSession,
  nextReplyWraps,
  orderedMessages,
  type HelpButton,
} from '@/lib/practice/coach';
import { splitTimestamps } from '@/lib/practice/coach-timestamps';
import { clearPractice, getPractice, setContinueOrigin } from '@/lib/practice/session-state';
import type { CoachConversation, CoachTurnResult } from '@/lib/practice/types';
import { COACH_ANSWER_MAX } from '@/lib/practice/types';
import { newRequestId } from '@/lib/request-id';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { finishTutorial, useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { TARGET } from '@/lib/spotlight-targets';
import { loopApiFor } from '@/lib/tutorial-loop';
import { isSamplePracticeId, sampleAnswerFor } from '@/lib/tutorial-sample';

// 네이티브 모듈이 없는 빌드(STT 도입 전 dev client)에서도 화면이 뜨도록 가드해서 로드한다.
let MicButton: ComponentType<MicButtonProps> | null = null;
try {
  MicButton = (require('@/components/mic-button') as typeof import('@/components/mic-button')).MicButton;
} catch {
  MicButton = null;
}

/**
 * A10·A11 코치 화면(practice.analyze · practice.coach).
 *
 * 회차 id(`practiceId`)를 받아 열리면 먼저 같은 화면 안에서 「영상 보는 중」으로 분석을 기다린다(components/coach-waiting,
 * SOMA-778) — 따로 된 분석 화면은 없다. 분석이 끝나면 회차를 들고 대화를 연다. 회차 id 없이 열리면(튜토리얼·미리보기·
 * 테스트) 이미 들고 있는 회차로 바로 대화한다.
 */
export default function CoachScreen() {
  const params = useLocalSearchParams<{ practiceId?: string | string[]; preview?: string }>();
  const preview = __DEV__ && params.preview === '1';
  const [waiting, setWaiting] = useState(() => params.practiceId !== undefined || preview);
  if (waiting) {
    return (
      <CoachWaiting
        practiceId={typeof params.practiceId === 'string' ? params.practiceId : null}
        preview={preview}
        onReady={() => setWaiting(false)}
      />
    );
  }
  return <CoachTalk />;
}

/**
 * A11·A11.1 질문 대화(practice.coach).
 *
 * 회차에 대화는 하나다. 앱을 껐다 켜도 같은 대화를 이어 가고, 같은 답을 다시 보내도 같은 요청
 * id 라 메시지가 늘지 않는다. 다른 곳에서 먼저 답이 들어가면(409 conversation_conflict) 쓰던
 * 글을 그대로 두고 최신 대화를 다시 읽는다. 닫힌 대화에는 답할 수 없고 새 회차로 이어 간다.
 * 도움 버튼은 입력을 준비만 하고 배우가 보내야 전송된다.
 */
function CoachTalk() {
  const router = useRouter();
  const navigation = useNavigation();
  const keyboardHeight = useKeyboardHeight();
  const keyboardVisible = keyboardHeight > 0;
  const [practice] = useState(() => getPractice());
  // 튜토리얼 예시면 미리 써 둔 코치와 대화한다 — 서버·음성 인식·한 줄 설문 없이(SOMA-494).
  const sample = isSamplePracticeId(practice?.practiceId);
  const loop = loopApiFor(practice?.practiceId);
  const questionTarget = useSpotlightTarget(TARGET.coachQuestion);
  const composerTarget = useSpotlightTarget(TARGET.coachComposer);
  const scrollRef = useRef<ScrollView>(null);
  const mountedRef = useRef(true);
  const startInFlightRef = useRef(false);
  /** 이번 답의 요청 id — 같은 답을 다시 보내면 그대로 쓴다(메시지가 늘지 않는다). */
  const attemptRef = useRef<{ text: string; requestId: string } | null>(null);
  const startRequestIdRef = useRef<string>(newRequestId());

  const [conversation, setConversation] = useState<CoachConversation | null>(null);
  const messages = useMemo(() => (conversation ? orderedMessages(conversation) : []), [conversation]);
  const [input, setInput] = useState('');
  const inputRef = useRef<TextInput>(null);
  const [connecting, setConnecting] = useState(true);
  const [waiting, setWaiting] = useState(false);
  /** 코치가 지금 쓰고 있는 답(스트리밍). 비어 있으면 아직 첫 글자 전이거나 스트리밍이 아니다. */
  const [streamText, setStreamText] = useState('');
  const streamCallbacks = useMemo(
    () => ({
      onDelta: (text: string) => {
        if (mountedRef.current) setStreamText((was) => was + text);
      },
      onReset: () => {
        if (mountedRef.current) setStreamText('');
      },
    }),
    [],
  );
  const [error, setError] = useState<string | null>(null);
  const [pastOpen, setPastOpen] = useState(false);
  const [sceneOpen, setSceneOpen] = useState(false);
  // 코치 말 속 시간을 눌러 연 영상의 시작점(pen 「추가 · 시간 눌러 장면 보기」).
  const [seek, setSeek] = useState<{ seconds: number; label: string; key: number } | null>(null);
  // 대화를 여는 데 실패한 까닭 — 연결이 끊긴 것이면 「대화가 잠깐 끊겼어요」 한 장으로 보인다.
  const [startFailureKind, setStartFailureKind] = useState<string | null>(null);
  const [leaveAllowed, setLeaveAllowed] = useState(false);
  const { confirm, dialog } = useAppDialog();
  // 대화 위 한 줄 「AI가 본 장면 · …」 — 분석 공개 요약의 본 장면(SOMA-778). 없으면 줄을 숨긴다.
  // 「고치기」는 본 장면을 바로잡는 서버 API 가 없어 아직 두지 않는다.
  const [observedLine, setObservedLine] = useState<string | null>(null);

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

  // 코칭이 끝나면 배우 일지(SOMA-720)로 간다. 튜토리얼 예시 회차는 서버에 없어 지금처럼 미리 쓴 노트(/report)다.
  const goToNote = useCallback(() => {
    leaveThen(() => router.replace(sample ? '/report' : '/journal'));
  }, [leaveThen, router, sample]);

  const applyResult = useCallback(
    (result: CoachTurnResult) => {
      setConversation(result.conversation);
      if (practice) {
        practice.conversationId = result.conversation.id;
        practice.note = result.note;
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
    setStartFailureKind(null);
    try {
      const result = await loadCoachSession(loop, practice.practiceId, startRequestIdRef.current, practice.conversationId, streamCallbacks);
      if (!mountedRef.current) return;
      if (applyResult(result) && result.note && !result.conversation.purpose) goToNote();
    } catch (e) {
      if (mountedRef.current) {
        const failure = coachFailure(e);
        setStartFailureKind(failure.kind);
        setError(coachFailureMessage(failure));
      }
    } finally {
      if (mountedRef.current) {
        setStreamText('');
        setConnecting(false);
      }
      startInFlightRef.current = false;
    }
  }, [applyResult, goToNote, loop, practice, streamCallbacks]);

  /** 충돌 뒤 최신 대화를 다시 읽는다. 쓰던 글은 건드리지 않는다. */
  const reloadConversation = useCallback(async () => {
    const id = conversation?.id ?? practice?.conversationId;
    if (!id || !practice) return;
    const latest = await loadCoachSession(loop, practice.practiceId, startRequestIdRef.current, id).catch(() => null);
    if (latest && mountedRef.current) {
      applyResult(latest);
    }
  }, [applyResult, conversation?.id, loop, practice]);

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
        const result = await loop.replyToCoach(
          buildReplyBody({ conversation, requestId: attempt.requestId, text: trimmed }),
          streamCallbacks,
        );
        if (!mountedRef.current) return;
        attemptRef.current = null;
        setInput('');
        if (applyResult(result) && result.note && !result.conversation.purpose) goToNote();
      } catch (e) {
        if (!mountedRef.current) return;
        const failure = coachFailure(e);
        setError(coachFailureMessage(failure));
        // 충돌했거나 이미 닫혔으면 입력을 보존한 채 최신 대화를 다시 읽는다.
        if (failure.kind === 'conflict' || failure.kind === 'closed') await reloadConversation();
        if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      } finally {
        if (mountedRef.current) {
          setStreamText('');
          setWaiting(false);
        }
      }
    },
    [applyResult, closed, conversation, goToNote, loop, practice, reloadConversation, streamCallbacks, waiting],
  );

  /**
   * 정리 뒤 「대화 이어하기」(SOMA-782) — 같은 대화를 다시 열어 입력창을 돌려준다. 새 회차가 아니다.
   * 실패하면 닫힌 채로 두고 안내만 보인다. 충돌이면 최신 대화를 다시 읽는다.
   */
  const continueTalk = useCallback(async () => {
    if (!conversation || waiting || !canContinueConversation(conversation, sample)) return;
    setWaiting(true);
    setError(null);
    try {
      const result = await loop.continueConversation(conversation.id, conversation.revision);
      if (!mountedRef.current) return;
      applyResult(result);
    } catch (e) {
      if (!mountedRef.current) return;
      const failure = coachFailure(e);
      setError(coachFailureMessage(failure));
      if (failure.kind === 'conflict') await reloadConversation();
    } finally {
      if (mountedRef.current) setWaiting(false);
    }
  }, [applyResult, conversation, loop, reloadConversation, sample, waiting]);

  /** 닫힌 대화에서 다시 코칭하려면 새 회차다 — 「다음 테이크 찍기」로 영상을 새로 고른다(SOMA-672). */
  const startNextTake = () => {
    if (!practice) return;
    setContinueOrigin({ kind: 'group', rootId: practice.rootId, practiceId: practice.practiceId });
    clearPractice();
    leaveThen(() => router.replace('/upload'));
  };

  // 예시 튜토리얼 대화 중에 뒤로가기로 나가면 튜토리얼을 '나감'으로 끝낸다.
  usePreventRemove(sample && !leaveAllowed, ({ data }) => {
    finishTutorial('left');
    leaveThen(() => navigation.dispatch(data.action));
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
    if (!practice) return;
    let alive = true;
    void Promise.resolve()
      .then(() => loop.getPracticeAnalysis(practice.practiceId))
      .then((analysis) => {
        if (alive) setObservedLine(observedSceneLine(analysis));
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // 예시 튜토리얼은 새 질문이 오면 답 칸에 샘플 답을 채워 둔다 — 그대로 보내도, 고쳐 써도 된다.
  useEffect(() => {
    if (!sample || closed) return;
    const last = messages[messages.length - 1];
    if (last?.role !== 'coach') return;
    const answer = sampleAnswerFor(messages.filter((m) => m.role === 'actor').length);
    if (answer) setInput((was) => (was.trim() ? was : answer));
  }, [closed, messages, sample]);

  useEffect(() => {
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 50);
    return () => clearTimeout(timer);
  }, [messages, waiting, streamText]);

  useEffect(() => {
    if (!keyboardVisible) return;
    const timer = setTimeout(() => scrollRef.current?.scrollToEnd({ animated: true }), 80);
    return () => clearTimeout(timer);
  }, [keyboardVisible]);

  // 첫 질문이 뜬 뒤에 비춘다 — 그 전엔 비출 질문이 없다.
  const tutorialGuide = useTutorialSpotlight('coach', {
    ready: !connecting && messages.some((m) => m.role === 'coach'),
  });

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
      cancelLabel: t('coach.endContinue'),
      confirmLabel: t('coach.endConfirm'),
      compact: true,
    });
    if (ok) await sendText(COACH_END_WORD);
  };

  const finishWithoutNote = () => {
    clearPractice();
    leaveThen(() => router.dismissAll());
  };

  const pressHelp = (button: HelpButton) => {
    const draft = helpButtonDraft(button);
    if (draft) setInput(draft);
    // 키보드를 띄우지 않는다 — 올라오면 보내기 버튼이 움직여 엔터(줄바꿈)를 잘못 누른다(10/20 피드백). 덧붙여 쓰려면 입력칸을 누른다.
  };

  const latestQuestion = [...messages].reverse().find((m) => m.role === 'coach')?.text ?? null;
  // 스트리밍 중에는 쓰이는 글이 같은 말풍선에 자란다. 첫 글자 전에는 이전 모습(기다림 표시) 그대로다.
  const shownQuestion = streamText || latestQuestion;
  const past = messages.slice(0, Math.max(0, messages.length - (latestQuestion ? 1 : 0)));
  const canSend = canSendAnswer({ text: input, waiting, closed, conversationId: conversation?.id ?? null });
  const wrapping = conversation ? nextReplyWraps(conversation) : false;
  const sceneVideo = practice.videoUri || practice.playbackUrl;
  const sceneWritten = [practice.scene.situation, practice.scene.character, practice.scene.goal].some((v) => v?.trim());
  // 대화를 열지 못하고 연결만 끊겼으면(pen 「추가 · 끊긴 코칭 이어 하기」) 한 장 안내로 바꾼다. 답한 것은 서버에 남아 있다.
  const interrupted = !!error && !conversation && !waiting && !connecting && (startFailureKind === 'offline' || startFailureKind === 'other');

  /** 코치 말 속 「0:12」를 누르면 위 영상을 펼쳐 그 초부터 튼다. */
  const seekTo = (seconds: number, label: string) => {
    if (!sceneOpen) logFoldOpen('coach');
    setSceneOpen(true);
    setSeek((was) => ({ seconds, label: t('coach.seekFrom', { time: label }), key: (was?.key ?? 0) + 1 }));
  };
  const withTimestamps = (text: string) =>
    splitTimestamps(text).map((part, index) =>
      part.kind === 'time' && sceneVideo ? (
        <Text
          key={index}
          style={styles.timeLink}
          onPress={() => seekTo(part.seconds, part.text)}
          accessibilityRole="button"
          accessibilityLabel={t('coach.seekLabel', { time: part.text })}>
          {part.text}
        </Text>
      ) : (
        part.text
      ),
    );

  if (interrupted) {
    return (
      <SafeAreaView style={styles.safe} edges={['bottom']}>
        <Stack.Screen options={{ title: t('coach.fallbackTitle'), headerShadowVisible: false }} />
        <CoachNotice
          title={t('coach.interruptedTitle')}
          body={t('coach.interruptedBody')}
          primary={{ label: t('coach.interruptedResume'), onPress: () => void startConversation() }}
          secondary={{ label: t('coach.interruptedLater'), onPress: () => leaveThen(() => router.dismissAll()) }}
        />
        {dialog}
      </SafeAreaView>
    );
  }

  return (
    <SafeAreaView style={styles.safe} edges={keyboardVisible ? [] : ['bottom']}>
      <Stack.Screen
        options={{
          // 제목은 늘 「질문 대화」(pen 09) — 장면 칸은 SOMA-778 에서 없앴다.
          title: t('coach.fallbackTitle'),
          headerShadowVisible: false,
          // 그만하기 — 확인을 받고 대화를 마쳐 정리를 만든다(pen 질문 대화 오른쪽 위, SOMA-656·748).
          headerRight: () =>
            !closed ? (
              <Pressable
                disabled={waiting || connecting || !conversation}
                onPress={() => void endConversation()} accessibilityRole="button" hitSlop={10}>
                <Text style={styles.endText}>{t('coach.quickEnd')}</Text>
              </Pressable>
            ) : null,
        }}
      />

      {observedLine && (
        <View style={styles.sceneBar}>
          <Text style={styles.sceneBarText} numberOfLines={1}>
            {t('coach.sceneBar', { line: observedLine })}
          </Text>
        </View>
      )}
      <View style={[styles.flex, { paddingBottom: keyboardHeight }]}>
        <ScrollView ref={scrollRef} contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
          {/* 오늘 영상 줄 — 누르면 영상을 펼친다. 예전 「영상과 장면 보기」 띠를 대신한다(pen 질문 대화 첫 응답). */}
          {/* 영상 없이 말로 시작한 회차(SOMA-745)는 펼칠 영상이 없어 줄을 두지 않는다. */}
          {sceneVideo ? (
          <CoachVideoRow
            open={sceneOpen}
            sub={sceneWritten ? t('coach.sceneWritten') : t('coach.videoHint')}
            onPress={() => {
              if (!sceneOpen) logFoldOpen('coach');
              setSceneOpen(!sceneOpen);
              setSeek(null);
            }}
          />
          ) : null}
          {sceneVideo ? <SceneFoldBody open={sceneOpen} videoUri={sceneVideo} track="coach" startAt={seek} /> : null}

          <CoachPurposeCards purpose={conversation?.purpose} hasVideo={!!sceneVideo} onSeek={(at) => seekTo(at, String(at))} />

          {(wrapping || past.length > 0) && (
            <View style={styles.progressHead}>
              {/* 남은 코치 답변 수는 보이지 않는다 — 마무리 직전에만 알린다. */}
              {wrapping && <Text style={styles.progressText}>{t('coach.wrapNext')}</Text>}
              <View style={styles.flex} />
              {past.length > 0 && (
                <Pressable
                  onPress={() => setPastOpen((was) => !was)}
                  accessibilityRole="button"
                  accessibilityState={{ expanded: pastOpen }}
                  hitSlop={8}>
                  <View style={styles.pastRow}>
                    <Text style={styles.pastToggle}>{t('coach.pastToggle', { count: Math.floor(past.length / 2) })}</Text>
                    <Feather name={pastOpen ? 'chevron-up' : 'chevron-down'} size={12} color={palette.textFaint} />
                  </View>
                </Pressable>
              )}
            </View>
          )}

          {/* 지난 문답 — 코치 말은 회색 말풍선(왼쪽), 내 답은 파란 말풍선·흰 글자(오른쪽, SOMA-778). */}
          {pastOpen &&
            past.map((message) =>
              message.role === 'coach' ? (
                <View
                  key={message.turn_index}
                  testID="coach-bubble-coach"
                  style={[styles.pastBubble, styles.pastAi]}
                  accessibilityLabel={`${t('coach.roleCoach')}: ${message.text}`}>
                  <Text style={styles.pastAiText}>{message.text}</Text>
                </View>
              ) : (
                <View
                  key={message.turn_index}
                  testID="coach-bubble-mine"
                  style={[styles.pastBubble, styles.pastMine]}
                  accessibilityLabel={`${t('coach.roleMe')}: ${message.text}`}>
                  <Text style={styles.pastMineText}>{message.text}</Text>
                </View>
              ),
            )}

          {connecting && !latestQuestion && !streamText ? (
            <View style={styles.loading}>
              <ActivityIndicator color={palette.blue} />
              <Text style={styles.loadingText}>{t('coach.wrapping')}</Text>
              <Text style={styles.loadingHint}>{t('coach.wrappingHint')}</Text>
            </View>
          ) : (
            <View style={styles.questionBlock} ref={questionTarget.ref} onLayout={questionTarget.onLayout}>
              {shownQuestion && (
                <CoachMessage>
                  {/* 코치 말은 나누지 않고 원문(줄바꿈 포함) 그대로 보인다(SOMA-634). 「0:12」만 누를 수 있게 칠한다. */}
                  <Text style={styles.question}>{withTimestamps(shownQuestion.trim())}</Text>
                </CoachMessage>
              )}
            </View>
          )}

          {waiting && (
            <View style={styles.thinkingRow}>
              <ActivityIndicator size="small" color={palette.blue} />
              <Text style={styles.thinkingText}>{t('coach.thinking')}</Text>
            </View>
          )}

          {error && <Text style={styles.errorText}>{error}</Text>}
          {error && !conversation && !waiting && !connecting && (
            <SecondaryButton label={t('coach.reconnect')} onPress={() => void startConversation()} />
          )}

          {closed && (
            <>
              <Text style={styles.doneText}>{conversation?.close_reason === 'system_failure'
                ? t('coach.doneFailure') : practice.note ? t('coach.doneNormal') : t('coach.doneShort')}</Text>
              {canContinueConversation(conversation, sample) && (
                <Pressable
                  onPress={() => void continueTalk()}
                  disabled={waiting}
                  style={styles.continueTalk}
                  accessibilityRole="button"
                  testID="coach-continue-talk">
                  <Text style={styles.continueTalkText}>{t('coach.continueTalk')}</Text>
                </Pressable>
              )}
              <PrimaryButton label={practice.note ? t('coach.seeSummary') : t('coach.finishBtn')} onPress={practice.note ? goToNote : finishWithoutNote} />
              {/* 예시 회차는 서버에 없어 이어 갈 수 없다. */}
              {!sample && (
                <SecondaryButton label={t('history.nextTake')} onPress={startNextTake} />
              )}
            </>
          )}
        </ScrollView>

        {!closed && (
          <View style={styles.composer} ref={composerTarget.ref} onLayout={composerTarget.onLayout}>
            {conversation?.purpose?.choices.length ? (
              <View style={styles.purposeChoices}>
                {conversation.purpose.choices.map((choice, index) => (
                  <View key={index} style={styles.purposeChoice}>
                    <SecondaryButton label={choice.label} disabled={waiting || connecting} onPress={() => {
                      if (sceneVideo && choice.at != null) seekTo(choice.at, String(choice.at));
                      void sendText(choice.label);
                    }} />
                  </View>
                ))}
              </View>
            ) : null}
            <Text style={styles.chipGuide}>{t('coach.chipGuide')}</Text>
            {/* 빠른 답 한 줄 셋(pen 09) — 누르면 입력칸만 채우고 키보드는 띄우지 않는다. 덧붙이려면 아래 입력칸을 누른다. */}
            <View style={styles.quickRow} testID="coach-quick-grid">
              {(
                [
                  ['yes', t('coach.quickYes')],
                  ['no', t('coach.quickNo')],
                  ['unsure', t('coach.quickUnsure')],
                ] as const
              ).map(([button, label]) => (
                <Pressable
                  key={button}
                  style={({ pressed }) => [styles.quick, pressed && styles.quickOn]}
                  disabled={waiting || connecting || !conversation}
                  onPress={() => pressHelp(button)}
                  accessibilityRole="button">
                  <Text style={styles.quickText} numberOfLines={1}>
                    {label}
                  </Text>
                </Pressable>
              ))}
            </View>
            <View style={styles.inputRow}>
              {MicButton && !sample && <MicButton onText={setInput} disabled={connecting || waiting || !conversation} />}
              <TextInput
                ref={inputRef}
                style={styles.input}
                placeholder={t('coach.composerPh')}
                placeholderTextColor={palette.textFaint}
                accessibilityLabel={t('coach.composerLabel')}
                value={input}
                onChangeText={setInput}
                maxLength={COACH_ANSWER_MAX}
                multiline
                editable={!connecting && !waiting && !!conversation}
              />
              <Pressable
                style={[styles.send, !canSend && styles.sendOff]}
                disabled={!canSend}
                onPress={() => void sendText(input)}
                accessibilityRole="button"
                accessibilityLabel={t('coach.send')}>
                {waiting ? (
                  <ActivityIndicator size="small" color={palette.onAccent} />
                ) : (
                  <Feather name="arrow-up" size={21} color={palette.onAccent} />
                )}
              </Pressable>
            </View>
          </View>
        )}
      </View>
      {dialog}
      {tutorialGuide.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  continueTalk: { alignItems: 'center', paddingVertical: 12 },
  continueTalkText: { fontSize: 15, fontWeight: '700', color: palette.blueDeep },
  purposeChoices: { flexDirection: 'row', flexWrap: 'wrap', gap: 8 },
  purposeChoice: { width: '48%' },
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },

  endText: { fontSize: 17, fontWeight: '700', lineHeight: 21, color: palette.textMuted },

  // 대화 위 한 줄 「AI가 본 장면 · …」 — 옅은 파랑 띠, 글 13/700 한 줄.
  sceneBar: { backgroundColor: palette.blueSoft, paddingVertical: 9, paddingHorizontal: 24 },
  sceneBarText: { fontSize: 13, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },

  progressHead: { flexDirection: 'row', alignItems: 'center', gap: 10 },
  progressText: { fontSize: 12.5, fontWeight: '700', color: palette.textDim },
  // pen 09 「지난 문답 N」 — 오른쪽 끝, 15/700 회색 + 꺾쇠 12.
  pastRow: { flexDirection: 'row', alignItems: 'center', gap: 4 },
  pastToggle: { fontSize: 15, fontWeight: '700', lineHeight: 19, color: palette.textFaint },

  // pen 09 본문 안쪽 [14,21,0,21].
  body: { paddingTop: 14, paddingHorizontal: 21, paddingBottom: 20, gap: 14 },

  loading: { alignItems: 'center', gap: 12, paddingTop: 24 },
  loadingText: { fontSize: 13.5, fontWeight: '600', color: palette.textFaint },
  loadingHint: { fontSize: 12.5, lineHeight: 18, color: palette.textFaint, textAlign: 'center', paddingHorizontal: 24 },

  // 코치 질문 — 머리줄(CoachMessage) 말풍선 안 16/500(줄 22).
  questionBlock: { gap: 16 },
  question: { fontSize: 16, fontWeight: '500', color: palette.text, lineHeight: 22 },
  timeLink: { color: palette.blueDeep, fontWeight: '800', textDecorationLine: 'underline' },

  thinkingRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingLeft: 39 },
  thinkingText: { fontSize: 13, fontWeight: '600', color: palette.textFaint },

  pastBubble: { maxWidth: '85%', paddingVertical: 10, paddingHorizontal: 14, borderRadius: 18 },
  pastAi: { alignSelf: 'flex-start', backgroundColor: palette.bgSoft, borderTopLeftRadius: 4 },
  pastAiText: { fontSize: 14, fontWeight: '600', color: palette.textDim, lineHeight: 22 },
  // 내 답 — 파란 말풍선(palette.blue)에 흰 글자, 오른쪽 위만 뾰족.
  pastMine: { alignSelf: 'flex-end', backgroundColor: palette.blue, borderTopRightRadius: 4 },
  pastMineText: { fontSize: 14, fontWeight: '600', color: palette.onAccent, lineHeight: 22 },

  errorText: { fontSize: 13, fontWeight: '700', color: palette.danger },
  doneText: { fontSize: 14, fontWeight: '600', color: palette.textDim, lineHeight: 23 },

  // pen 09 「Composer」 — 안쪽 [0,21,11,21]: 파란 안내 15/700 · 12 · 빠른 답 · 9 · 입력 줄.
  composer: { paddingHorizontal: 21, paddingTop: 10, paddingBottom: 11 },
  chipGuide: { fontSize: 15, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },
  // 빠른 답 — 한 줄에 셋, 같은 너비. 회색 알약 높이 39 · 모서리 20, 글 15/700 #333D4B.
  quickRow: { flexDirection: 'row', gap: 6 },
  quick: { flex: 1, height: 39, borderRadius: 20, alignItems: 'center', justifyContent: 'center', backgroundColor: palette.bgSoft, paddingHorizontal: 6, marginTop: 12 },
  quickOn: { backgroundColor: palette.blueSoft },
  quickText: { fontSize: 15, fontWeight: '700', lineHeight: 19, color: palette.textStrong },
  // 마이크 39 · 입력칸 44(모서리 22, 안쪽 좌우 14, 17/500) · 보내기 39, 사이 7. 글이 늘면 칸만 커지고 두 버튼은 아래에 붙는다.
  inputRow: { flexDirection: 'row', alignItems: 'flex-end', gap: 7, marginTop: 9 },
  // 한 줄로 시작해 글이 늘면 커지고, 다섯 줄쯤부터는 칸 안에서 스크롤한다(SOMA-656). pen 「칸」 회색 알약.
  input: {
    flex: 1,
    minHeight: 44,
    maxHeight: 144,
    borderRadius: 22,
    backgroundColor: palette.bgSoft,
    // 줄 간격을 따로 주면 안드로이드가 남는 간격을 글자 위에 몰아 한 줄일 때 글자가 아래로 처진다 — 기본 줄 간격에
    // 위아래 여백을 같게 둔다. iOS 여러 줄 입력칸은 위에 자체 여백이 더 붙어 그만큼 위 여백을 줄인다.
    paddingTop: Platform.OS === 'ios' ? 8 : 11,
    paddingBottom: 11,
    paddingHorizontal: 14,
    fontSize: 17,
    fontWeight: '500',
    color: palette.text,
    textAlignVertical: 'center',
  },
  send: { width: 39, height: 39, borderRadius: 20, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center', marginBottom: 2.5 },
  sendOff: { backgroundColor: palette.blueLine },
});
