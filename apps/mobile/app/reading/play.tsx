import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, TextInput, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { hasMicPermission, useReadingMic } from '@/hooks/use-reading-mic';
import { detectSttPolicy, useReadingStt } from '@/hooks/use-reading-stt';
import { hasSeenReadingGuide, markReadingGuideSeen } from '@/lib/reading/guide-flag';
import { compareLine } from '@/lib/reading/match';
import { currentNetworkType } from '@/lib/reading/network';
import { speakableText, type DialogueLine } from '@/lib/reading/parse';
import { createProgressQueue, type ProgressQueue } from '@/lib/reading/progress-queue';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import {
  advance,
  createRun,
  exitMessage,
  formatProgress,
  isHidden,
  pause as pauseRun,
  progressOf,
  progressPayload,
  quizMiss,
  quizPass,
  quizSkip,
  readMiss,
  readPass,
  resume as resumeRun,
  resumeRun as resumeAt,
  tickElapsed,
  type RunState,
} from '@/lib/reading/session-run';
import {
  getCurrent,
  getCurrentSession,
  newRequestId,
  saveProgress,
  setCurrentSession,
  startSession,
  updateCurrent,
  type MaskMode,
} from '@/lib/reading/store';
import type { SttPolicy } from '@/lib/reading/stt-policy';
import { assetsPresent, modelDownloadBytes } from '@/lib/reading/tts/assets';
import { speakWithDevice, stopDeviceVoice } from '@/lib/reading/tts/device-voice';
import * as engine from '@/lib/reading/tts/engine';
import type { VadEvent } from '@/lib/reading/vad';
import { modelDownloadPrompt, type PartnerVoiceEngine } from '@/lib/reading/voice-policy';
import { assignVoices } from '@/lib/reading/voices';
import { translate as t } from '@/lib/i18n';

/**
 * 리딩 실행(R03.0 가이드 · R03.1 상대가 읽는 중 · R03.2 내 차례·나가기 확인, reading.session).
 *
 * 상대 대사는 기기가 배역별 목소리로 읽고 내 대사에서 멈춰 기다린다. 내 차례는 1.8초 침묵(마이크 음량)이나
 * 버튼으로 넘어간다 — read 에서 침묵 신호는 다음 줄이고, quiz 에서는 발화를 확정해 대조하는 것이다. 진행 위치는
 * 줄이 바뀔 때·일시정지·나가기·완료 때 서버에 남고(progress-queue), 지문·장면은 화면에만 보이고 진행에서는
 * 건너뛴다. 배경으로 가면 멈추고 재개는 그 줄을 처음부터 다시 하며 마이크는 자동으로 켜지 않는다.
 *
 * 실기기 오디오(녹음·음성 합성·음성인식의 동시 사용)는 자동화 테스트로 검증하지 않는다 — 순수 규칙은
 * session-run·vad·match·progress-queue 가 지키고, 여기서는 그것들을 잇는다.
 */
type Phase = 'guide' | 'preparing' | 'voice_failed' | 'running' | 'done' | 'closed';

const MASKS: MaskMode[] = ['none', 'mine', 'all'];
const MASK_LABEL: Record<MaskMode, string> = {
  none: t('reading.maskNone'),
  mine: t('reading.maskMine'),
  all: t('reading.maskAll'),
};
const HIDDEN = '⋯⋯⋯⋯';

/** 첫 글자 힌트 — 어절마다 첫 글자만 남긴다. */
function firstLetters(text: string): string {
  return text
    .split(/(\s+)/)
    .map((w) => (/^\s+$/.test(w) || !w ? w : w[0] + '⎯'.repeat(Math.max(1, [...w].length - 1))))
    .join('');
}

