import Feather from '@expo/vector-icons/Feather';
import { useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Modal, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { DiffText } from '@/components/diff-text';
import { logEvent } from '@/lib/analytics';
import { hasMicPermission, useReadingMic } from '@/hooks/use-reading-mic';
import { detectSttPolicy, useReadingStt } from '@/hooks/use-reading-stt';
import { deleteDeviceFile } from '@/lib/account-files';
import { hideAutoAdvanceTip, isAutoAdvanceTipHidden } from '@/lib/reading/guide-flag';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { currentTutorial } from '@/lib/tutorial';
import { currentNetworkType } from '@/lib/reading/network';
import { speakableText, type DialogueLine, type ScriptLine } from '@/lib/reading/parse';
import { closeProgressQueue, openProgressQueue, type ProgressQueue } from '@/lib/reading/progress-queue';
import { RECORDING_MAX_MS, contentTypeFor, nextAttemptNo, transcriptFields } from '@/lib/reading/recording-plan';
import { enqueueLineRecording, onRecordingQueueChange, pendingRecordingUploads } from '@/lib/reading/recording-runner';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { buildStartBody } from '@/lib/reading/session-plan';
import { directionLabel, readDialogueCount, reportCompletion, type DifferentView } from '@/lib/reading/session-results';
import {
  advance,
  createRun,
  exitMessage,
  formatProgress,
  isHidden,
  mmss,
  pause as pauseRun,
  progressOf,
  progressPayload,
  recordSaid,
  resume as resumeRun,
  resumeRun as resumeAt,
  shownText,
  tickElapsed,
  type LineAid,
  type RunState,
} from '@/lib/reading/session-run';
import {
  fetchSession,
  getCurrent,
  getCurrentSession,
  saveProgress,
  setCurrentSession,
  setLastRunReview,
  startSession,
  updateCurrent,
  type MaskMode,
} from '@/lib/reading/store';
import type { SttPolicy } from '@/lib/reading/stt-policy';
import { assetsPresent, modelDownloadBytes, removeDownloadedAssets } from '@/lib/reading/tts/assets';
import { formatDownloadProgress, type VoiceProgress } from '@/lib/reading/tts/download-progress';
import { voiceErrorKind, type VoiceErrorKind } from '@/lib/reading/tts/voice-errors';
import { hasDeviceVoice, speakWithDevice, stopDeviceVoice } from '@/lib/reading/tts/device-voice';
import * as tts from '@/lib/reading/tts/engine';
import { DEFAULT_VAD, type VadEvent } from '@/lib/reading/vad';
import { formatMegabytes, modelDownloadPrompt } from '@/lib/reading/voice-policy';
import {
  choosePartnerVoice,
  markAppVoiceNoticed,
  markAppVoiceUnsupported,
  markModelLoadEnded,
  markModelLoadStarted,
  readAppVoiceSupport,
  type PartnerVoiceEngine,
} from '@/lib/reading/voice-capability';
import { translate as t } from '@/lib/i18n';
import { useAppRating } from '@/hooks/use-app-rating';
import { api } from '@/lib/api';
import { loadCloudVoiceEnabled, shouldUseCloudVoice } from '@/lib/reading/cloud-voice';
import { synthesizeCloudSpeech } from '@/lib/reading/cloud-voice-runtime';
import { newRequestId } from '@/lib/request-id';

/**
 * 연습 실행(R9, reading.session). R8 시작·회차 상세 [이어서 연습]·완료의 [다시 연습]으로 들어온다.
 *
 * 화면은 「대본 흐름」 — 지나간 줄(지문 포함)이 위로 흐리게 쌓이고 지금 줄 카드가 맨 아래, 다음 대사는 보이지 않는다.
 * 상대 대사는 목소리(고품질 → 앱 모델 → 기기 기본 목소리 → 글로 보기, voice-capability)로 읽고 내 대사에서 멈춰
 * 기다린다. 내 차례는 1.8초 침묵이나 [다음]으로 넘어가고 늘 녹음된다. 말한 것은 전사해 진행 저장에 싣고, 서버가 원문과
 * 비교해 완료 저장 응답으로 돌려주면 완료 화면(R9.23)이 「원문과 다르게 말한 대사」로 그린다. 대사 보기 시트가 떠 있는
 * 동안은 자동 넘김만 멈춘다(녹음·상대 읽기는 계속). 진행 위치는 줄이 바뀔 때·일시정지·나가기·완료 때 서버에 남고(progress-queue),
 * 배경으로 가면 멈추고 재개는 그 줄을 처음부터 다시 한다.
 *
 * 실기기 오디오(녹음·음성 합성·음성인식의 동시 사용)는 자동화 테스트로 검증하지 않는다 — 순수 규칙은
 * session-run·session-results·voice-capability·vad·progress-queue 가 지키고, 여기서는 그것들을 잇는다.
 */
type Phase =
  | { kind: 'preparing'; progress: VoiceProgress | null }
  | { kind: 'voice_failed'; failure: { kind: VoiceErrorKind; neededBytes?: number } }
  /** 앱 목소리를 못 쓰는 기기의 처음 한 번 안내(R9.7). */
  | { kind: 'voice_unsupported' }
  /** hold 가 있으면 자동 넘김이 멈춘다 — tip 은 시작 팝업(첫 줄을 읽지 않음), mask_sheet 는 대사 보기 시트. */
  | { kind: 'running'; hold: 'tip' | 'mask_sheet' | null }
  | { kind: 'done' }
  | { kind: 'closed'; message: string };

/** 내 차례의 시간 넘김 안내 — 오래 말이 없음 · 녹음 180초. */
type TurnNote = null | 'silence' | 'limit';

/** 위쪽에 잠깐 보이는 알림. */
type Notice = null | { kind: 'dropped'; count: number } | { kind: 'cloud_fallback' };

type Deferred = null | { kind: 'advance' | 'end_turn'; from: number };

const MASKS: { key: MaskMode; label: string; desc: string }[] = [
  { key: 'none', label: t('reading.maskNone'), desc: t('reading.maskNoneDesc') },
  { key: 'mine', label: t('reading.maskMine'), desc: t('reading.maskMineDesc') },
  { key: 'all', label: t('reading.maskAll'), desc: t('reading.maskAllDesc') },
];
const NOTICE_MS = 4000;

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
    return { lines: script.lines, lineIds: script.lineIds, myRoles, startIndex, endIndex };
  }, [script, session]);

  const [run, setRun] = useState<RunState | null>(() => {
    if (!config || !session) return null;
    let initial = createRun(config);
    // 이어하기 — 서버가 아는 위치·시간부터(줄별 결과는 서버가 들고 있다). 옛 암기 대조(quiz) 회차도 읽어주기로 이어 간다.
    if (session.current_line_id && session.progress_seq > 0) initial = resumeAt(initial, session.current_line_id);
    return { ...initial, elapsedMs: (session.elapsed_seconds ?? 0) * 1000 };
  });
  const runRef = useRef(run);
  runRef.current = run;

  const [phase, setPhase] = useState<Phase>({ kind: 'preparing', progress: null });
  const [engine, setEngine] = useState<PartnerVoiceEngine>('supertonic');
  /** 지금 상대 줄을 실제로 내는 방식(서버 음성을 못 받은 줄은 engine 과 다르다). */
  const [lineEngine, setLineEngine] = useState<PartnerVoiceEngine | null>(null);
  const [maskMode, setMaskMode] = useState<MaskMode>(script?.maskMode ?? 'none');
  const [aid, setAid] = useState<LineAid>('none');
  const [turnNote, setTurnNote] = useState<TurnNote>(null);
  const [listening, setListening] = useState(false);
  const [notice, setNotice] = useState<Notice>(null);
  const [attempt, setAttempt] = useState(0);
  const [sttMode, setSttMode] = useState<SttPolicy | null>(null);
  const [pendingUploads, setPendingUploads] = useState(0);
  const [different, setDifferent] = useState<DifferentView>({ kind: 'waiting' });
  const engineRef = useRef<PartnerVoiceEngine>('supertonic');
  const deviceVoiceRef = useRef(false);
  const tipHiddenRef = useRef(true);
  const cloudFallbackNoticed = useRef(false);
  const holdRef = useRef<'tip' | 'mask_sheet' | null>(null);
  /** 자동 넘김이 멈춘 동안 일어난 넘김 — 시트를 닫으면 한다. */
  const deferredRef = useRef<Deferred>(null);
  const deferredTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const noticeTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const queueRef = useRef<ProgressQueue | null>(null);
  const speechQueue = useRef<tts.SpeechQueueHandle | null>(null);
  const mounted = useRef(true);
  const scrollRef = useRef<ScrollView | null>(null);
  // 대본을 끝까지 읽으면 앱 평가를 묻는다(7일 간격·최대 3번, SOMA-494). 튜토리얼 대본은 세지 않는다.
  const { after: askRating, element: ratingSheet } = useAppRating();
  const fromTutorialRef = useRef(false);
  const sttActive = useRef(false);
  /** 줄별 시도 번호 — 같은 줄을 다시 말하면 1씩 늘어 이전 녹음을 대체한다(reading.recording). */
  const attempts = useRef<Record<string, number>>({});
  const turnStartedAt = useRef(0);
  /** 180초에 이르러 이미 녹음을 멈추고 올린 줄 — 줄이 끝날 때 다시 올리지 않는다. */
  const recordingClosed = useRef(false);
  /** 내 차례의 전사·녹음을 거두는 중 — 침묵 넘김·[다음]·180초가 겹쳐도 한 번만 거둔다. 새 차례가 열리면 풀린다. */
  const turnClosing = useRef(false);
  // [다시 연습]의 회차 요청 id — 실패 뒤 다시 눌러도 같은 회차 하나가 된다.
  const readAgainRequestId = useRef(newRequestId());
  const [restarting, setRestarting] = useState(false);

  // 서버가 정한 「내 배역이 아닐 때 읽을 목소리」. 내 배역 줄은 읽지 않으니 빼지 않아도 된다.
  const voiceByName = useMemo(() => new Map((script?.characters ?? []).map((c) => [c.name, c.voice] as const)), [script]);
  const presetFor = useCallback((role: string) => voiceByName.get(role) ?? 'F1', [voiceByName]);

  const primeSpeech = useCallback((from: number) => {
    if (!script || !config) return null;
    if (!speechQueue.current) speechQueue.current = tts.createQueueFor(script.id, {
      cloud: engineRef.current === 'cloud',
      synthesizeCloud: synthesizeCloudSpeech,
    });
    const upcoming = config.lines.slice(from, config.endIndex + 1)
      .filter((line): line is DialogueLine => line.type === 'dialogue' && !config.myRoles.includes(line.role))
      .map((line) => ({ text: speakableText(line.text), preset: presetFor(line.role) }));
    speechQueue.current.prime(upcoming);
    return speechQueue.current;
  }, [script, config, presetFor]);

  const flash = useCallback((next: Exclude<Notice, null>) => {
    setNotice((prev) => (next.kind === 'dropped' && prev?.kind === 'dropped' ? { kind: 'dropped', count: prev.count + next.count } : next));
    if (noticeTimer.current) clearTimeout(noticeTimer.current);
    noticeTimer.current = setTimeout(() => mounted.current && setNotice(null), NOTICE_MS);
  }, []);

  // ── 진행 저장 큐 ──────────────────────────────────────────────────────────
  useEffect(() => {
    if (!session) return;
    let live = true;
    const showDifferent = (view: DifferentView) => {
      const run = runRef.current;
      if (!live || !run) return;
      setDifferent(view);
      if (view.kind === 'ready') {
        setLastRunReview({ sessionId: session.id, startIndex: run.startIndex, endIndex: run.endIndex, myRoles: run.myRoles, different: view.lines });
      }
    };
    const queue = openProgressQueue(session.id, {
      send: reportCompletion((body) => saveProgress(session.id, body), { fetchDetail: () => fetchSession(session.id), onView: showDifferent }),
      initialSeq: session.progress_seq ?? 0,
      onClosed: () => {
        // 끝낸 뒤의 409 는 응답을 잃은 완료 저장이라 완료 화면을 그대로 둔다(칸은 reportCompletion 이 회차 상세로 채운다).
        if (mounted.current && runRef.current?.status !== 'done') setPhase({ kind: 'closed', message: t('reading.errorSessionClosed') });
      },
    });
    queueRef.current = queue;
    return () => {
      // 완료 저장이 아직 닿지 않았으면(끊김) 화면을 떠나도 몇 분 더 보내 결과가 회차 상세에 남는다. 앱을 끄면 잃는다.
      closeProgressQueue(session.id, queue, { keepSending: runRef.current?.status === 'done' });
      live = false;
      queueRef.current = null;
    };
  }, [session]);

  useEffect(() => {
    void pendingRecordingUploads().then((n) => mounted.current && setPendingUploads(n));
    return onRecordingQueueChange((n) => mounted.current && setPendingUploads(n));
  }, []);

  /**
   * 내 차례의 녹음을 거둬 큐에 넣는다(reading.recording). STT 가 켜져 있으면 인식기가 남긴 파일(wav)을, 아니면
   * 녹음기 파일(m4a)을 쓴다. 상대역 재생·일시정지 구간의 소리는 마이크가 닫혀 있어 들어가지 않는다.
   * 너무 길거나 커서 보내지 못한 녹음은 위쪽에 「녹음 N개 저장 못 함」으로 잠깐 알리고 진행은 막지 않는다.
   */
  const endTurnRecording = useCallback(
    async (lineId: string, text: string): Promise<void> => {
      const sttUsed = sttActive.current;
      let uri: string | null = null;
      let durationMs = Math.max(0, Date.now() - turnStartedAt.current);
      let kind: 'recorder' | 'stt_persist' = 'recorder';
      if (sttUsed) {
        uri = stt.takeRecordingUri();
        kind = 'stt_persist';
      }
      const fromMic = await mic.stop();
      if (fromMic) {
        uri = fromMic.uri ?? uri;
        durationMs = fromMic.durationMs || durationMs;
        kind = fromMic.uri ? 'recorder' : kind;
      }
      if (!uri) return;
      if (!session?.record || recordingClosed.current) {
        await deleteDeviceFile(uri).catch(() => undefined);
        return;
      }
      const attemptNo = nextAttemptNo(attempts.current, lineId);
      attempts.current[lineId] = attemptNo;
      const fields = transcriptFields({ sttUsed, text });
      const outcome = await enqueueLineRecording({
        requestId: newRequestId(),
        sessionId: session.id,
        lineId,
        attemptNo,
        uri,
        contentType: contentTypeFor(uri, kind),
        durationMs,
        transcript: fields.transcript,
        transcriptSource: fields.transcript_source,
      });
      if (outcome.kind === 'rejected' && (outcome.reason === 'too_large' || outcome.reason === 'too_long')) {
        flash({ kind: 'dropped', count: 1 });
      }
    },
    [flash, mic, session, stt],
  );

  const commit = useCallback((next: RunState) => {
    const prev = runRef.current;
    runRef.current = next;
    setRun(next);
    if (!prev || !session) return;
    if (next.status === 'done') {
      queueRef.current?.push(progressPayload(next));
      setPhase({ kind: 'done' });
      if (!fromTutorialRef.current) void askRating({ kind: 'reading' });
      return;
    }
    // 이어하기의 앞 상대 대사(leadIn)는 저장하지 않는다 — 서버 위치가 뒤로 가지 않게.
    if (next.index !== prev.index && next.leadInUntil === null) queueRef.current?.push(progressPayload(next));
  }, [askRating, session]);

  const goNext = useCallback(
    (from: number) => {
      const cur = runRef.current;
      if (!cur) return;
      const next = advance(cur, from);
      if (next !== cur) commit(next);
    },
    [commit],
  );

  const hasPartnerLines = useMemo(() => {
    if (!config) return false;
    for (let i = config.startIndex; i <= config.endIndex; i++) {
      const l = config.lines[i];
      if (l?.type === 'dialogue' && !config.myRoles.includes(l.role)) return true;
    }
    return false;
  }, [config]);

  const chooseEngine = useCallback((next: PartnerVoiceEngine) => {
    engineRef.current = next;
    setEngine(next);
  }, []);

  /** 실행으로 들어간다. 자동 넘김 안내 팝업을 아직 숨기지 않았으면 그 팝업부터 — 떠 있는 동안 첫 줄을 읽지 않는다. */
  const startRunning = useCallback(() => {
    // 옛 회차(advance=manual)에는 자동 넘김이 없어 팝업도 없다.
    const hold = tipHiddenRef.current || session?.advance !== 'silence' ? null : 'tip';
    holdRef.current = hold;
    setPhase({ kind: 'running', hold });
  }, [session?.advance]);

  // ── 목소리 준비 → 실행 ─────────────────────────────────────────────────────
  const prepare = useCallback(async () => {
    // 모든 배역이 내 배역이면 상대 대사가 없어 목소리를 준비하지 않는다.
    if (!hasPartnerLines) {
      startRunning();
      return;
    }
    const [cloudEnabled, cloudStatus, support, deviceVoice] = await Promise.all([
      loadCloudVoiceEnabled(), api.getCloudVoiceStatus().catch(() => null), readAppVoiceSupport(), hasDeviceVoice(),
    ]);
    if (!mounted.current) return;
    deviceVoiceRef.current = deviceVoice;
    if (shouldUseCloudVoice({ enabled: cloudEnabled, status: cloudStatus })) {
      chooseEngine('cloud');
      startRunning();
      await primeSpeech(runRef.current?.index ?? 0)?.first();
      return;
    }
    if (support.unsupported) {
      chooseEngine(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice }));
      if (support.noticed) startRunning();
      else setPhase({ kind: 'voice_unsupported' });
      return;
    }
    if (!assetsPresent('fp32', 'M1')) {
      const prompt = modelDownloadPrompt({ assetsPresent: false, networkType: await currentNetworkType(), bytes: modelDownloadBytes('fp32') });
      if (prompt.ask) {
        const ok = await confirm({
          title: t('reading.downloadAskTitle'),
          message: t('reading.downloadAskBody', { size: prompt.sizeLabel }),
          confirmLabel: t('reading.downloadNow'),
          cancelLabel: t('reading.deviceVoiceStart'),
        });
        if (!ok) {
          // 받지 않으면 이 회차는 기기 기본 목소리로 읽고, 다음에 다시 물어본다(플래그를 남기지 않는다).
          chooseEngine(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice }));
          startRunning();
          return;
        }
      }
    }
    setPhase({ kind: 'preparing', progress: null });
    try {
      await tts.ensureReady((progress) => {
        // 불러오는 중에 앱이 꺼지면 다음 실행이 이 표시로 알아챈다(voice-capability). 이 화면에서 시작한 불러오기만
        // 센다 — 배경 미리 받기 중에 사용자가 앱을 끄는 것까지 꺼짐으로 보지 않으려고. 여기서도 스와이프로 끈 경우는 가려내지 못한다.
        // 화면을 떠난 뒤에도 불러오기는 이어지므로 끝 표시는 화면과 상관없이 남긴다 — 안 남기면 다음 실행이 「못 씀」으로 굳힌다.
        if (progress.phase === 'load') void markModelLoadStarted();
        if (progress.phase === 'ready') void markModelLoadEnded();
        if (mounted.current) setPhase({ kind: 'preparing', progress });
      });
      if (!mounted.current) return;
      chooseEngine('supertonic');
      await primeSpeech(runRef.current?.index ?? 0)?.first();
      if (mounted.current) startRunning();
    } catch (e) {
      // 원문(메시지·경로)은 보내지 않는다 — 종류만(SOMA-494).
      const kind = voiceErrorKind(e);
      void logEvent('reading_voice_failed', { kind });
      if (kind === 'model_load') {
        await markAppVoiceUnsupported();
        removeDownloadedAssets('fp32');
      }
      if (!mounted.current) return;
      if (kind === 'model_load') {
        chooseEngine(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice }));
        setPhase({ kind: 'voice_unsupported' });
        return;
      }
      const neededBytes = (e as { neededBytes?: unknown } | null)?.neededBytes;
      setPhase({ kind: 'voice_failed', failure: { kind, neededBytes: typeof neededBytes === 'number' ? neededBytes : undefined } });
    }
  }, [confirm, hasPartnerLines, primeSpeech, startRunning, chooseEngine]);

  useEffect(() => {
    mounted.current = true;
    // 대본 리딩 튜토리얼(SOMA-494)은 여기서 끝난다.
    const fromTutorial = currentTutorial()?.track === 'reading';
    fromTutorialRef.current = fromTutorial;
    if (fromTutorial) finishTutorial('done');
    void (async () => {
      const [micOk, tipHidden] = await Promise.all([hasMicPermission(), isAutoAdvanceTipHidden()]);
      if (!mounted.current) return;
      tipHiddenRef.current = tipHidden;
      if (micOk) setSttMode(await detectSttPolicy());
      void prepare();
    })();
    return () => {
      mounted.current = false;
      speechQueue.current?.cancel();
      speechQueue.current = null;
      tts.stop();
      stopDeviceVoice();
      stt.abort();
      void mic.stop();
      if (noticeTimer.current) clearTimeout(noticeTimer.current);
      if (deferredTimer.current) clearTimeout(deferredTimer.current);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (phase.kind === 'running' && (engine === 'cloud' || (engine === 'supertonic' && tts.isReady()))) primeSpeech(run?.index ?? 0);
  }, [phase.kind, engine, run?.index, primeSpeech]);

  const tipOpen = phase.kind === 'running' && phase.hold === 'tip';

  // ── 상대 차례: 목소리로 읽고 넘어간다 ─────────────────────────────────────────
  useEffect(() => {
    const current = runRef.current;
    if (phase.kind !== 'running' || tipOpen || !current || current.status !== 'partner') return;
    const line = current.lines[current.index] as DialogueLine;
    const from = current.index;
    const text = speakableText(line.text);
    const preset = presetFor(line.role);
    let cancelled = false;
    const finish = () => {
      if (cancelled || !mounted.current) return;
      if (holdRef.current) deferredRef.current = { kind: 'advance', from };
      else goNext(from);
    };
    void (async () => {
      try {
        if (engine === 'text_only') {
          setLineEngine('text_only'); // 글로 보기 — 버튼으로 넘긴다
          return;
        }
        if (engine === 'device_voice') {
          setLineEngine('device_voice');
          await speakWithDevice(text, preset);
        } else {
          const ready = await primeSpeech(from)?.take({ text, preset });
          if (cancelled || !mounted.current) return;
          if (ready) {
            setLineEngine(engine);
            await tts.play(ready);
          } else if (engine === 'supertonic') {
            setLineEngine('supertonic');
            await tts.speak(text, preset, { scriptId: script?.id });
          } else {
            // 서버 음성을 못 받은 줄 — 기기 기본 목소리로 읽고 회차에서 처음일 때 알린다. 기기 음성이 없으면 글로 보기.
            if (!deviceVoiceRef.current) {
              setLineEngine('text_only');
              return;
            }
            setLineEngine('device_voice');
            if (!cloudFallbackNoticed.current) {
              cloudFallbackNoticed.current = true;
              flash({ kind: 'cloud_fallback' });
            }
            await speakWithDevice(text, preset);
          }
        }
      } catch (e) {
        // 한 줄을 못 읽어도 다음 줄로 넘어간다. 얼마나 자주 그런지만 남긴다.
        void logEvent('reading_line_voice_failed', { engine, kind: voiceErrorKind(e) });
      }
      finish();
    })();
    return () => {
      cancelled = true;
      setLineEngine(null);
      tts.stop();
      stopDeviceVoice();
    };
  }, [phase.kind, tipOpen, run?.index, run?.status, engine, goNext, presetFor, primeSpeech, script?.id, flash]);

  // ── 내 차례: 마이크(침묵 감지)와 STT ─────────────────────────────────────────
  /** 내 차례를 끝낸다(침묵·[다음]) — 그때까지의 녹음을 거둔 뒤 넘긴다. */
  const endMyTurn = useCallback(
    async (from: number) => {
      const cur = runRef.current;
      if (!cur || !session || cur.index !== from || cur.status !== 'mine' || turnClosing.current) return;
      turnClosing.current = true;
      const text = sttActive.current ? await stt.finish() : '';
      await endTurnRecording(cur.lineIds[cur.index], text);
      sttActive.current = false;
      setListening(false);
      const now = runRef.current;
      if (!now || now.index !== from) return;
      if (text.trim()) commit(recordSaid(now, text));
      goNext(from);
    },
    [session, stt, commit, goNext, endTurnRecording],
  );
  const endMyTurnRef = useRef(endMyTurn);
  endMyTurnRef.current = endMyTurn;

  /** 자동 넘김을 다시 켠다. 멈춘 동안 미뤄 둔 넘김은 지금 하고, 내 차례였으면 침묵을 한 번 더 잰 뒤 넘긴다. */
  const releaseHold = useCallback(() => {
    holdRef.current = null;
    setPhase((p) => (p.kind === 'running' ? { kind: 'running', hold: null } : p));
    const deferred = deferredRef.current;
    deferredRef.current = null;
    if (!deferred || runRef.current?.status === 'paused') return;
    if (deferred.kind === 'advance') goNext(deferred.from);
    else deferredTimer.current = setTimeout(() => void endMyTurnRef.current(deferred.from), DEFAULT_VAD.silenceMs);
  }, [goNext]);

  useEffect(() => {
    if (phase.kind !== 'running' || tipOpen || !run || run.status !== 'mine' || !session) return;
    const from = run.index;
    setAid('none');
    setTurnNote(null);
    let cancelled = false;
    const onEvent = (event: VadEvent) => {
      if (cancelled) return;
      if (event === 'timeout') setTurnNote('silence');
      if (event === 'speech_start' && deferredTimer.current) {
        // 시트를 닫은 뒤 다시 말하기 시작했다 — 미뤄 둔 넘김은 버리고 이번 말이 끝나기를 기다린다.
        clearTimeout(deferredTimer.current);
        deferredTimer.current = null;
      }
      if (event === 'speech_end' && session.advance === 'silence') {
        if (holdRef.current) deferredRef.current = { kind: 'end_turn', from };
        else void endMyTurn(from);
      }
    };
    recordingClosed.current = false;
    turnClosing.current = false;
    turnStartedAt.current = Date.now();
    let limitTimer: ReturnType<typeof setTimeout> | null = null;
    void (async () => {
      let opened = false;
      if (sttMode?.kind === 'stt') {
        const ok = stt.start({ onEvent, onInterim: () => undefined }, { persist: !!session.record });
        sttActive.current = ok;
        opened = ok;
      }
      if (!opened) opened = await mic.start(onEvent);
      if (cancelled) return;
      setListening(opened);
      if (!opened) {
        setTurnNote('silence'); // 마이크를 못 열었다 — 버튼으로 넘긴다
        return;
      }
      if (session.record) {
        // 180초에 이르면 녹음을 멈추고 현재 줄은 그대로다 — 버튼으로 넘긴다.
        limitTimer = setTimeout(() => {
          const cur = runRef.current;
          if (cancelled || turnClosing.current || !cur || cur.index !== from) return;
          turnClosing.current = true;
          void (async () => {
            const text = sttActive.current ? await stt.finish() : '';
            await endTurnRecording(cur.lineIds[cur.index], text);
            recordingClosed.current = true;
            sttActive.current = false;
            setListening(false);
            setTurnNote('limit');
            const now = runRef.current;
            if (now && now.index === from && text.trim()) commit(recordSaid(now, text));
            // 줄은 그대로라 [다음]으로 넘길 수 있게 푼다.
            if (!cancelled) turnClosing.current = false;
          })();
        }, RECORDING_MAX_MS);
      }
    })();
    return () => {
      cancelled = true;
      if (limitTimer) clearTimeout(limitTimer);
      if (deferredTimer.current) clearTimeout(deferredTimer.current);
      deferredTimer.current = null;
      deferredRef.current = null;
      stt.abort();
      sttActive.current = false;
      // 줄이 끝나기 전에 닫히면(일시정지·나가기) 그 소리는 녹음에 들어가지 않는다 — 조각 파일은 지운다.
      void mic.stop().then((r) => {
        if (r?.uri) void deleteDeviceFile(r.uri).catch(() => undefined);
      });
      const leftover = stt.takeRecordingUri();
      if (leftover) void deleteDeviceFile(leftover).catch(() => undefined);
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [phase.kind, tipOpen, run?.index, run?.status, attempt]);

  // ── 흐른 시간(일시정지 제외) ─────────────────────────────────────────────────
  useEffect(() => {
    if (phase.kind !== 'running' || tipOpen) return;
    const timer = setInterval(() => {
      const cur = runRef.current;
      if (!cur || cur.status === 'paused' || cur.status === 'done') return;
      const next = tickElapsed(cur, 1000);
      runRef.current = next;
      setRun(next);
    }, 1000);
    return () => clearInterval(timer);
  }, [phase.kind, tipOpen]);

  // ── 배경 전환: 멈추고 위치를 저장한다. 돌아오면 배우가 이어서를 누른다 ─────────────
  const doPause = useCallback(() => {
    const cur = runRef.current;
    if (!cur || (cur.status !== 'mine' && cur.status !== 'partner')) return;
    tts.stop();
    stopDeviceVoice();
    // 시트가 떠 있는 동안 미뤄 둔 넘김은 버린다 — 이어서는 그 줄을 처음부터 다시 한다.
    deferredRef.current = null;
    if (deferredTimer.current) clearTimeout(deferredTimer.current);
    deferredTimer.current = null;
    const next = pauseRun(cur);
    runRef.current = next;
    setRun(next);
    queueRef.current?.push(progressPayload(next));
  }, []);
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phase.kind === 'running') doPause();
    });
    return () => sub.remove();
  }, [phase.kind, doPause]);

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

  const openMaskSheet = () => {
    if (phase.kind !== 'running' || phase.hold) return;
    holdRef.current = 'mask_sheet';
    setPhase({ kind: 'running', hold: 'mask_sheet' });
  };

  const closeTip = async (hide: boolean) => {
    if (hide) {
      tipHiddenRef.current = true;
      await hideAutoAdvanceTip();
    }
    releaseHold();
  };

  const exitToDetail = () => router.replace('/reading/detail');

  const onExit = async () => {
    const cur = runRef.current;
    if (cur && cur.status !== 'done') {
      const ok = await confirm({ title: t('reading.exitConfirmTitle'), message: exitMessage(cur), confirmLabel: t('reading.exitLeave') });
      if (!ok) return;
      tts.stop();
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
    exitToDetail();
  };

  const readAgain = async () => {
    if (!script || !session || restarting) return;
    setRestarting(true);
    try {
      const next = await startSession(
        script.id,
        buildStartBody({
          requestId: readAgainRequestId.current,
          myCharacterIds: session.my_character_ids,
          startLineId: session.start_line_id,
          endLineId: session.end_line_id,
        }),
      );
      setCurrentSession(next);
      router.replace('/reading/play');
    } catch (e) {
      void alert({ title: t('reading.startFailed'), message: scriptErrorMessage(e) });
    } finally {
      if (mounted.current) setRestarting(false);
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

  if (phase.kind === 'preparing') {
    const progress = phase.progress;
    if (progress?.phase === 'download') {
      return (
        <View style={[styles.root, styles.center]}>
          <View style={styles.downloadCard}>
            <Feather name="download-cloud" size={24} color={palette.blue} />
            <Text style={styles.loadTitle}>{t('reading.voiceDownloadTitle')}</Text>
            <View style={styles.downloadTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: progress.percent }}>
              <View style={[styles.downloadFill, { width: `${progress.percent}%` }]} />
            </View>
            <Text style={styles.progressLine}>{formatDownloadProgress(progress, t)}</Text>
            <Text style={styles.loadNote}>{t('reading.voiceDownloadNote')}</Text>
          </View>
          {dialog}
        </View>
      );
    }
    return (
      <View style={[styles.root, styles.center]}>
        <ActivityIndicator color={palette.blue} />
        <Text style={styles.loadTitle}>
          {progress?.phase === 'load' || progress?.phase === 'ready' ? t('reading.voiceLoadTitle') : t('reading.voicePreparing')}
        </Text>
        {dialog}
      </View>
    );
  }

  if (phase.kind === 'voice_failed') {
    const { failure } = phase;
    return (
      <View style={[styles.root, styles.center]}>
        <Feather name="alert-circle" size={30} color={palette.amber} />
        <Text style={styles.doneTitle}>{t('reading.voiceFailTitle')}</Text>
        {failure.kind === 'storage' ? (
          <Text style={styles.dim}>{t('reading.voiceFailStorage', { size: formatMegabytes(failure.neededBytes ?? modelDownloadBytes('fp32')) })}</Text>
        ) : failure.kind === 'network' ? (
          <Text style={styles.dim}>{t('reading.voiceFailNetwork')}</Text>
        ) : null}
        <Pressable style={styles.primaryWide} onPress={() => void prepare()}>
          <Text style={styles.primaryWideText}>{t('reading.voiceRetry')}</Text>
        </Pressable>
        <Pressable onPress={exitToDetail} hitSlop={8}>
          <Text style={styles.textButton}>{t('reading.exitLeave')}</Text>
        </Pressable>
        {dialog}
      </View>
    );
  }

  if (phase.kind === 'voice_unsupported') {
    return (
      <View style={[styles.root, styles.center]}>
        <Feather name="smartphone" size={30} color={palette.textMuted} />
        <Text style={styles.doneTitle}>{t('reading.voiceUnsupportedTitle')}</Text>
        <Text style={styles.dim}>{t('reading.voiceUnsupportedBody')}</Text>
        <Pressable
          style={styles.primaryWide}
          onPress={() => {
            void markAppVoiceNoticed();
            startRunning();
          }}>
          <Text style={styles.primaryWideText}>{t('reading.continueAnyway')}</Text>
        </Pressable>
        <Pressable onPress={exitToDetail} hitSlop={8}>
          <Text style={styles.textButton}>{t('reading.exitLeave')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase.kind === 'closed') {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{phase.message}</Text>
        <Pressable style={styles.pill} onPress={exitToDetail}>
          <Text style={styles.pillText}>{t('reading.toDetail')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase.kind === 'done') {
    const readCount = readDialogueCount(run.lines, run.startIndex, run.endIndex);
    const wholeScript = run.startIndex <= run.lines.findIndex((l) => l.type === 'dialogue') && run.endIndex >= run.lines.length - 1;
    const compared = sttMode?.kind === 'stt';
    const textOf = (lineId: string) => run.lines[run.lineIds.indexOf(lineId)]?.text ?? '';
    return (
      <View style={styles.root}>
        <ScrollView contentContainerStyle={[styles.doneContent, { paddingTop: insets.top + 24 }]}>
          <View style={styles.doneIcon}>
            <Feather name="check" size={28} color="#fff" />
          </View>
          <Text style={styles.doneTitle}>{t('reading.completeTitle')}</Text>
          <Text style={styles.dim}>{script.title}</Text>
          <View style={styles.doneStats}>
            <Text style={styles.doneStat}>{t('reading.doneMyRole', { roles: run.myRoles.join(', ') })}</Text>
            <Text style={styles.doneStat}>
              {t('reading.doneRead', { count: readCount })}
              {!wholeScript ? ` · ${t('reading.donePartialNote')}` : ''}
            </Text>
            <Text style={styles.doneStat}>{t('reading.doneTime', { time: mmss(run.elapsedMs) })}</Text>
            {pendingUploads > 0 && <Text style={styles.doneStatFaint}>{t('reading.recordingPending', { count: pendingUploads })}</Text>}
          </View>

          {!compared ? (
            <View style={styles.noteBox}>
              <Feather name="info" size={16} color={palette.textMuted} />
              <Text style={styles.noteText}>{t('reading.noSttNote')}</Text>
            </View>
          ) : different.kind === 'waiting' ? (
            <View style={styles.noteBox}>
              <ActivityIndicator size="small" color={palette.textMuted} />
              <Text style={styles.noteText}>{t('reading.differentWaiting')}</Text>
            </View>
          ) : different.kind === 'later' ? (
            <View style={styles.noteBox}>
              <Feather name="wifi-off" size={16} color={palette.textMuted} />
              <Text style={styles.noteText}>{t('reading.differentLater')}</Text>
            </View>
          ) : different.kind === 'ready' && different.lines.length > 0 ? (
            <View style={styles.diffBox}>
              <View style={styles.diffHead}>
                <Text style={styles.diffTitle}>{t('reading.differentTitle')}</Text>
                <Text style={styles.diffCount}>{t('reading.differentCount', { count: different.lines.length })}</Text>
              </View>
              {different.lines.slice(0, 2).map((d) => (
                <View key={d.line_id} style={styles.diffRow}>
                  <Text style={styles.diffNo}>{t('reading.lineNo', { n: d.dialogue_no })}</Text>
                  <DiffText text={textOf(d.line_id)} different={d} />
                </View>
              ))}
              <Pressable style={styles.diffAll} onPress={() => router.push('/reading/diff')} hitSlop={6}>
                <Text style={styles.diffAllText}>{t('reading.seeAll')}</Text>
                <Feather name="chevron-right" size={16} color={palette.blueDeep} />
              </Pressable>
            </View>
          ) : null}

          <Pressable style={styles.coachCard} onPress={() => router.replace('/upload')}>
            <Feather name="video" size={18} color={palette.blueDeep} />
            <View style={styles.coachBody}>
              <Text style={styles.coachTitle}>{t('reading.coachTitle')}</Text>
              <Text style={styles.coachText}>{t('reading.coachBody')}</Text>
            </View>
            <Text style={styles.coachGo}>{t('reading.coachGo')}</Text>
          </Pressable>
        </ScrollView>
        <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
          <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={() => void readAgain()} disabled={restarting}>
            {restarting ? <ActivityIndicator size="small" color={palette.textDim} /> : <Feather name="rotate-ccw" size={16} color={palette.textDim} />}
            <Text style={styles.ctrlGhostText}>{t('reading.readAgain')}</Text>
          </Pressable>
          <Pressable style={[styles.ctrl, styles.ctrlPrimary]} onPress={exitToDetail}>
            <Text style={styles.ctrlPrimaryText}>{t('reading.finish')}</Text>
          </Pressable>
        </View>
        {dialog}
        {ratingSheet}
      </View>
    );
  }

  // running
  const hold = phase.hold;
  const line = run.lines[run.index];
  const isDialogue = !!line && line.type === 'dialogue';
  const myTurn = run.status === 'mine' || (run.status === 'paused' && run.resumeTo === 'mine');
  const paused = run.status === 'paused';
  const mineOf = (l: ScriptLine) => l.type === 'dialogue' && run.myRoles.includes(l.role);
  const hiddenOf = (l: ScriptLine) => isHidden({ maskMode, line: l, isMine: mineOf(l) });
  const currentText = line ? shownText(line.text, hiddenOf(line), aid) : null;
  const masking = maskMode !== 'none';
  const shownEngine = lineEngine ?? engine;

  const chip = (() => {
    if (hold === 'tip') return { icon: 'volume-2' as const, label: t('reading.chipBeforeStart') };
    if (paused) return { icon: 'pause' as const, label: t('reading.pause') };
    if (!myTurn) {
      return shownEngine === 'text_only'
        ? { icon: 'book-open' as const, label: t('reading.chipTextOnly') }
        : { icon: 'volume-2' as const, label: t('reading.chipReading') };
    }
    if (hold === 'mask_sheet') return { icon: 'pause' as const, label: t('reading.chipHold') };
    if (turnNote === 'limit') return { icon: 'mic-off' as const, label: t('reading.chipLimit') };
    if (listening) return { icon: 'bars' as const, label: t('reading.listening') };
    return { icon: 'mic' as const, label: t('reading.chipMicOpening') };
  })();

  const hint = paused ? t('reading.pausedBody') : myTurn && turnNote === 'silence' ? t('reading.silenceHint') : myTurn && turnNote === 'limit' ? t('reading.limitHint') : null;

  const past: { key: string; line: ScriptLine }[] = [];
  for (let i = run.startIndex; i < run.index && i <= run.endIndex; i++) past.push({ key: run.lineIds[i], line: run.lines[i] });

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable style={styles.exitBtn} onPress={() => void onExit()} hitSlop={8}>
          <Feather name="x" size={20} color={palette.textDim} />
          <Text style={styles.exitText}>{t('reading.exitLeave')}</Text>
        </Pressable>
        {notice?.kind === 'dropped' ? <Text style={styles.droppedText}>{t('reading.recordingDropped', { count: notice.count })}</Text> : <View />}
        <Text style={styles.counter}>{formatProgress(run)}</Text>
      </View>
      <View style={styles.progressTrack}>
        <View style={[styles.progressFill, { width: `${Math.round((progressOf(run).done / Math.max(1, progressOf(run).total)) * 100)}%` }]} />
      </View>
      {notice?.kind === 'cloud_fallback' && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{t('reading.cloudFallbackToast')}</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.flow}
        contentContainerStyle={styles.flowContent}
        onContentSizeChange={() => scrollRef.current?.scrollToEnd({ animated: true })}>
        {past.map(({ key, line: l }) =>
          l.type === 'dialogue' ? (
            <View key={key} style={styles.pastRow}>
              <Text style={styles.pastRole}>{l.role}</Text>
              {hiddenOf(l) ? <HiddenBars text={l.text} tone="past" /> : <Text style={styles.pastText}>{l.text}</Text>}
            </View>
          ) : (
            <Text key={key} style={styles.direction}>{l.type === 'direction' ? directionLabel(l.text) : l.text}</Text>
          ),
        )}

        {isDialogue && (
          <View style={[styles.card, myTurn ? styles.cardMine : styles.cardOther]}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardRole, myTurn && styles.cardRoleMine]}>
                {(line as DialogueLine).role}
                {myTurn ? ` · ${t('reading.myTurn')}` : ''}
              </Text>
              <View style={styles.chip}>
                {chip.icon === 'bars' ? <ListeningBars /> : <Feather name={chip.icon} size={14} color={myTurn ? palette.blueDeep : palette.textMuted} />}
                <Text style={[styles.chipText, myTurn && styles.chipTextMine]}>{chip.label}</Text>
              </View>
            </View>
            {currentText === null ? (
              <HiddenBars text={line.text} tone="current" />
            ) : aid === 'first_word' && hiddenOf(line) ? (
              <View style={styles.firstWordRow}>
                <Text style={styles.lineText}>{currentText}</Text>
                <View style={styles.firstWordRest}>
                  <HiddenBars text={line.text.trim().slice(currentText.length)} tone="current" />
                </View>
              </View>
            ) : (
              <Text style={styles.lineText}>{currentText}</Text>
            )}
            {myTurn && hiddenOf(line) && aid !== 'original' && (
              <View style={styles.aidRow}>
                {aid === 'none' && (
                  <Pressable style={styles.aidPill} onPress={() => setAid('first_word')}>
                    <Feather name="type" size={14} color={palette.blueDeep} />
                    <Text style={styles.aidText}>{t('reading.firstWord')}</Text>
                  </Pressable>
                )}
                <Pressable style={styles.aidPill} onPress={() => setAid('original')}>
                  <Feather name="eye" size={14} color={palette.blueDeep} />
                  <Text style={styles.aidText}>{t('reading.showOriginal')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}
      </ScrollView>

      {!!hint && <Text style={styles.hint}>{hint}</Text>}

      <View style={[styles.controls, { paddingBottom: insets.bottom + 12 }]}>
        <Pressable style={[styles.eyeBtn, masking && styles.eyeBtnOn]} onPress={openMaskSheet} hitSlop={4} accessibilityLabel={t('reading.maskSheetTitle')}>
          <Feather name={masking ? 'eye-off' : 'eye'} size={20} color={masking ? palette.blueDeep : palette.textDim} />
          {masking && <View style={styles.eyeDot} />}
        </Pressable>
        {paused ? (
          <Pressable style={[styles.ctrl, styles.ctrlPrimary]} onPress={doResume}>
            <Feather name="play" size={16} color="#fff" />
            <Text style={styles.ctrlPrimaryText}>{t('reading.resume')}</Text>
          </Pressable>
        ) : (
          <>
            <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={doPause}>
              <Feather name="pause" size={16} color={palette.textDim} />
              <Text style={styles.ctrlGhostText}>{t('reading.pause')}</Text>
            </Pressable>
            <Pressable
              style={[styles.ctrl, styles.ctrlPrimary, hold === 'tip' && styles.ctrlOff]}
              disabled={hold === 'tip'}
              onPress={() => {
                if (myTurn) void endMyTurn(run.index);
                else goNext(run.index);
              }}>
              <Text style={styles.ctrlPrimaryText}>{t('reading.next')}</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>
          </>
        )}
      </View>

      <Modal transparent statusBarTranslucent visible={hold === 'tip'} animationType="fade" onRequestClose={() => void closeTip(false)}>
        <View style={styles.backdrop}>
          <View style={styles.tipCard}>
            <Text style={styles.tipTitle}>{t('reading.autoAdvanceTip')}</Text>
            <View style={styles.tipRow}>
              <Pressable style={[styles.tipBtn, styles.tipBtnGhost]} onPress={() => void closeTip(true)}>
                <Text style={styles.tipBtnGhostText}>{t('reading.dontShowAgain')}</Text>
              </Pressable>
              <Pressable style={[styles.tipBtn, styles.tipBtnPrimary]} onPress={() => void closeTip(false)}>
                <Text style={styles.tipBtnPrimaryText}>{t('common.confirm')}</Text>
              </Pressable>
            </View>
          </View>
        </View>
      </Modal>

      <Modal transparent statusBarTranslucent visible={hold === 'mask_sheet'} animationType="slide" onRequestClose={releaseHold}>
        <Pressable style={[styles.backdrop, styles.backdropSheet]} onPress={releaseHold}>
          <Pressable style={[styles.sheet, { paddingBottom: insets.bottom + 16 }]} onPress={(e) => e.stopPropagation()}>
            <View style={styles.sheetHandle} />
            <Text style={styles.sheetTitle}>{t('reading.maskSheetTitle')}</Text>
            <Text style={styles.sheetNote}>{t('reading.maskSheetNote')}</Text>
            {MASKS.map((m) => {
              const on = maskMode === m.key;
              return (
                <Pressable key={m.key} style={styles.sheetRow} onPress={() => changeMask(m.key)} accessibilityRole="radio" accessibilityState={{ checked: on }}>
                  <View style={styles.sheetRowBody}>
                    <Text style={[styles.sheetRowTitle, on && styles.sheetRowTitleOn]}>{m.label}</Text>
                    <Text style={styles.sheetRowDesc}>{m.desc}</Text>
                  </View>
                  <View style={[styles.radio, on && styles.radioOn]}>{on && <View style={styles.radioDot} />}</View>
                </Pressable>
              );
            })}
          </Pressable>
        </Pressable>
      </Modal>
      {dialog}
    </View>
  );
}

/** 가린 대사 자리의 회색 막대. 글 길이만큼 줄을 나눠 대사가 얼마나 긴지만 짐작하게 한다. */
function HiddenBars({ text, tone }: { text: string; tone: 'past' | 'current' }) {
  const len = Math.max(1, [...text.trim()].length);
  const perLine = 18;
  const lines = Math.min(3, Math.ceil(len / perLine));
  const lastWidth = `${Math.max(18, Math.round((((len - 1) % perLine) + 1) / perLine * 100))}%` as const;
  return (
    <View style={styles.bars}>
      {Array.from({ length: lines }, (_, i) => (
        <View key={i} style={[tone === 'past' ? styles.barPast : styles.barCurrent, { width: i === lines - 1 ? lastWidth : '100%' }]} />
      ))}
    </View>
  );
}

/** 「듣는 중」 소리 막대. */
function ListeningBars() {
  return (
    <View style={styles.listenBars}>
      {[6, 12, 16, 10, 6].map((h, i) => (
        <View key={i} style={[styles.listenBar, { height: h }]} />
      ))}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.bg },
  center: { alignItems: 'center', justifyContent: 'center', gap: 12, padding: 28 },
  dim: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 15, textAlign: 'center', lineHeight: 22 },
  loadTitle: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 16, marginTop: 4, textAlign: 'center' },
  loadNote: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center' },
  downloadCard: { alignSelf: 'stretch', alignItems: 'center', gap: 12, backgroundColor: palette.bgSubtle, borderRadius: 16, paddingVertical: 24, paddingHorizontal: 20 },
  downloadTrack: { alignSelf: 'stretch', height: 8, borderRadius: 4, backgroundColor: palette.border, overflow: 'hidden' },
  downloadFill: { height: 8, borderRadius: 4, backgroundColor: palette.blue },
  progressLine: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14, textAlign: 'center' },
  primaryWide: { alignSelf: 'stretch', backgroundColor: palette.blue, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  primaryWideText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  textButton: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 15, paddingVertical: 10 },

  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 4, textAlign: 'center' },
  doneContent: { alignItems: 'center', gap: 12, padding: 24 },
  doneStats: { alignSelf: 'stretch', backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 6 },
  doneStat: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14, lineHeight: 21 },
  doneStatFaint: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12 },
  noteBox: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 10, backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14 },
  noteText: { flex: 1, color: palette.textDim, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19 },
  diffBox: { alignSelf: 'stretch', backgroundColor: palette.card, borderColor: palette.border, borderWidth: 1, borderRadius: 14, padding: 14, gap: 12 },
  diffHead: { flexDirection: 'row', alignItems: 'baseline', justifyContent: 'space-between', borderBottomColor: palette.borderSoft, borderBottomWidth: 1, paddingBottom: 10 },
  diffTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  diffCount: { color: palette.amber, fontFamily: 'Pretendard-SemiBold', fontSize: 13, backgroundColor: palette.amberSoft, borderRadius: 999, paddingHorizontal: 8, paddingVertical: 2, overflow: 'hidden' },
  diffRow: { gap: 4 },
  diffNo: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  diffAll: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 2, paddingTop: 2 },
  diffAllText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  coachCard: { alignSelf: 'stretch', flexDirection: 'row', alignItems: 'center', gap: 12, backgroundColor: palette.blueMist, borderColor: palette.blueLine, borderWidth: 1, borderRadius: 14, padding: 14 },
  coachBody: { flex: 1, gap: 2 },
  coachTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 14 },
  coachText: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 17 },
  coachGo: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  exitBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  exitText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  droppedText: { color: palette.danger, fontFamily: 'Pretendard-Bold', fontSize: 12 },
  counter: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  progressTrack: { height: 4, backgroundColor: palette.bgSoft, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.blue },
  toast: { marginHorizontal: 16, marginTop: 10, backgroundColor: palette.text, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  toastText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },

  flow: { flex: 1 },
  flowContent: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 16, paddingTop: 16, paddingBottom: 8, gap: 14 },
  direction: { color: palette.checkOff, fontFamily: 'Pretendard', fontSize: 13, lineHeight: 19, textAlign: 'center' },
  pastRow: { gap: 3, paddingHorizontal: 8 },
  pastRole: { color: palette.checkOff, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  pastText: { color: palette.checkOff, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  card: { borderRadius: 16, padding: 18, gap: 12, borderWidth: 1.5 },
  cardOther: { backgroundColor: palette.bgSoft, borderColor: palette.bgSoft },
  cardMine: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 13, flexShrink: 1 },
  cardRoleMine: { color: palette.blueDeep },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  chipTextMine: { color: palette.blueDeep },
  lineText: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 20, lineHeight: 30 },
  firstWordRow: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  firstWordRest: { flex: 1 },
  aidRow: { flexDirection: 'row', gap: 8, flexWrap: 'wrap' },
  aidPill: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.card, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  aidText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  bars: { gap: 8, justifyContent: 'center' },
  barPast: { height: 10, borderRadius: 5, backgroundColor: palette.bgSoft },
  barCurrent: { height: 14, borderRadius: 7, backgroundColor: palette.blueLine },
  listenBars: { flexDirection: 'row', alignItems: 'center', gap: 2, height: 16 },
  listenBar: { width: 3, borderRadius: 2, backgroundColor: palette.blue },
  hint: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 13, textAlign: 'center', paddingHorizontal: 20, paddingBottom: 10, lineHeight: 19 },

  controls: { flexDirection: 'row', gap: 10, paddingHorizontal: 16, paddingTop: 12, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  eyeBtn: { width: 52, height: 52, borderRadius: 12, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  eyeBtnOn: { backgroundColor: palette.blueSoft },
  eyeDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: palette.blue },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15 },
  ctrlGhost: { backgroundColor: palette.bgSoft },
  ctrlGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
  ctrlPrimary: { backgroundColor: palette.blue },
  ctrlOff: { backgroundColor: palette.checkOff },
  ctrlPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },

  backdrop: { flex: 1, backgroundColor: 'rgba(15, 21, 37, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
  backdropSheet: { justifyContent: 'flex-end', padding: 0 },
  tipCard: { width: '100%', maxWidth: 340, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 26, paddingBottom: 18, gap: 22 },
  tipTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 17, textAlign: 'center' },
  tipRow: { flexDirection: 'row', gap: 8 },
  tipBtn: { flex: 1, borderRadius: 14, paddingVertical: 14, alignItems: 'center' },
  tipBtnGhost: { backgroundColor: palette.bgSoft },
  tipBtnGhostText: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15 },
  tipBtnPrimary: { backgroundColor: palette.blue },
  tipBtnPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 15 },
  sheet: { width: '100%', backgroundColor: palette.card, borderTopLeftRadius: 22, borderTopRightRadius: 22, paddingHorizontal: 22, paddingTop: 10, gap: 4 },
  sheetHandle: { alignSelf: 'center', width: 36, height: 4, borderRadius: 2, backgroundColor: palette.border, marginBottom: 14 },
  sheetTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 18 },
  sheetNote: { color: palette.blueDeep, fontFamily: 'Pretendard', fontSize: 13, marginBottom: 6 },
  sheetRow: { flexDirection: 'row', alignItems: 'center', gap: 12, paddingVertical: 14, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  sheetRowBody: { flex: 1, gap: 3 },
  sheetRowTitle: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 15 },
  sheetRowTitleOn: { color: palette.blueDeep },
  sheetRowDesc: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  radio: { width: 22, height: 22, borderRadius: 11, borderWidth: 1.5, borderColor: palette.checkOff, alignItems: 'center', justifyContent: 'center' },
  radioOn: { borderColor: palette.blue, backgroundColor: palette.blue },
  radioDot: { width: 8, height: 8, borderRadius: 4, backgroundColor: '#fff' },
});