export default function ReadingPlay() {
  const router = useRouter();
  const insets = useSafeAreaInsets();
  const { confirm, alert, dialog } = useAppDialog();
  const script = getCurrent();
  const session = getCurrentSession();
  const mic = useReadingMic();
  const stt = useReadingStt();

  const config = useMemo(() => {
    if (!script || !session) return null;
    const startIndex = script.lineIds.indexOf(session.start_line_id);
    const endIndex = script.lineIds.indexOf(session.end_line_id);
    if (startIndex < 0 || endIndex < 0) return null;
    const myRoles = script.characters.filter((c) => session.my_character_ids.includes(c.id)).map((c) => c.name);
    return { lines: script.lines, lineIds: script.lineIds, myRoles, startIndex, endIndex, mode: session.mode };
  }, [script, session]);

  const [run, setRun] = useState<RunState | null>(() => {
    if (!config || !session) return null;
    let initial = createRun(config);
    // 이어하기 — 서버가 아는 위치·시간·줄별 결과부터.
    if (session.current_line_id && session.progress_seq > 0) initial = resumeAt(initial, session.current_line_id);
    const results: RunState['results'] = {};
    for (const r of session.line_results ?? []) results[r.line_id] = { outcome: r.outcome, misses: r.misses };
    return { ...initial, results, elapsedMs: (session.elapsed_seconds ?? 0) * 1000 };
  });
  const runRef = useRef(run);
  runRef.current = run;

  const [phase, setPhase] = useState<Phase>('guide');
  const [prepareLine, setPrepareLine] = useState(t('reading.voicePreparing'));
  const [partnerEngine, setPartnerEngine] = useState<PartnerVoiceEngine>('supertonic');
  const [maskMode, setMaskMode] = useState<MaskMode>(script?.maskMode ?? 'none');
  const [revealed, setRevealed] = useState(false);
  const [hint, setHint] = useState(false);
  const [said, setSaid] = useState('');
  const [typing, setTyping] = useState(false);
  const [typed, setTyped] = useState('');
  const [timeoutHint, setTimeoutHint] = useState(false);
  const [listening, setListening] = useState(false);
  const [attempt, setAttempt] = useState(0);
  const [sttMode, setSttMode] = useState<SttPolicy | null>(null);
  const [micAllowed, setMicAllowed] = useState(false);
  const [guideChecked, setGuideChecked] = useState(false);
  const [closedMessage, setClosedMessage] = useState<string | null>(null);
  const queueRef = useRef<ProgressQueue | null>(null);
  const mounted = useRef(true);
  const sttActive = useRef(false);

  const voices = useMemo(
    () => (script && session ? assignVoices(script.characters, session.my_character_ids) : {}),
    [script, session],
  );
  const characterIdByName = useMemo(() => new Map((script?.characters ?? []).map((c) => [c.name, c.id] as const)), [script]);
  const presetFor = useCallback((role: string) => voices[characterIdByName.get(role) ?? ''] ?? 'F1', [voices, characterIdByName]);

  // ── 진행 저장 큐 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    const queue = createProgressQueue({
      send: (body) => saveProgress(session.id, body),
      initialSeq: session.progress_seq ?? 0,
      onClosed: () => {
        if (!mounted.current) return;
        setClosedMessage(t('reading.errorSessionClosed'));
        setPhase('closed');
      },
    });
    queueRef.current = queue;
    return () => {
      queue.dispose();
      queueRef.current = null;
    };
  }, [session]);

  const commit = useCallback((next: RunState) => {
    const prev = runRef.current;
    runRef.current = next;
    setRun(next);
    if (!prev) return;
    if (next.status === 'done') {
      queueRef.current?.push(progressPayload(next));
      setPhase('done');
      return;
    }
    // 이어하기의 앞 상대 대사(leadIn)는 저장하지 않는다 — 서버 위치가 뒤로 가지 않게.
    if (next.index !== prev.index && next.leadInUntil === null) queueRef.current?.push(progressPayload(next));
  }, []);

  const goNext = useCallback(
    (from: number) => {
      const cur = runRef.current;
      if (!cur) return;
      const next = advance(cur, from);
      if (next !== cur) commit(next);
    },
    [commit],
  );

  // ── 가이드 → 목소리 준비 → 실행 ──────────────────────────────────────────────
  useEffect(() => {
    mounted.current = true;
    void (async () => {
      const [seen, micOk] = await Promise.all([hasSeenReadingGuide(), hasMicPermission()]);
      if (!mounted.current) return;
      setMicAllowed(micOk);
      if (micOk) setSttMode(await detectSttPolicy());
      setGuideChecked(true);
      if (seen) void prepare();
    })();
    return () => {
      mounted.current = false;
      engine.stop();
      stopDeviceVoice();
      stt.abort();
      void mic.stop();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const hasPartnerLines = useMemo(() => {
    if (!config) return false;
    for (let i = config.startIndex; i <= config.endIndex; i++) {
      const l = config.lines[i];
      if (l?.type === 'dialogue' && !config.myRoles.includes(l.role)) return true;
    }
    return false;
  }, [config]);

  const prepare = useCallback(async () => {
    // 모든 배역이 내 배역이면 상대 대사가 없어 모델 준비를 기다리지 않는다.
    if (!hasPartnerLines || engine.isReady() || partnerEngine !== 'supertonic') {
      setPhase('running');
      return;
    }
    const present = assetsPresent('fp32', 'M1');
    if (!present) {
      const prompt = modelDownloadPrompt({ assetsPresent: present, networkType: await currentNetworkType(), bytes: modelDownloadBytes('fp32') });
      if (prompt.ask) {
        const ok = await confirm({
          title: t('reading.downloadAskTitle'),
          message: t('reading.downloadAskBody', { size: prompt.sizeLabel }),
          confirmLabel: t('reading.downloadNow'),
          cancelLabel: t('reading.textOnlyStart'),
        });
        if (!ok) {
          // 취소하면 글로 보기로 시작하고, 다음에 다시 물어본다(플래그를 남기지 않는다).
          setPartnerEngine('text_only');
          setPhase('running');
          return;
        }
      }
    }
    setPhase('preparing');
    try {
      await engine.ensureReady((line) => mounted.current && setPrepareLine(line));
      if (mounted.current) setPhase('running');
    } catch {
      if (mounted.current) setPhase('voice_failed');
    }
  }, [confirm, hasPartnerLines, partnerEngine]);

  const startAfterGuide = async () => {
    await markReadingGuideSeen();
    void prepare();
  };

  // ── 상대 차례: 배역별 목소리로 읽고 넘어간다 ──────────────────────────────────
  useEffect(() => {
    if (phase !== 'running' || !run || run.status !== 'partner') return;
    const line = run.lines[run.index] as DialogueLine;
    const from = run.index;
    if (partnerEngine === 'text_only') return; // 글로 보기 — 버튼으로 넘긴다
    let cancelled = false;
    void (async () => {
      try {
        const text = speakableText(line.text);
        if (partnerEngine === 'supertonic') await engine.speak(text, presetFor(line.role));
        else await speakWithDevice(text, presetFor(line.role));
      } catch {}
      if (!cancelled && mounted.current) goNext(from);
    })();
    return () => {
      cancelled = true;
      engine.stop();
      stopDeviceVoice();
    };
  }, [phase, run?.index, run?.status, partnerEngine, goNext, presetFor, run]);

  // ── 내 차례: 마이크(침묵 감지)와 STT ─────────────────────────────────────────
  const onSilenceEnd = useCallback(
    async (from: number) => {
      const cur = runRef.current;
      if (!cur || !session || cur.index !== from || cur.status !== 'mine') return;
      const text = sttActive.current ? await stt.finish() : '';
      sttActive.current = false;
      setListening(false);
      const line = cur.lines[cur.index] as DialogueLine;
      if (session.mode === 'read') {
        // read: 침묵 신호는 다음 줄. 대조 결과는 흐름에 끼어들지 않고 결과만 남긴다.
        if (text) {
          const result = compareLine(text, line.text);
          if (result.kind === 'pass') commit(readPass(cur));
          else if (result.kind === 'miss') commit(readMiss(cur));
        }
        goNext(from);
        return;
      }
      handleQuizText(text, from);
    },
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [session, stt, commit, goNext],
  );

  const handleQuizText = useCallback(
    (text: string, from: number) => {
      const cur = runRef.current;
      if (!cur || cur.index !== from || cur.status !== 'mine') return;
      const line = cur.lines[cur.index] as DialogueLine;
      const result = compareLine(text, line.text);
      if (result.kind === 'pass') {
        commit(quizPass(cur));
        return;
      }
      if (result.kind === 'miss') {
        const next = quizMiss(cur);
        commit(next);
        if (next.index === from) setAttempt((a) => a + 1); // 첫 미달 — 같은 줄에서 다시 듣는다
        return;
      }
      // 인식 불가·무발화·한도 초과: 미달로 세지 않는다. 다시 듣거나 버튼으로 넘긴다.
      if (result.kind === 'too_long') setTyping(false);
      setAttempt((a) => a + 1);
    },
    [commit],
  );

  useEffect(() => {
    if (phase !== 'running' || !run || run.status !== 'mine' || !session) return;
    const from = run.index;
    setSaid('');
    setRevealed(false);
    setHint(false);
    setTimeoutHint(false);
    setTyped('');
    let cancelled = false;
    const onEvent = (event: VadEvent) => {
      if (cancelled) return;
      if (event === 'timeout') setTimeoutHint(true);
      if (event === 'speech_end' && session.advance === 'silence') void onSilenceEnd(from);
    };
    void (async () => {
      if (typing || !micAllowed) return;
      if (sttMode?.kind === 'stt') {
        const ok = stt.start({ onEvent, onInterim: setSaid });
        sttActive.current = ok;
        if (ok) {
          setListening(true);
          return;
        }
      }
      const ok = await mic.start(onEvent);
      if (!cancelled) setListening(ok);
    })();
    return () => {
      cancelled = true;
      stt.abort();
      sttActive.current = false;
      void mic.stop();
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase, run?.index, run?.status, attempt, typing]);

  // ── 흐른 시간(일시정지 제외) ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase !== 'running') return;
    const timer = setInterval(() => {
      const cur = runRef.current;
      if (!cur || cur.status === 'paused' || cur.status === 'done') return;
      const next = tickElapsed(cur, 1000);
      runRef.current = next;
      setRun(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase]);

  // ── 배경 전환: 멈추고 위치를 저장한다. 돌아오면 배우가 재개를 누른다 ────────────────
  const doPause = useCallback(() => {
    const cur = runRef.current;
    if (!cur || (cur.status !== 'mine' && cur.status !== 'partner')) return;
    engine.stop();
    stopDeviceVoice();
    const next = pauseRun(cur);
    runRef.current = next;
    setRun(next);
    queueRef.current?.push(progressPayload(next));
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phase === 'running') doPause();
    });
    return () => sub.remove();
  }, [phase, doPause]);

  const doResume = () => {
    const cur = runRef.current;
    if (!cur || cur.status !== 'paused') return;
    const next = resumeRun(cur);
    runRef.current = next;
    setRun(next);
    setAttempt((a) => a + 1);
  };

  const changeMask = (mode: MaskMode) => {
    setMaskMode(mode);
    void updateCurrent({ maskMode: mode });
  };

  const onExit = async () => {
    const cur = runRef.current;
    if (cur && cur.status !== 'done') {
      const ok = await confirm({ title: t('reading.exitConfirmTitle'), message: exitMessage(cur), confirmLabel: t('reading.exitLeave') });
      if (!ok) return;
      engine.stop();
      stopDeviceVoice();
      stt.abort();
      void mic.stop();
      if (cur.status !== 'paused') {
        const paused = pauseRun(cur);
        runRef.current = paused;
        setRun(paused);
      }
      queueRef.current?.push(progressPayload(runRef.current!));
      await Promise.race([queueRef.current?.flushed() ?? Promise.resolve(), new Promise((r) => setTimeout(r, 3000))]);
    }
    router.replace('/reading/detail');
  };

  const readAgain = async () => {
    if (!script || !session) return;
    try {
      const next = await startSession(script.id, {
        request_id: newRequestId(),
        my_character_ids: session.my_character_ids,
        mode: session.mode,
        start_line_id: session.start_line_id,
        end_line_id: session.end_line_id,
        advance: session.advance,
        record: session.record,
      });
      setCurrentSession(next);
      router.replace('/reading/play');
    } catch (e) {
      void alert({ title: t('reading.startFailed'), message: scriptErrorMessage(e) });
    }
  };

  // ── 화면 ────────────────────────────────────────────────────────────────────
  if (!script || !session || !config || !run) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'guide') {
    if (!guideChecked) {
      return (
        <View style={[styles.root, styles.center]}>
          <ActivityIndicator color={palette.blue} />
        </View>
      );
    }
    return (
      <View style={[styles.root, styles.center, { paddingTop: insets.top }]}>
        <Feather name="mic" size={32} color={palette.blue} />
        <Text style={styles.doneTitle}>{t('reading.guideTitle')}</Text>
        <View style={styles.guideList}>
          {hasPartnerLines && <Text style={styles.guideLine}>· {t('reading.guideRead')}</Text>}
          <Text style={styles.guideLine}>· {session.advance === 'silence' ? t('reading.guideSilence') : t('reading.guideManual')}</Text>
          {session.mode === 'quiz' && <Text style={styles.guideLine}>· {t('reading.guideQuiz')}</Text>}
          <Text style={styles.guideLine}>· {session.record ? t('reading.guideRecordOn') : t('reading.guideRecordOff')}</Text>
        </View>
        <Pressable style={styles.pill} onPress={() => void startAfterGuide()}>
          <Text style={styles.pillText}>{t('reading.guideStart')}</Text>
        </Pressable>
        {dialog}
      </View>
    );
  }

  if (phase === 'preparing') {
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={palette.blue} />
        <Text style={styles.loadTitle}>{prepareLine}</Text>
        <Text style={styles.loadNote}>처음 한 번만 음성 모델을 내려받아요. 잠시 걸릴 수 있어요.</Text>
        {dialog}
      </View>
    );
  }

  if (phase === 'voice_failed') {
    return (
      <View style={[styles.root, styles.center]}>
        <Feather name="alert-circle" size={30} color={palette.amber} />
        <Text style={styles.doneTitle}>{t('reading.voiceFailTitle')}</Text>
        <Text style={styles.dim}>{t('reading.voiceFailBody')}</Text>
        <View style={styles.choiceList}>
          <Pressable style={[styles.choice, styles.choiceGhost]} onPress={() => void prepare()}>
            <Text style={styles.choiceGhostText}>{t('reading.voiceRetry')}</Text>
          </Pressable>
          <Pressable
            style={[styles.choice, styles.choiceGhost]}
            onPress={() => {
              setPartnerEngine('device_voice');
              setPhase('running');
            }}>
            <Text style={styles.choiceGhostText}>{t('reading.voiceDevice')}</Text>
            <Text style={styles.choiceNote}>{t('reading.voiceDeviceNote')}</Text>
          </Pressable>
          <Pressable
            style={[styles.choice, styles.choicePrimary]}
            onPress={() => {
              setPartnerEngine('text_only');
              setPhase('running');
            }}>
            <Text style={styles.choicePrimaryText}>{t('reading.voiceTextOnly')}</Text>
          </Pressable>
        </View>
        {dialog}
      </View>
    );
  }

  if (phase === 'closed') {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{closedMessage}</Text>
        <Pressable style={styles.pill} onPress={() => router.replace('/reading/detail')}>
          <Text style={styles.pillText}>{t('reading.toDetail')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase === 'done') {
    const { total } = progressOf(run);
    return (
      <View style={[styles.root, styles.center]}>
        <View style={styles.doneIcon}>
          <Feather name="check" size={28} color="#fff" />
        </View>
        <Text style={styles.doneTitle}>{t('reading.completeTitle')}</Text>
        <Text style={styles.dim}>
          {t('reading.completeBody', { title: script.title, count: total, time: formatProgress(run, run.elapsedMs).split(' · ')[1] })}
        </Text>
        <View style={styles.doneRow}>
          <Pressable style={[styles.pill, styles.pillGhost]} onPress={() => router.replace('/reading/detail')}>
            <Text style={styles.pillGhostText}>{t('reading.toDetail')}</Text>
          </Pressable>
          <Pressable style={styles.pill} onPress={() => void readAgain()}>
            <Text style={styles.pillText}>{t('reading.readAgain')}</Text>
          </Pressable>
        </View>
        {dialog}
      </View>
    );
  }

  // running
  const line = run.lines[run.index];
  const isDialogue = !!line && line.type === 'dialogue';
  const myTurn = run.status === 'mine' || (run.status === 'paused' && run.resumeTo === 'mine');
  const paused = run.status === 'paused';
  const prevIdx = (() => {
    for (let i = run.index - 1; i >= run.startIndex; i--) if (run.lines[i].type === 'dialogue') return i;
    return -1;
  })();
  const nextIdx = (() => {
    for (let i = run.index + 1; i <= run.endIndex; i++) if (run.lines[i].type === 'dialogue') return i;
    return -1;
  })();
  const leading: string[] = [];
  for (let i = run.index - 1; i >= run.startIndex; i--) {
    const l = run.lines[i];
    if (l.type === 'dialogue') break;
    leading.unshift(l.text);
  }
  const hiddenFor = (idx: number, reveal = false) => {
    const l = run.lines[idx];
    return l ? isHidden({ mode: run.mode, maskMode, line: l, isMine: l.type === 'dialogue' && run.myRoles.includes(l.role), revealed: reveal }) : false;
  };
  const textOf = (idx: number, reveal = false, withHint = false) => {
    const l = run.lines[idx];
    if (!l) return '';
    if (!hiddenFor(idx, reveal)) return l.text;
    return withHint ? firstLetters(l.text) : HIDDEN;
  };
  const roleOf = (idx: number) => {
    const l = run.lines[idx];
    return l?.type === 'dialogue' ? l.role : '';
  };
  const partnerNote =
    partnerEngine === 'text_only' ? t('reading.partnerTextOnly') : partnerEngine === 'device_voice' ? t('reading.voiceDeviceNote') : t('reading.partnerReading');

  const submitTyped = () => {
    const text = typed.trim();
    if (!text) return;
    const from = run.index;
    if (session.mode === 'quiz') handleQuizText(text, from);
    else {
      const result = compareLine(text, (line as DialogueLine).text);
      if (result.kind === 'pass') commit(readPass(run));
      else if (result.kind === 'miss') commit(readMiss(run));
      goNext(from);
    }
    setTyped('');
  };

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      {/* 상단바: 나가기 · 녹음 표시 · 가리기 · 진행/타이머 */}
      <View style={styles.topBar}>
        <Pressable style={styles.exitBtn} onPress={() => void onExit()} hitSlop={8}>
          <Feather name="x" size={20} color={palette.textDim} />
          <Text style={styles.exitText}>{t('reading.exitLeave')}</Text>
        </Pressable>
        {session.record && listening && (
          <View style={styles.recBadge}>
            <View style={styles.recDot} />
            <Text style={styles.recText}>녹음 중</Text>
          </View>
        )}
        <Text style={styles.counter}>{formatProgress(run, run.elapsedMs)}</Text>
      </View>
      <View style={styles.maskBar}>
        {MASKS.map((m) => (
          <Pressable key={m} style={[styles.maskChip, maskMode === m && styles.maskChipOn]} onPress={() => changeMask(m)}>
            <Text style={[styles.maskText, maskMode === m && styles.maskTextOn]}>{MASK_LABEL[m]}</Text>
          </Pressable>
        ))}
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round((progressOf(run).done / Math.max(1, progressOf(run).total)) * 100)}%` }]} />
      </View>

      <ScrollView contentContainerStyle={styles.body} keyboardShouldPersistTaps="handled">
        {prevIdx >= 0 ? (
          <Text style={styles.context} numberOfLines={2}>
            {roleOf(prevIdx)}  {textOf(prevIdx)}
          </Text>
        ) : (
          <View style={{ height: 8 }} />
        )}
        {leading.map((d, i) => (
          <Text key={i} style={styles.direction}>{d}</Text>
        ))}

        {isDialogue && (
          <View style={[styles.card, myTurn ? styles.cardMine : styles.cardOther]}>
            <View style={styles.badgeRow}>
              <View style={styles.badge}>
                <Text style={styles.badgeText}>{roleOf(run.index)}</Text>
              </View>
              {myTurn ? (
                <View style={styles.listening}>
                  <View style={[styles.dot, listening && styles.dotOn]} />
                  <Text style={styles.listeningText}>{listening ? t('reading.listening') : t('reading.myTurn')}</Text>
                </View>
              ) : (
                <Feather name={partnerEngine === 'text_only' ? 'book-open' : 'volume-2'} size={18} color="rgba(255,255,255,0.7)" />
              )}
            </View>
            <Text style={styles.lineText}>{textOf(run.index, revealed, hint)}</Text>
          </View>
        )}

        {myTurn && (said || sttMode?.kind === 'stt') && !typing && (
          <View style={styles.saidBox}>
            <Text style={styles.saidLabel}>{t('reading.saidLabel')}</Text>
            <Text style={styles.saidText}>{said || t('reading.noSpeechYet')}</Text>
          </View>
        )}

        {myTurn && typing && (
          <View style={styles.typeRow}>
            <TextInput
              style={styles.typeInput}
              value={typed}
              onChangeText={setTyped}
              placeholder={t('reading.typePlaceholder')}
              placeholderTextColor={palette.textFaint}
              onSubmitEditing={submitTyped}
              returnKeyType="done"
              autoFocus
            />
            <Pressable style={styles.typeBtn} onPress={submitTyped}>
              <Text style={styles.typeBtnText}>{t('reading.compareTyped')}</Text>
            </Pressable>
          </View>
        )}

        {myTurn && (
          <View style={styles.aidRow}>
            {run.pendingMiss && (
              <Pressable style={styles.aid} onPress={() => setAttempt((a) => a + 1)}>
                <Feather name="rotate-ccw" size={14} color={palette.blueDeep} />
                <Text style={styles.aidText}>{t('reading.tryAgain')}</Text>
              </Pressable>
            )}
            {hiddenFor(run.index) && !revealed && (
              <Pressable style={styles.aid} onPress={() => setRevealed(true)}>
                <Feather name="eye" size={14} color={palette.blueDeep} />
                <Text style={styles.aidText}>{t('reading.showOriginal')}</Text>
              </Pressable>
            )}
            {session.mode === 'quiz' && !revealed && !hint && (
              <Pressable style={styles.aid} onPress={() => setHint(true)}>
                <Feather name="type" size={14} color={palette.blueDeep} />
                <Text style={styles.aidText}>{t('reading.hintFirst')}</Text>
              </Pressable>
            )}
            {!typing && (
              <Pressable style={styles.aid} onPress={() => setTyping(true)}>
                <Feather name="edit-3" size={14} color={palette.blueDeep} />
                <Text style={styles.aidText}>{t('reading.typeInstead')}</Text>
              </Pressable>
            )}
          </View>
        )}

        {nextIdx >= 0 ? (
          <Text style={styles.next} numberOfLines={1}>
            다음 · {roleOf(nextIdx)}  {textOf(nextIdx)}
          </Text>
        ) : (
          <Text style={styles.next}>다음 · 마지막 대사예요</Text>
        )}

        <Text style={styles.hint}>
          {paused
            ? t('reading.pausedBody')
            : myTurn
              ? timeoutHint
                ? t('reading.timeoutHint')
                : !micAllowed
                  ? t('reading.micDeniedNote')
                  : session.advance === 'silence'
                    ? t('reading.readAndNext')
                    : t('reading.guideManual')
              : partnerNote}
        </Text>
      </ScrollView>

      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={paused ? doResume : doPause}>
          <Feather name={paused ? 'play' : 'pause'} size={16} color={palette.textDim} />
          <Text style={styles.ctrlGhostText}>{paused ? t('reading.resume') : t('reading.pause')}</Text>
        </Pressable>
        <Pressable
          style={[styles.ctrl, styles.ctrlPrimary, paused && styles.ctrlOff]}
          disabled={paused}
          onPress={() => {
            const from = run.index;
            if (myTurn && session.mode === 'quiz') commit(quizSkip(run));
            else goNext(from);
          }}>
          <Text style={styles.ctrlPrimaryText}>{myTurn && session.mode === 'quiz' ? t('reading.skipLine') : t('reading.next')}</Text>
          <Feather name="arrow-right" size={16} color="#fff" />
        </Pressable>
      </View>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  loadTitle: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 16, marginTop: 4, textAlign: 'center' },
  loadNote: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 4, textAlign: 'center' },
  doneRow: { flexDirection: 'row', gap: 10, marginTop: 10 },
  guideList: { gap: 8, alignSelf: 'stretch', backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16 },
  guideLine: { color: palette.textDim, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21 },
  choiceList: { gap: 10, alignSelf: 'stretch', marginTop: 8 },
  choice: { borderRadius: 12, paddingVertical: 14, paddingHorizontal: 16, alignItems: 'center', gap: 3 },
  choiceGhost: { backgroundColor: palette.bgSoft },
  choiceGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  choiceNote: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12 },
  choicePrimary: { backgroundColor: palette.blue },
  choicePrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 15 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  exitBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  exitText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  counter: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  maskBar: { flexDirection: 'row', gap: 6, paddingHorizontal: 16, marginTop: 8 },
  maskChip: { flex: 1, alignItems: 'center', backgroundColor: palette.bgSoft, borderRadius: 999, paddingVertical: 6 },
  maskChipOn: { backgroundColor: palette.blueSoft },
  maskText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  maskTextOn: { color: palette.blueDeep },
  progressTrack: { height: 4, backgroundColor: palette.bgSoft, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.blue },

  body: { flexGrow: 1, justifyContent: 'center', padding: 20, gap: 14 },
  context: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20, textAlign: 'center' },
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 21, textAlign: 'center', fontStyle: 'italic' },
  card: { borderRadius: 20, padding: 24, gap: 16 },
  cardOther: { backgroundColor: palette.navy },
  cardMine: { backgroundColor: palette.blueDeep },
  badgeRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between' },
  badge: { borderRadius: 999, paddingHorizontal: 12, paddingVertical: 5, backgroundColor: 'rgba(255,255,255,0.16)' },
  badgeText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  listening: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: 'rgba(255,255,255,0.4)' },
  dotOn: { backgroundColor: '#7DD3FC' },
  listeningText: { color: '#BAE6FD', fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  lineText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 26, lineHeight: 37 },
  saidBox: { backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 12, gap: 4 },
  saidLabel: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  saidText: { color: palette.text, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20 },
  typeRow: { flexDirection: 'row', gap: 8, alignItems: 'center' },
  typeInput: { flex: 1, backgroundColor: palette.bgSubtle, borderColor: palette.border, borderWidth: 1, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12, color: palette.text, fontFamily: 'Pretendard', fontSize: 15 },
  typeBtn: { backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 14, paddingVertical: 12 },
  typeBtnText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  aidRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap', justifyContent: 'center' },
  aid: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 8 },
  aidText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  next: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 14, textAlign: 'center' },
  recBadge: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.dangerSoft, borderRadius: 999, paddingHorizontal: 10, paddingVertical: 4 },
  recDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.danger },
  recText: { color: palette.danger, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', marginTop: 2, lineHeight: 19 },

  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15 },
  ctrlGhost: { backgroundColor: palette.bgSoft },
  ctrlGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
  ctrlPrimary: { backgroundColor: palette.blue },
  ctrlOff: { backgroundColor: palette.checkOff },
  ctrlPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  pillGhost: { backgroundColor: palette.bgSoft },
  pillGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
});
