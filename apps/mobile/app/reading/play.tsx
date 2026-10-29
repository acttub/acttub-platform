import { AdSlot } from '@/components/ad-slot';
import { clearReachedEnd, markReachedEnd } from '@/lib/reading/progress-display';
import Feather from '@expo/vector-icons/Feather';
import { useNavigation, useRouter } from 'expo-router';
import { Fragment, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { usePreventRemove } from '@react-navigation/native';
import { AppState, Linking, Modal, Platform, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { useAppDialog } from '@/components/app-dialog';
import { DiffText } from '@/components/diff-text';
import { LineEditSheet } from '@/components/line-edit-sheet';
import { logEvent } from '@/lib/analytics';
import { hasMicPermission, micPermissionGranted, useReadingMic } from '@/hooks/use-reading-mic';
import { detectSttPolicy, useReadingStt } from '@/hooks/use-reading-stt';
import { deleteDeviceFile } from '@/lib/account-files';
import { hasSeenFirstReadingGuide, hideAutoAdvanceTip, isAutoAdvanceTipHidden, markFirstReadingGuideSeen } from '@/lib/reading/guide-flag';
import { PrimaryButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InfoBanner } from '@/components/ui/info-banner';
import { ReadingCoachMark } from '@/components/ui/reading-coach-mark';
import { ReadingStatus } from '@/components/ui/reading-status';
import { COACH_MARKS, coachMarkFor, readingCoachScene, wrapUpProgress, type CoachMark } from '@/lib/reading/redesign-748';
import { keepReadingInBackground } from '@/lib/reading/ios-audio-restore';
import { liveStateOf, sceneLabelAt, turnChip } from '@/lib/reading/live';
import { onReadingLiveEvent, readingKeepsRunning, startReadingLive, stopReadingLive, updateReadingLive } from '@/modules/reading-live';
import { setContinueOrigin } from '@/lib/practice/session-state';
import { Image } from 'expo-image';
import { finishTutorial } from '@/hooks/use-tutorial-spotlight';
import { useWaitExit } from '@/hooks/use-wait-exit';
import { currentTutorial } from '@/lib/tutorial';
import { currentNetworkType } from '@/lib/reading/network';
import { speakableText } from '@/lib/reading/tts/speakable';
import { lineLanguage, speechLocaleFor, speechParts } from '@/lib/reading/line-language';
import type { LineDraft } from '@/lib/reading/line-edit';
import type { DialogueLine, ScriptLine } from '@/lib/reading/types';
import { closeProgressQueue, openProgressQueue, trackLeavingSave, type ProgressQueue } from '@/lib/reading/progress-queue';
import { RECORDING_MAX_MS, contentTypeFor, nextAttemptNo, transcriptFields } from '@/lib/reading/recording-plan';
import { enqueueLineRecording, onRecordingQueueChange, pendingRecordingUploads } from '@/lib/reading/recording-runner';
import { scriptErrorMessage } from '@/lib/reading/script-errors';
import { buildStartBody, roleLabel, turnRoles } from '@/lib/reading/session-plan';
import { saidEnough } from '@/lib/reading/line-coverage';
import { diffWords } from '@/lib/reading/word-diff';
import { finishMonologueRun, isMonologue, livePosition, monologueResults, sentenceIndexes } from '@/lib/reading/monologue';
import { lineGroups } from '@/lib/reading/line-groups';
import { beatMs, directionsBefore } from '@/lib/reading/direction-beat';
import { directionLabel, readDialogueCount, reportCompletion, type DifferentView } from '@/lib/reading/session-results';
import { readingRunCompleted, sessionHasRecognized } from '@/lib/practice/counted';
import { markFirstUseGraduated } from '@/lib/practice/first-use-graduation';
import { isFirstReadingSession, markReadingFinished } from '@/lib/reading/first-reading';
import {
  advance,
  applyLineEdit,
  back as backRun,
  canGoBack,
  createRun,
  discardOnExit,
  formatProgress,
  isHidden,
  jumpTo,
  mmss,
  pause as pauseRun,
  progressOf,
  progressPayload,
  stoppedProgressPayload,
  recordSaid,
  resume as resumeRun,
  resumeRun as resumeAt,
  shownText,
  stopRun,
  tickElapsed,
  turnSpan,
  type LineAid,
  type RunState,
} from '@/lib/reading/session-run';
import {
  deleteSession,
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
import { activeVariant, missingModelBytes, modelDownloadBytes, removeDownloadedAssets } from '@/lib/reading/tts/assets';
import { formatDownloadProgress, loadPercent, type VoiceProgress } from '@/lib/reading/tts/download-progress';
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
import { ReadingAfterCard } from '@/components/reading-after-card';
import { LoadingText } from '@/components/ui/loading-text';
import { translate as t } from '@/lib/i18n';
import { useAppRating } from '@/hooks/use-app-rating';
import { ReadingRating } from '@/components/reading-rating';
import { useKeyboardHeight } from '@/hooks/use-keyboard-height';
import { MASCOT as MASCOT_IMG, type MascotPose } from '@/components/ui/mascot';
import { api } from '@/lib/api';
import { skipsFirstReadingGuide } from '@/lib/returning-account';
import { loadCloudVoiceEnabled, shouldUseCloudVoice } from '@/lib/reading/cloud-voice';
import { synthesizeCloudSpeech } from '@/lib/reading/cloud-voice-runtime';
import { exampleVoicesMatch, type ExampleAudio } from '@/lib/reading/example-audio';
import { exampleLineUri, loadExampleAudio, prefetchExampleLines } from '@/lib/reading/example-audio-runtime';
import { newRequestId } from '@/lib/request-id';

/**
 * 연습 실행(R9, reading.session). R8 시작·회차 상세 [이어서 연습]·완료의 [다시 연습]으로 들어온다.
 *
 * 화면은 「대본 흐름」 — 지나간 줄(지문 포함)이 위로 흐리게 쌓이고 지금 줄 카드가 맨 아래, 다음 대사는 보이지 않는다.
 * 상대 대사는 목소리(고품질 → 앱 모델 → 기기 기본 목소리 → 글로 보기, voice-capability)로 읽고 내 대사에서 멈춰
 * 기다린다. 내 차례는 1.8초 침묵이나 [다음]으로 넘어가고 늘 녹음된다. 말한 것은 전사해 진행 저장에 싣고, 서버가 원문과
 * 비교해 완료 저장 응답으로 돌려주면 완료 화면(R9.23)이 「원문과 다르게 말한 대사」로 그린다. 대사 보기 시트가 떠 있는
 * 동안은 자동 넘김만 멈춘다(녹음·상대 읽기는 계속). 진행 위치는 줄이 바뀔 때·일시정지·나가기·완료 때 서버에 남고(progress-queue),
 * 재개는 그 줄을 처음부터 다시 한다. 다른 앱으로 넘어가거나 화면을 잠가도 리딩은 이어지고(SOMA-802, modules/reading-live),
 * 전화 등으로 소리가 실제로 끊겼을 때만 멈춘다.
 *
 * 실기기 오디오(녹음·음성 합성·음성인식의 동시 사용)는 자동화 테스트로 검증하지 않는다 — 순수 규칙은
 * session-run·session-results·voice-capability·vad·progress-queue 가 지키고, 여기서는 그것들을 잇는다.
 */
type Phase =
  | { kind: 'preparing'; progress: VoiceProgress | null }
  /** 마이크 권한이 없다 — 리딩은 녹음이 필수라 진행하지 않는다(SOMA-626). 「이어서 연습」·「다시 읽기」도 여기서 막힌다. */
  | { kind: 'need_mic' }
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
type Notice = null | { kind: 'dropped'; count: number } | { kind: 'cloud_fallback' } | { kind: 'jump'; text: string };

type Deferred = null | { kind: 'advance' | 'end_turn'; from: number };

/** 예시 음성이 그 줄의 것인지 가르는 값 — 배역과 글이 고른 때와 같아야 한다. */
function exampleLineSignature(line: ScriptLine | undefined): string {
  return line?.type === 'dialogue' ? `${line.role}\n${line.text}` : '';
}

const MASKS: { key: MaskMode; label: string; desc: string }[] = [
  { key: 'none', label: t('reading.maskNone'), desc: t('reading.maskNoneDesc') },
  { key: 'mine', label: t('reading.maskMine'), desc: t('reading.maskMineDesc') },
  { key: 'all', label: t('reading.maskAll'), desc: t('reading.maskAllDesc') },
];
const NOTICE_MS = 4000;
/** 지나간 대사로 돌아갈 때 안내에 보이는 대사 앞부분의 글자 수. */
const JUMP_PREVIEW = 15;
/** 완료 화면이 뜬 뒤 버튼을 받지 않는 시간. */
const DONE_LOCK_MS = 800;
/** 독백에서 받아쓴 글로 읽는 위치를 다시 재는 간격 — 중간 결과마다 전체를 맞추지 않게. */
const MONO_POSITION_MS = 700;
/**
 * 리딩 화면의 액티(10/22 20종). 예전엔 준비·마무리·결과가 모두 하트 눈 한 장이라 매번 같았다(10/25 피드백).
 * 준비 중은 기다리는 자세, 끝난 화면은 들어올 때마다 밝은 자세 하나, 세지 않은 회차는 민망한 자세.
 */
const PREP_POSES: readonly MascotPose[] = ['breathe', 'reading', 'hamlet'];
// 'smug'(팔짱·곁눈질)는 뺐다 — 리딩을 끝낸 칭찬 화면에서 못마땅해 보였다(10/28 폰 확인).
const DONE_POSES: readonly MascotPose[] = ['love', 'jump', 'dance', 'wink', 'bow'];
const NOT_COUNTED_POSE: MascotPose = 'flat';
const FIRST_DONE_POSE: MascotPose = 'jump';
function pickPose(poses: readonly MascotPose[]): MascotPose {
  return poses[Math.floor(Math.random() * poses.length)] ?? poses[0];
}

const COACH_TEXT: Record<CoachMark, string> = {
  partner: 'reading.coachPartner',
  mine: 'reading.coachMine',
  next: 'reading.coachNext',
  alone: 'reading.coachAlone',
};

export default function ReadingPlay() {
  const router = useRouter();
  // 한 번 들어온 동안은 같은 자세 — 다시 그릴 때마다 바뀌면 깜빡여 보인다.
  const [prepPose] = useState(() => pickPose(PREP_POSES));
  const [donePose] = useState(() => pickPose(DONE_POSES));
  const navigation = useNavigation();
  const insets = useSafeAreaInsets();
  const { confirm, alert, dialog } = useAppDialog();
  /** 묶인 대사에서 고칠 줄 고르기(R9.31b) — 열려 있으면 고를 줄 글과 고른 뒤 할 일. */
  const script = getCurrent();
  const session = getCurrentSession();
  /** 첫 리딩 모드로 시작한 회차(10/29) — 위에 「그만 읽기」를 두고, 멈춰도 첫 리딩 끝 화면으로 간다. */
  const firstReading = isFirstReadingSession(session?.id);
  const firstStoppedRef = useRef(false);
  const mic = useReadingMic();
  const stt = useReadingStt();

  const config = useMemo(() => {
    if (!script || !session) return null;
    const startIndex = script.lineIds.indexOf(session.start_line_id);
    const endIndex = script.lineIds.indexOf(session.end_line_id);
    if (startIndex < 0 || endIndex < 0) return null;
    // 진행은 함께 말하는 줄까지 내 차례로 센다(turnRoles). 화면에 「내 배역」으로 보이는 것은 고른 배역 이름만이다.
    const myNames = script.characters.filter((c) => session.my_character_ids.includes(c.id)).map((c) => c.name);
    return {
      lines: script.lines,
      lineIds: script.lineIds,
      myRoles: turnRoles(script.characters, session.my_character_ids),
      myNames,
      startIndex,
      endIndex,
      // 같은 배역 연속 대사는 한 차례로 묶는다(SOMA-806). 독백은 문장마다 따로 맞춘다.
      monologue: isMonologue(script.characters),
    };
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
  const phaseKindRef = useRef(phase.kind);
  phaseKindRef.current = phase.kind;
  /** [시작]을 눌렀는지 — 누르기 전에 나가면 이번 회차를 남기지 않는다(discardOnExit). */
  const startedRef = useRef(false);
  /** 이 화면이 연 회차(다시 연습으로 현재 회차가 바뀌어도 이 화면 것만 지운다)와, 이미 지웠는지. */
  const ownSession = useRef(session).current;
  const discardedRef = useRef(false);
  /** 「나가기」를 눌렀다 — 화면을 떠나도 진행 저장 큐를 버리지 않고 마저 보낸다. */
  const leavingRef = useRef(false);
  /** 멈춘 채 「그만하기」로 끝냈다 — 끝까지 간 게 아니므로 「끝까지 갔다」 표시를 남기지 않는다. */
  const stoppedEarlyRef = useRef(false);
  const [engine, setEngine] = useState<PartnerVoiceEngine>('supertonic');
  /** 지금 상대 줄을 실제로 내는 방식(서버 음성을 못 받은 줄은 engine 과 다르다). */
  const [lineEngine, setLineEngine] = useState<PartnerVoiceEngine | null>(null);
  const [maskMode, setMaskMode] = useState<MaskMode>(script?.maskMode ?? 'none');
  const [aid, setAid] = useState<LineAid>('none');
  const [turnNote, setTurnNote] = useState<TurnNote>(null);
  /** 지금 내 차례를 끝냈다(말이 끝남·[다음]·녹음 3분) — 가린 내 대사를 원문으로 펼친다(SOMA-785). 새 차례가 열리면 풀린다. */
  const [turnDone, setTurnDone] = useState(false);
  /** 다른 앱에 있는 동안 전화 등으로 끊겨 멈췄다 — 돌아온 화면에 그 까닭을 알린다(R9.18 변형). 이어서를 누르면 풀린다. */
  const [interrupted, setInterrupted] = useState(false);
  const [listening, setListening] = useState(false);
  /** 내 차례에 인식기가 지금까지 알아들은 글(중간 결과). 대사 아래 「방금 말한 것」에 보인다. */
  const [said, setSaid] = useState('');
  // 말 끝 판단은 다시 그리기 전에 온다 — 받아쓴 글을 바로 읽을 수 있게 따로 든다(SOMA-804).
  const saidRef = useRef('');
  const [notice, setNotice] = useState<Notice>(null);
  /** 무료 배우의 두 번째 리딩부터 「Pro는 계속 이 목소리로」 한 줄을 보인다(SOMA-917). */
  const [proVoiceHint, setProVoiceHint] = useState(false);
  const proVoiceHintLogged = useRef(false);
  const [attempt, setAttempt] = useState(0);
  const [sttMode, setSttMode] = useState<SttPolicy | null>(null);
  // commit 은 정책이 바뀌어도 다시 만들지 않는다 — 완료 판정은 최신 정책을 ref 로 읽는다.
  const sttModeRef = useRef<SttPolicy | null>(null);
  sttModeRef.current = sttMode;
  const [pendingUploads, setPendingUploads] = useState(0);
  const [different, setDifferent] = useState<DifferentView>({ kind: 'waiting' });
  /** 리딩 중 줄 고치기(SOMA-728) — 고치는 줄과, 열기 전에 진행 중이었는지(닫으면 이어서 한다). */
  const [editing, setEditing] = useState<{ lineId: string; draft: LineDraft; choices?: { lineId: string; text: string }[]; drafts?: Record<string, LineDraft> } | null>(null);
  const editResumes = useRef(false);
  const engineRef = useRef<PartnerVoiceEngine>('supertonic');
  const deviceVoiceRef = useRef(false);
  /**
   * 예시 대본의 미리 만든 음성(engine 'example'). text 는 고른 때의 줄(배역·글) — 리딩 중 줄을 고치면 음성과 글이 달라져
   * 그 줄은 기기 목소리로 읽는다.
   */
  const exampleRef = useRef<{ audio: ExampleAudio; text: Map<string, string> } | null>(null);
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
  // 끝난 화면 — 「이번 리딩 어땠나요?」 한 줄 칸을 누르면 키보드 위로 올린다(10/26 폰: 키보드에 가렸다).
  const doneScrollRef = useRef<ScrollView | null>(null);
  const keyboardHeight = useKeyboardHeight();
  const liftRatingInput = useCallback(() => {
    setTimeout(() => doneScrollRef.current?.scrollToEnd({ animated: true }), 250);
  }, []);
  // 대본을 끝까지 읽으면 앱 평가를 묻는다(7일 간격·최대 3번, SOMA-494). 튜토리얼 대본은 세지 않는다.
  const { after: askRating, element: ratingCard } = useAppRating();
  const fromTutorialRef = useRef(false);
  const sttActive = useRef(false);
  /** 줄별 시도 번호 — 같은 줄을 다시 말하면 1씩 늘어 이전 녹음을 대체한다(reading.recording). */
  const attempts = useRef<Record<string, number>>({});
  const turnStartedAt = useRef(0);
  /** 180초에 이르러 이미 녹음을 멈추고 올린 줄 — 줄이 끝날 때 다시 올리지 않는다. */
  const recordingClosed = useRef(false);
  /** 내 차례의 전사·녹음을 거두는 중 — 침묵 넘김·[다음]·180초가 겹쳐도 한 번만 거둔다. 새 차례가 열리면 풀린다. */
  const turnClosing = useRef(false);
  // [다시 연습]의 회차 요청 id(시작 줄마다) — 실패 뒤 다시 눌러도 같은 회차 하나가 된다.
  const readAgainRequestIds = useRef<Record<string, string>>({});
  const [restarting, setRestarting] = useState(false);
  /** 시작 전 [시작] 위에 자동 넘김 안내를 보일지 — 숨기지 않았고 자동 넘김 회차일 때만. */
  const [startHint, setStartHint] = useState(false);
  /** 시작 팝업의 어두운 덮개가 시작하는 높이 — 진행 막대 아래부터 덮는다. */
  const [tipTop, setTipTop] = useState(0);
  /** 완료 화면이 뜬 직후 잠깐은 버튼을 받지 않는다 — 실행 중 [다음]을 연타하다 새 연습이 바로 시작되지 않게(SOMA-772). */
  const [doneLocked, setDoneLocked] = useState(true);
  /** 완료 화면 [완료] 뒤의 리딩 마무리(pen 「새 · 리딩 마무리」). */
  const [wrapUp, setWrapUp] = useState(false);
  /** 첫 리딩 안내 — 본 적이 없을 때만. done 은 이미 지나간 안내. */
  const [coachOn, setCoachOn] = useState(false);
  const [coachDone, setCoachDone] = useState<ReadonlySet<CoachMark>>(() => new Set());
  const coachShown = useRef<CoachMark | null>(null);
  const firstRunRef = useRef(false);
  /**
   * 독백(SOMA-597) — 배역이 하나뿐인 대본은 처음부터 끝까지 끊지 않고 한 번에 녹음한다. 인식기가 스스로 끝나거나(오래 쉼·시간 한도)
   * 녹음이 3분에 이르면 그 조각만 거두고 곧바로 지금 문장에서 새 조각을 연다. 받아쓴 글은 조각을 넘어 이어 붙이고, 끝낸 뒤 문장별로 맞춘다.
   */
  const monologue = useMemo(() => !!script && isMonologue(script.characters), [script]);
  const monoDone = useRef('');
  const monoPiece = useRef('');
  /** 지금 조각을 연 줄 — 조각 녹음은 이 줄에 올린다. */
  const monoPieceAt = useRef(0);
  /** 이번 실행에서 처음 듣기 시작한 줄 — 맞춰 볼 문장은 여기부터다. */
  const monoFrom = useRef<number | null>(null);
  const monoPosAt = useRef(0);
  const monoPosTimer = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [monoSeq, setMonoSeq] = useState(0);
  const [monoResult, setMonoResult] = useState<ReturnType<typeof monologueResults> | null>(null);
  const monoItemY = useRef<Record<number, number>>({});
  const monoCardY = useRef(0);
  // 대화 카드 위치 — 받아쓰기(인식 결과)가 늘어나 내용이 길어져도 맨 아래로 끌지 않고 지금 대사 카드 위쪽에 맞춘다(SOMA-913).
  const dialogueCardY = useRef(0);

  // 서버가 정한 「내 배역이 아닐 때 읽을 목소리」. 내 배역 줄은 읽지 않으니 빼지 않아도 된다.
  const voiceByName = useMemo(() => new Map((script?.characters ?? []).map((c) => [c.name, c.voice] as const)), [script]);
  const presetFor = useCallback((role: string) => voiceByName.get(role) ?? 'F1', [voiceByName]);

  const primeSpeech = useCallback((from: number) => {
    if (!script || !config) return null;
    if (!speechQueue.current) speechQueue.current = tts.createQueueFor(script.id, {
      cloud: engineRef.current === 'cloud',
      // 서버가 이 회차가 무료 첫 리딩인지 가리도록 회차 번호를 함께 보낸다(SOMA-917).
      synthesizeCloud: (text, scriptId, preset, lang) => synthesizeCloudSpeech(text, scriptId, preset, lang, session?.id),
    });
    const upcoming = config.lines.slice(from, config.endIndex + 1)
      .filter((line): line is DialogueLine => line.type === 'dialogue' && !config.myRoles.includes(line.role))
      .flatMap((line) => speechParts(line).map((part) => ({ text: speakableText(part.text), preset: presetFor(line.role), lang: part.lang })));
    speechQueue.current.prime(upcoming);
    return speechQueue.current;
  }, [script, config, presetFor, session?.id]);

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
      // 「나가기」로 떠날 때도 마지막 위치를 화면 밖에서 마저 보낸다 — 나가기는 저장을 기다리지 않고 바로 넘어간다.
      closeProgressQueue(session.id, queue, { keepSending: runRef.current?.status === 'done' || leavingRef.current });
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
   *
   * 인식기 녹음은 여기서 동기로 떼어 내고(다음 줄과 섞이지 않게) 녹음기는 닫는 데까지만 기다린다. 파일이 다
   * 써지기를 기다리고 큐에 넣는 일은 돌려준 settled 에서 뒤에 한다 — 부르는 쪽은 그걸 기다리지 않고 다음 줄로
   * 넘긴다(SOMA-631: audioend 대기 때문에 자동 넘김이 느려졌다).
   */
  const enqueueTurn = useCallback(
    async (lineId: string, text: string, sttUsed: boolean, uri: string, kind: 'recorder' | 'stt_persist', durationMs: number) => {
      if (!session) return;
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
      if (outcome.kind === 'rejected' && (outcome.reason === 'empty' || outcome.reason === 'missing')) {
        logEvent('reading_recording_empty', { kind, reason: outcome.reason, platform: Platform.OS });
      }
      if (outcome.kind === 'rejected' && (outcome.reason === 'too_large' || outcome.reason === 'too_long')) {
        flash({ kind: 'dropped', count: 1 });
      }
    },
    [flash, session],
  );

  const endTurnRecording = useCallback(
    async (lineId: string, text: string): Promise<{ settled: Promise<void> }> => {
      const sttUsed = sttActive.current;
      const detached = sttUsed ? stt.detachRecording() : Promise.resolve(null);
      const closed = recordingClosed.current;
      const startedAt = turnStartedAt.current;
      const fromMic = await mic.stop();
      const settled = (async () => {
        let uri: string | null = null;
        let durationMs = Math.max(0, Date.now() - startedAt);
        let kind: 'recorder' | 'stt_persist' = 'recorder';
        if (sttUsed) {
          uri = await detached;
          kind = 'stt_persist';
        }
        if (fromMic) {
          uri = fromMic.uri ?? uri;
          durationMs = fromMic.durationMs || durationMs;
          kind = fromMic.uri ? 'recorder' : kind;
        }
        if (!uri) return;
        if (!session?.record || closed) {
          await deleteDeviceFile(uri).catch(() => undefined);
          return;
        }
        await enqueueTurn(lineId, text, sttUsed, uri, kind, durationMs);
      })().catch(() => undefined);
      return { settled };
    },
    [enqueueTurn, mic, session, stt],
  );

  // 다시 들어와 이어 읽으면 이전의 「끝까지 갔다」 표시는 지운다.
  const sessionIdForEnd = session?.id;
  useEffect(() => {
    if (sessionIdForEnd) void clearReachedEnd(sessionIdForEnd);
  }, [sessionIdForEnd]);

  const commit = useCallback((next: RunState) => {
    const prev = runRef.current;
    runRef.current = next;
    setRun(next);
    if (!prev || !session) return;
    if (next.status === 'done') {
      // 대본(고른 구간) 끝까지 가야 완료다 — 중간에 「그만하기」로 끝낸 회차는 열린 채 남고 별점도 묻지 않는다(SOMA-773, 10/29).
      const completed = !stoppedEarlyRef.current && readingRunCompleted({
        reachedEnd: true,
        said: next.said,
        priorRecognized: sessionHasRecognized(session),
        recognition: sttModeRef.current?.kind ?? null,
      });
      if (completed) queueRef.current?.push(progressPayload(next));
      // 서버는 열어 둔 회차를 마지막 직전(9/10)에 두므로, 끝까지 갔다는 표시를 이 기기에 남겨 홈이 10/10 으로 보이게 한다.
      if (completed) void clearReachedEnd(session.id);
      else if (!stoppedEarlyRef.current) void markReachedEnd(session.id);
      // 마지막 줄까지 가 봤으면(인식된 대사가 없어도) 첫 사용자 화면은 졸업이다(SOMA-827). 중간에 멈춘 건 아니다.
      if (!stoppedEarlyRef.current) {
        void markFirstUseGraduated();
        void markReadingFinished();
      }
      setPhase({ kind: 'done' });
      if (completed && !fromTutorialRef.current) void askRating({ kind: 'reading' });
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

  /**
   * [이전] — 바로 앞 대사로 돌아가 그 줄을 다시 한다. 줄이 바뀌면 상대 읽기·마이크 효과가 지금 줄을 닫고(하던 녹음 조각은
   * 지운다) 앞 줄로 다시 연다. 내 차례를 닫는 중(녹음 거두기)이면 그 넘김이 끝날 때까지 받지 않는다.
   */
  const goBack = useCallback(() => {
    const cur = runRef.current;
    // turnClosing 은 다음 내 차례가 열릴 때 풀리므로 내 차례일 때만 본다.
    if (!cur || (cur.status === 'mine' && turnClosing.current)) return;
    const next = backRun(cur);
    if (next !== cur) commit(next);
  }, [commit]);

  /**
   * 지나간 대사를 누르면 그 줄부터 다시 한다(SOMA-785). [이전]과 같은 길이다 — 줄이 바뀌면 상대 읽기·마이크 효과가 지금 줄을
   * 닫고(하던 녹음 조각은 지운다) 누른 줄로 다시 연다. 멈춘 채 누르면 그 줄에서 이어 한다.
   */
  const jumpBack = useCallback((index: number) => {
    const cur = runRef.current;
    if (!cur || (cur.status === 'mine' && turnClosing.current)) return;
    const next = jumpTo(cur, index);
    if (next === cur) return;
    commit(next);
    const text = [...cur.lines[index].text.trim()];
    flash({ kind: 'jump', text: text.length > JUMP_PREVIEW ? `${text.slice(0, JUMP_PREVIEW).join('').trimEnd()}…` : text.join('') });
  }, [commit, flash]);

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

  /**
   * 준비가 끝나면 「리딩 시작 전」(pen GqB1I)에 멈춘다 — [시작]을 눌러야 첫 줄을 연다(SOMA-772). 안내를 숨겼거나
   * 옛 회차(advance=manual)여도 바로 시작하지 않는다. 자동 넘김 안내 글만 그때 뺀다.
   */
  const startRunning = useCallback(() => {
    setStartHint(!tipHiddenRef.current && session?.advance === 'silence');
    holdRef.current = 'tip';
    setPhase({ kind: 'running', hold: 'tip' });
  }, [session?.advance]);

  // ── 목소리 준비 → 실행 ─────────────────────────────────────────────────────
  const prepare = useCallback(async () => {
    // 모든 배역이 내 배역이면 상대 대사가 없어 목소리를 준비하지 않는다.
    if (!hasPartnerLines) {
      startRunning();
      return;
    }
    // 예시 대본인지는 서버가 안다(입력 경로 sample 은 짐작일 뿐) — 임시 주소라 시작할 때마다 새로 받는다.
    const [cloudEnabled, cloudStatus, support, deviceVoice, example] = await Promise.all([
      loadCloudVoiceEnabled(), api.getCloudVoiceStatus(session ? { sessionId: session.id } : undefined).catch(() => null), readAppVoiceSupport(), hasDeviceVoice(),
      script ? loadExampleAudio(script.id, { fresh: true }) : Promise.resolve(null),
    ]);
    if (!mounted.current) return;
    deviceVoiceRef.current = deviceVoice;
    if (cloudStatus?.pro_only) {
      setProVoiceHint(true);
      if (!proVoiceHintLogged.current) {
        proVoiceHintLogged.current = true;
        void logEvent('pro_hint_shown', { trigger: 'reading_voice' });
      }
    }
    // 이번 회차에 서버 음성으로 만들 상대 대사 수 — 남은 한도로 끝까지 못 읽으면 서버 음성을 쓰지 않는다(SOMA-912).
    const cloudLines = new Set<string>();
    if (config) {
      for (let i = runRef.current?.index ?? config.startIndex; i <= config.endIndex; i++) {
        const l = config.lines[i];
        if (l?.type !== 'dialogue' || config.myRoles.includes(l.role)) continue;
        for (const part of speechParts(l)) cloudLines.add(`${presetFor(l.role)}\u0000${speakableText(part.text)}`);
      }
    }
    if (shouldUseCloudVoice({ enabled: cloudEnabled, status: cloudStatus, lines: cloudLines.size })) {
      chooseEngine('cloud');
      startRunning();
      await primeSpeech(runRef.current?.index ?? 0)?.first();
      return;
    }
    // 예시 대본이고 상대역 목소리를 바꾸지 않았으면 미리 만든 서버 음성으로 읽는다 — 모델을 받지도 묻지도 않는다.
    // 음성이 없는 줄은 기기 목소리로 읽는다(모델로 가지 않는다). 목소리를 바꿨으면 아래 보통 길이다.
    if (example && config) {
      const partners: Record<string, string> = {};
      const from = runRef.current?.index ?? config.startIndex;
      const ahead: string[] = [];
      for (let i = config.startIndex; i <= config.endIndex; i++) {
        const l = config.lines[i];
        if (l?.type !== 'dialogue' || config.myRoles.includes(l.role)) continue;
        partners[l.role] = presetFor(l.role);
        if (i >= from) ahead.push(config.lineIds[i]);
      }
      if (exampleVoicesMatch(example, partners)) {
        exampleRef.current = {
          audio: example,
          text: new Map(config.lineIds.map((id, i) => [id, exampleLineSignature(config.lines[i])])),
        };
        chooseEngine('example');
        void prefetchExampleLines(example, ahead, () => !mounted.current);
        startRunning();
        return;
      }
    }
    if (support.unsupported) {
      chooseEngine(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice }));
      if (support.noticed) startRunning();
      else setPhase({ kind: 'voice_unsupported' });
      return;
    }
    // 받아 둔 만큼은 빼고 남은 양으로 판단한다 — 다 받아 둔 기기는 이동통신이어도 묻지 않고, Wi-Fi 미리 받기가
    // 중간에 끊긴 기기에는 남은 양만 묻는다(SOMA-772).
    const missing = missingModelBytes(activeVariant());
    if (missing > 0) {
      const prompt = modelDownloadPrompt({ assetsPresent: false, networkType: await currentNetworkType(), bytes: missing });
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
        removeDownloadedAssets('fp16');
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
  }, [confirm, session, hasPartnerLines, primeSpeech, startRunning, chooseEngine, script, config, presetFor]);

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
      if (!micOk) {
        setPhase({ kind: 'need_mic' });
        return;
      }
      setSttMode(await detectSttPolicy());
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

  // 마이크 안내에서 설정을 열고 켠 뒤 돌아오면 그대로 이어서 준비한다.
  useEffect(() => {
    if (phase.kind !== 'need_mic') return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void (async () => {
        if (!(await micPermissionGranted()) || !mounted.current) return;
        setPhase({ kind: 'preparing', progress: null });
        setSttMode(await detectSttPolicy());
        void prepare();
      })();
    });
    return () => sub.remove();
  }, [phase.kind, prepare]);

  useEffect(() => {
    if (phase.kind === 'running' && (engine === 'cloud' || (engine === 'supertonic' && tts.isReady()))) primeSpeech(run?.index ?? 0);
  }, [phase.kind, engine, run?.index, primeSpeech]);

  const tipOpen = phase.kind === 'running' && phase.hold === 'tip';

  // ── 지문 멈춤(SOMA-937) — 다음 대사 바로 앞의 지문·장면을 지금 줄 자리에 띄우고 잠깐 멈춘다. 멈춘 동안은 상대 읽기·마이크를
  // 열지 않는다. 렌더에서 바로 셈해야 상대 읽기가 한 번 시작됐다 끊기지 않는다. 같은 줄의 멈춤은 한 번만(멈춤·재개로 다시 뜨지 않는다).
  const [beatDoneAt, setBeatDoneAt] = useState<number | null>(null);
  const runEnded = !run || run.status === 'done';
  const beatLines = useMemo(
    () => (monologue || runEnded || !run || phase.kind !== 'running' || tipOpen || beatDoneAt === run.index ? [] : directionsBefore(run.lines, run.index)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [monologue, runEnded, run?.index, run?.lines, phase.kind, tipOpen, beatDoneAt],
  );
  const beatDuration = beatLines.length > 0 && run ? beatMs(beatLines.map((i) => run.lines[i].text)) : 0;
  const beatOn = beatDuration > 0;
  /** 시작 전 안내나 지문 멈춤 — 상대 읽기·내 차례 마이크를 열지 않는다. */
  const turnGated = tipOpen || beatOn;
  const runPaused = run?.status === 'paused';
  useEffect(() => {
    if (!beatOn || !run || runPaused) return;
    const at = run.index;
    const timer = setTimeout(() => setBeatDoneAt(at), beatDuration);
    return () => clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [beatOn, run?.index, runPaused]);

  // ── 첫 리딩 안내(SOMA-748) — 진행 상태를 보고 띄울 뿐, 진행 규칙은 건드리지 않는다 ─────────────
  useEffect(() => {
    let alive = true;
    // 이어 읽는 회차거나 다른 대본을 읽어 본 계정(앱을 다시 깐 기존 사용자)은 첫 리딩이 아니다 — 안내 없이 본 것으로 남긴다(10/26).
    const resumed = !!session && session.progress_seq > 0;
    const scriptId = script?.id;
    void hasSeenFirstReadingGuide().then(async (seen) => {
      if (!alive || seen) return;
      const scripts = resumed
        ? null
        : await Promise.resolve()
            .then(() => api.listReadingScripts())
            .then((r) => r.scripts)
            .catch(() => null);
      if (!alive) return;
      if (skipsFirstReadingGuide({ resumed, scriptId, scripts })) {
        void markFirstReadingGuideSeen();
        return;
      }
      setCoachOn(true);
      firstRunRef.current = true;
    });
    return () => {
      alive = false;
    };
    // 화면을 열 때 한 번만 정한다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  // 첫 리딩 안내(SOMA-748, 10/29 되살림) — 화면을 덮지 않고 진행 상태에 맞는 말풍선을 하나씩 띄운다.
  // 상대 차례 → 내 차례 → 읽은 뒤 「다음」 → 가린 대사 순. 진행 규칙(자동 넘김·듣기)은 건드리지 않는다.
  const coachLine = run ? run.lines[run.index] : undefined;
  const coachHiddenMine =
    !!run && !!coachLine && coachLine.type === 'dialogue' && run.myRoles.includes(coachLine.role) &&
    isHidden({ maskMode, line: coachLine, isMine: true });
  const coachMark =
    coachOn && phase.kind === 'running' && !phase.hold && run
      ? coachMarkFor({ done: coachDone, status: run.status, said: said.trim().length > 0, hiddenMine: coachHiddenMine })
      : null;
  const finishCoachMark = useCallback((mark: CoachMark) => {
    setCoachDone((prev) => {
      if (prev.has(mark)) return prev;
      const next = new Set(prev);
      next.add(mark);
      if (next.size === COACH_MARKS.length) {
        setCoachOn(false);
        void markFirstReadingGuideSeen();
      }
      return next;
    });
  }, []);
  // 띄웠던 안내는 그 때(상대 차례·내 차례)가 지나가면 본 것으로 친다.
  useEffect(() => {
    const prev = coachShown.current;
    coachShown.current = coachMark;
    if (prev && prev !== coachMark) finishCoachMark(prev);
  }, [coachMark, finishCoachMark]);
  // 리딩을 끝까지 했으면 다 못 봤어도 다음부터는 띄우지 않는다.
  useEffect(() => {
    if (phase.kind === 'done' && coachOn) {
      setCoachOn(false);
      void markFirstReadingGuideSeen();
    }
  }, [phase.kind, coachOn]);

  // ── 상대 차례: 목소리로 읽고 넘어간다 ─────────────────────────────────────────
  useEffect(() => {
    const current = runRef.current;
    if (phase.kind !== 'running' || turnGated || !current || current.status !== 'partner') return;
    const line = current.lines[current.index] as DialogueLine;
    const from = current.index;
    const span = turnSpan(current);
    // 줄의 말과 소리 낼 글(SOMA-751). 로마자 아랍어 줄은 서버가 바꿔 둔 아랍 문자를 아랍어로 읽고, 한 줄에 다른 말이
    // 이어지면(「고맙습니다. شكراً」) 조각마다 그 말로 차례로 읽는다. 묶인 대사(SOMA-806)는 줄들을 끊지 않고 이어 읽는다.
    const parts = (current.lines.slice(span.start, span.end + 1) as DialogueLine[])
      .flatMap((l) => speechParts(l))
      .map((part) => ({ ...part, text: speakableText(part.text) }));
    const preset = presetFor(line.role);
    let cancelled = false;
    const finish = () => {
      if (cancelled || !mounted.current) return;
      if (holdRef.current) deferredRef.current = { kind: 'advance', from };
      else goNext(from);
    };
    // 저장해 둔 소리를 틀지 못하면(재생 실패·시작 안 됨) 그 파일을 지우고 이 줄은 기기 목소리로 읽는다(SOMA-906).
    // 지운 파일은 다음에 다시 받거나 만든다. 기기 목소리도 없으면 그대로 다음 줄로 넘어간다.
    const playSaved = async (uri: string, readInstead: () => Promise<void>) => {
      try {
        await tts.play(uri);
        return;
      } catch (e) {
        void logEvent('reading_line_voice_failed', { engine, kind: voiceErrorKind(e) });
        tts.discardSpeechFile(uri);
      }
      if (cancelled || !mounted.current) return;
      await readInstead();
    };
    const readWithDeviceVoice = async (read: () => Promise<void>) => {
      if (!deviceVoiceRef.current) return;
      setLineEngine('device_voice');
      await read();
    };
    /**
     * 서버 음성을 못 쓴 줄(받지 못함·틀지 못함) — 앱 목소리가 이미 준비돼 있으면 같은 프리셋으로 읽어 그 배역 목소리가 중간에
     * 바뀌지 않게 한다(SOMA-937, Play 리뷰 「한 캐릭터를 중간중간 다른 성우가 읽음」). 준비돼 있지 않을 때만 기기 기본 목소리다.
     * 어느 쪽으로 갔는지 남긴다. 앱 목소리로 읽었으면 true.
     */
    const readWithAppVoice = async (text: string, lang: string | undefined, reason: 'missing' | 'play_failed'): Promise<boolean> => {
      const to = tts.isReady() ? 'supertonic' : deviceVoiceRef.current ? 'device_voice' : 'text_only';
      void logEvent('reading_line_voice_fallback', { engine, to, reason });
      if (to !== 'supertonic') return false;
      setLineEngine('supertonic');
      await tts.speak(text, preset, { scriptId: script?.id, lang });
      return true;
    };
    void (async () => {
      try {
        if (engine === 'text_only') {
          setLineEngine('text_only'); // 글로 보기 — 버튼으로 넘긴다
          return;
        }
        if (engine === 'example') {
          // 예시 음성은 줄마다 하나다 — 묶인 대사는 줄마다 차례로 튼다. 음성이 없거나 받지 못했거나 리딩 중 고친 줄은 기기 목소리.
          const example = exampleRef.current;
          for (let i = span.start; i <= span.end; i++) {
            const l = current.lines[i] as DialogueLine;
            const id = current.lineIds[i];
            const usable = !!example && example.audio.lines.has(id) && example.text.get(id) === exampleLineSignature(l);
            const uri = usable ? await exampleLineUri(example!.audio, id).catch(() => null) : null;
            if (cancelled || !mounted.current) return;
            if (uri) {
              setLineEngine('example');
              await playSaved(uri, () =>
                readWithDeviceVoice(async () => {
                  for (const part of speechParts(l)) {
                    if (cancelled || !mounted.current) return;
                    await speakWithDevice(speakableText(part.text), presetFor(l.role), { locale: speechLocaleFor(part.lang) });
                  }
                }),
              );
              continue;
            }
            if (!deviceVoiceRef.current) {
              setLineEngine('text_only');
              return;
            }
            setLineEngine('device_voice');
            for (const part of speechParts(l)) {
              if (cancelled || !mounted.current) return;
              await speakWithDevice(speakableText(part.text), presetFor(l.role), { locale: speechLocaleFor(part.lang) });
            }
          }
          finish();
          return;
        }
        for (const { text, lang } of parts) {
          if (cancelled || !mounted.current) return;
          if (engine === 'device_voice') {
            setLineEngine('device_voice');
            await speakWithDevice(text, preset, { locale: speechLocaleFor(lang) });
            continue;
          }
          // 큐가 아직 못 만든 줄(건너뛰기·앞 줄 실패)은 기기 목소리로 바로 넘기지 않고 이 엔진으로 지금 만든다 — 같은 배역을
          // 다른 목소리가 중간중간 읽지 않게(SOMA-912). 앱 목소리는 아래 tts.speak 가 같은 일을 한다.
          const queue = primeSpeech(from);
          let ready = (await queue?.take({ text, preset, lang })) ?? null;
          if (!ready && engine === 'cloud' && !cancelled && mounted.current) ready = (await queue?.make?.({ text, preset, lang })) ?? null;
          if (cancelled || !mounted.current) return;
          if (ready) {
            setLineEngine(engine);
            await playSaved(ready, async () => {
              if (engine === 'cloud' && (await readWithAppVoice(text, lang, 'play_failed'))) return;
              await readWithDeviceVoice(() => speakWithDevice(text, preset, { locale: speechLocaleFor(lang) }));
            });
          } else if (engine === 'supertonic') {
            setLineEngine('supertonic');
            await tts.speak(text, preset, { scriptId: script?.id, lang });
          } else {
            // 서버 음성을 못 받은 줄 — 앱 목소리가 준비돼 있으면 그것으로(SOMA-937), 아니면 기기 기본 목소리로 읽고 회차에서
            // 처음일 때 알린다. 기기 음성도 없으면 글로 보기.
            if (await readWithAppVoice(text, lang, 'missing')) continue;
            if (cancelled || !mounted.current) return;
            if (!deviceVoiceRef.current) {
              setLineEngine('text_only');
              return;
            }
            setLineEngine('device_voice');
            if (!cloudFallbackNoticed.current) {
              cloudFallbackNoticed.current = true;
              flash({ kind: 'cloud_fallback' });
            }
            await speakWithDevice(text, preset, { locale: speechLocaleFor(lang) });
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
  }, [phase.kind, turnGated, run?.index, run?.status, engine, goNext, presetFor, primeSpeech, script?.id, flash]);

  // ── 내 차례: 마이크(침묵 감지)와 STT ─────────────────────────────────────────
  /** 내 차례를 끝낸다(침묵·[다음]) — 그때까지의 녹음을 거둔 뒤 넘긴다. */
  const endMyTurn = useCallback(
    async (from: number) => {
      const cur = runRef.current;
      if (!cur || !session || cur.index !== from || cur.status !== 'mine' || turnClosing.current) return;
      turnClosing.current = true;
      setTurnDone(true);
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
    if (monologue || phase.kind !== 'running' || turnGated || !run || run.status !== 'mine' || !session) return;
    const from = run.index;
    const span = turnSpan(run);
    const turnText = run.lines.slice(span.start, span.end + 1).map((l) => l.text).join(' ');
    setAid('none');
    setSaid('');
    saidRef.current = '';
    setTurnNote(null);
    setTurnDone(false);
    let cancelled = false;
    // 인식기가 스스로 멈춘 뒤에는 받아쓴 글이 더 늘지 않는다 — 90% 대조를 기다리면 줄이 멈추므로 침묵만으로 넘긴다.
    let sttStopped = false;
    const sttGaveUp = () => sttStopped || stt.failed() || !saidRef.current.trim();
    const onEvent = (event: VadEvent) => {
      if (cancelled) return;
      if (event === 'timeout') setTurnNote('silence');
      if (event === 'speech_start' && deferredTimer.current) {
        // 시트를 닫은 뒤 다시 말하기 시작했다 — 미뤄 둔 넘김은 버리고 이번 말이 끝나기를 기다린다.
        clearTimeout(deferredTimer.current);
        deferredTimer.current = null;
      }
      if (event === 'speech_end' && session.advance === 'silence') {
        // 받아쓰기가 켜져 있으면 대본 글자 수의 90% 이상 말한 뒤의 침묵만 넘긴다 — 대사 중간의 사이에 넘어가지 않게(SOMA-804).
        // 못 미치면 계속 듣는다. 다시 말하고 멈추면 또 잰다. 받아쓰기 없이 음량만 재는 녹음기는 글자를 몰라 예전처럼 넘긴다.
        // 묶인 차례(SOMA-806)는 묶음 줄 전체 글자로 잰다.
        // 인식기가 오류를 냈거나 글을 하나도 못 줬으면 90% 대조는 믿을 수 없다 — 예전처럼 침묵만으로 넘긴다.
        if (sttActive.current && !sttGaveUp() && !saidEnough(turnText, saidRef.current)) return;
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
      // 녹음이 켜진 회차인데 이 기기의 인식기가 소리를 남기지 못하면 녹음기로 받는다 — 받아쓰기보다 녹음이 먼저다.
      const recordOverStt = !!(session.record && !stt.canPersist());
      if (sttMode?.kind === 'stt' && !recordOverStt) {
        // 받아쓰기는 내 줄의 말로 듣는다(SOMA-751).
        const mine = run.lines[from] as DialogueLine;
        const ok = stt.start(
          {
            onEvent,
            onInterim: (text) => {
              saidRef.current = text;
              setSaid(text);
            },
            // 인식기가 스스로 끝났거나 오류로 멈추면 음량·말 끝 이벤트도 끊긴다 — 침묵 감지를 마이크로 이어받는다.
            onEnd: () => {
              if (cancelled || turnClosing.current || recordingClosed.current) return;
              sttStopped = true;
              void mic.start(onEvent);
            },
          },
          { persist: !!session.record, locale: speechLocaleFor(lineLanguage(mine)) },
        );
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
          setTurnDone(true);
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
  }, [phase.kind, turnGated, run?.index, run?.status, attempt]);

  // ── 독백: 끊지 않고 한 번에 듣는다(SOMA-597) ─────────────────────────────────────
  const monoHeard = () => [monoDone.current, monoPiece.current].filter(Boolean).join(' ');

  /** 받아쓴 글로 읽는 위치를 재 강조를 옮긴다. 판정은 하지 않는다 — 넘김·녹음은 그대로다. */
  const followMonologue = useCallback(() => {
    if (monoPosTimer.current) clearTimeout(monoPosTimer.current);
    const wait = MONO_POSITION_MS - (Date.now() - monoPosAt.current);
    if (wait > 0) {
      monoPosTimer.current = setTimeout(() => followMonologue(), wait);
      return;
    }
    monoPosAt.current = Date.now();
    const cur = runRef.current;
    if (!cur || cur.status !== 'mine' || monoFrom.current === null) return;
    const idx = sentenceIndexes(cur, monoFrom.current);
    const pos = livePosition(idx.map((i) => cur.lines[i].text), monoHeard(), Math.max(0, idx.indexOf(cur.index)));
    if (idx[pos] !== undefined && idx[pos] !== cur.index) commit({ ...cur, index: idx[pos] });
  }, [commit]);

  /** [끝내기] — 녹음을 거두고 받아쓴 글 전체를 문장별로 맞춰 결과를 낸다. 읽는 동안에는 판정하지 않았다. */
  const finishMonologue = useCallback(async () => {
    const cur = runRef.current;
    if (!cur || !session || cur.status !== 'mine' || turnClosing.current) return;
    turnClosing.current = true;
    setTurnDone(true);
    if (monoPosTimer.current) clearTimeout(monoPosTimer.current);
    const text = sttActive.current ? await stt.finish() : '';
    if (text) monoPiece.current = text;
    await endTurnRecording(cur.lineIds[monoPieceAt.current], monoPiece.current);
    sttActive.current = false;
    setListening(false);
    const heard = monoHeard();
    monoDone.current = heard;
    monoPiece.current = '';
    const now = runRef.current;
    if (!now || now.status === 'done') return;
    const idx = sentenceIndexes(now, monoFrom.current ?? now.index);
    const result = monologueResults(idx.map((i) => now.lineIds[i]), idx.map((i) => now.lines[i].text), heard);
    setMonoResult(result);
    commit(finishMonologueRun(now, sttModeRef.current?.kind === 'stt' ? result.said : {}));
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [session, stt, commit, endTurnRecording]);

  useEffect(() => {
    if (!monologue || phase.kind !== 'running' || tipOpen || !run || run.status !== 'mine' || !session) return;
    const at = run.index;
    if (monoFrom.current === null) monoFrom.current = at;
    monoPieceAt.current = at;
    monoPiece.current = '';
    setTurnDone(false);
    setTurnNote(null);
    setSaid(monoHeard());
    recordingClosed.current = false;
    turnClosing.current = false;
    turnStartedAt.current = Date.now();
    let cancelled = false;
    let limitTimer: ReturnType<typeof setTimeout> | null = null;
    /** 지금 조각을 거두고 지금 문장에서 새 조각을 연다 — 인식기가 스스로 끝났거나(오래 쉼) 녹음 3분. 녹음이 잘리지 않게 바로 다시 듣는다. */
    const rotate = async () => {
      if (cancelled || turnClosing.current) return;
      turnClosing.current = true;
      const text = sttActive.current ? await stt.finish() : '';
      if (text) monoPiece.current = text;
      await endTurnRecording(runRef.current?.lineIds[monoPieceAt.current] ?? '', monoPiece.current);
      monoDone.current = monoHeard();
      monoPiece.current = '';
      sttActive.current = false;
      if (!cancelled) setMonoSeq((n) => n + 1);
    };
    void (async () => {
      let opened = false;
      const recordOverStt = !!(session.record && !stt.canPersist());
      if (sttMode?.kind === 'stt' && !recordOverStt) {
        const ok = stt.start(
          {
            // 말이 멈춰도 넘기지 않는다 — 독백의 침묵은 대부분 일부러 쉬는 연기다.
            onEvent: () => undefined,
            onInterim: (text) => {
              monoPiece.current = text;
              setSaid(monoHeard());
              followMonologue();
            },
            onEnd: () => void rotate(),
          },
          { persist: !!session.record, locale: speechLocaleFor(lineLanguage(run.lines[at] as DialogueLine)) },
        );
        sttActive.current = ok;
        opened = ok;
      }
      if (!opened) opened = await mic.start(() => undefined);
      if (cancelled) return;
      setListening(opened);
      if (opened && session.record) limitTimer = setTimeout(() => void rotate(), RECORDING_MAX_MS);
    })();
    return () => {
      cancelled = true;
      if (limitTimer) clearTimeout(limitTimer);
      if (monoPosTimer.current) clearTimeout(monoPosTimer.current);
      // 일시정지·나가기로 닫히면 받아쓴 글은 남기고(이어서 하면 뒤에 붙는다) 그 조각의 녹음은 버린다 — 보통 줄과 같다.
      if (!turnClosing.current) {
        monoDone.current = monoHeard();
        monoPiece.current = '';
      }
      stt.abort();
      sttActive.current = false;
      void mic.stop().then((r) => {
        if (r?.uri) void deleteDeviceFile(r.uri).catch(() => undefined);
      });
      const leftover = stt.takeRecordingUri();
      if (leftover) void deleteDeviceFile(leftover).catch(() => undefined);
      setListening(false);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [monologue, phase.kind, tipOpen, run?.status, attempt, monoSeq]);

  // 독백은 읽는 문장이 보이게 따라 내린다. 「원문 보기」는 그 문장에만 적용된다.
  useEffect(() => {
    if (!monologue || !run) return;
    setAid('none');
    const y = monoItemY.current[run.index];
    if (y !== undefined) scrollRef.current?.scrollTo({ y: Math.max(0, monoCardY.current + y - 160), animated: true });
  }, [monologue, run?.index]);

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

  // ── 멈춤: 위치를 저장한다. 돌아오면 배우가 이어서를 누른다 ─────────────────────────────
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
  // 배경에서도 리딩이 도는 기기(SOMA-802)는 배경으로 가도 멈추지 않는다. 못 도는 기기(안드로이드에서 마이크 서비스를 못 띄움)만 예전처럼 멈춘다.
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active' && phase.kind === 'running' && !readingKeepsRunning()) doPause();
    });
    return () => sub.remove();
  }, [phase.kind, doPause]);
  // 잠금 화면·알림의 [일시정지], 그리고 전화 등으로 소리가 실제로 끊긴 때.
  useEffect(() => {
    const offPause = onReadingLiveEvent('onPause', doPause);
    const offInterrupt = onReadingLiveEvent('onInterrupt', () => {
      const cur = runRef.current;
      if (!cur || (cur.status !== 'mine' && cur.status !== 'partner')) return;
      if (AppState.currentState === 'background') setInterrupted(true);
      doPause();
    });
    return () => {
      offPause();
      offInterrupt();
    };
  }, [doPause]);

  const doResume = () => {
    const cur = runRef.current;
    if (!cur || cur.status !== 'paused') return;
    const next = resumeRun(cur);
    runRef.current = next;
    setRun(next);
    setInterrupted(false);
    setAttempt((a) => a + 1);
  };

  /**
   * 지금 대사 줄을 고친다 — 리딩을 멈추고 대본 전체와 같은 고치기 시트를 연다. 묶인 대사(SOMA-806)면 먼저 고칠 줄을 고른다 —
   * 저장은 줄 단위다. 고르다 닫으면 멈춘 채 둔다(재개로 이어 한다).
   */
  const openLineEdit = () => {
    const cur = runRef.current;
    const line = cur?.lines[cur.index];
    if (!cur || !script || line?.type !== 'dialogue') return;
    editResumes.current = cur.status === 'mine' || cur.status === 'partner';
    doPause();
    const draftOf = (index: number): LineDraft => {
      const target = cur.lines[index] as DialogueLine;
      const characterId = script.characters.find((c) => c.name === target.role)?.id ?? null;
      return { kind: 'dialogue', characterId, text: target.text };
    };
    const { start, end } = turnSpan(cur);
    if (start === end) {
      setEditing({ lineId: cur.lineIds[start], draft: draftOf(start) });
      return;
    }
    // 묶인 대사면 줄 고치기 페이지를 바로 열고, 고칠 줄은 그 안 「고칠 줄」 칩으로 고른다(SOMA-821: 고르기 시트를 없앴다).
    const drafts: Record<string, LineDraft> = {};
    const choices: { lineId: string; text: string }[] = [];
    for (let i = start; i <= end; i++) {
      drafts[cur.lineIds[i]] = draftOf(i);
      choices.push({ lineId: cur.lineIds[i], text: cur.lines[i].text });
    }
    setEditing({ lineId: cur.lineIds[start], draft: drafts[cur.lineIds[start]], choices, drafts });
  };

  /** 시트를 닫으면 고친 대본을 진행에 반영하고, 진행 중이었으면 그 줄부터 이어서 한다. */
  const closeLineEdit = (saved: boolean) => {
    setEditing(null);
    const cur = runRef.current;
    const fresh = getCurrent();
    if (saved && cur && fresh && session) {
      const myRoles = turnRoles(fresh.characters, session.my_character_ids);
      const next = applyLineEdit(cur, { lines: fresh.lines, lineIds: fresh.lineIds, myRoles });
      if (next.status === 'done') {
        commit(next);
        return;
      }
      runRef.current = next;
      setRun(next);
      queueRef.current?.push(progressPayload(next));
    }
    if (editResumes.current) doResume();
  };

  // 고르면 바뀐 값을 저장하고 줄을 접는다 — 접히면서 멈췄던 자동 넘김이 다시 돈다.
  const changeMask = (mode: MaskMode) => {
    setMaskMode(mode);
    void updateCurrent({ maskMode: mode });
    releaseHold();
  };

  const openMaskSheet = () => {
    if (phase.kind !== 'running') return;
    // 눈 버튼을 다시 누르면 접는다. 다른 멈춤(시작 안내·첫 버튼 안내) 중에는 열지 않는다.
    if (phase.hold === 'mask_sheet') {
      releaseHold();
      return;
    }
    if (phase.hold) return;
    holdRef.current = 'mask_sheet';
    setPhase({ kind: 'running', hold: 'mask_sheet' });
  };

  const closeTip = async (hide: boolean) => {
    startedRef.current = true;
    if (hide) {
      tipHiddenRef.current = true;
      await hideAutoAdvanceTip();
    }
    releaseHold();
  };

  const shouldDiscard = useCallback(
    () =>
      !!ownSession &&
      !discardedRef.current &&
      discardOnExit({
        started: startedRef.current,
        progressSeq: ownSession.progress_seq,
        recordingCount: ownSession.recordings?.length ?? 0,
        closed: phaseKindRef.current === 'closed',
      }),
    [ownSession],
  );

  /** [시작] 전에 나가면 회차를 지운다 — 상세 목록·이어 읽기에 「진행 중 · 0/N」이 쌓이지 않게. 실패해도 나가기는 막지 않는다. */
  const discardIfUnstarted = useCallback(async () => {
    if (!ownSession || !shouldDiscard()) return;
    discardedRef.current = true;
    // 지우기는 기다리지 않는다 — 회차 상세가 다 끝난 뒤 목록을 다시 불러온다(trackLeavingSave).
    trackLeavingSave(deleteSession(ownSession.id));
  }, [ownSession, shouldDiscard]);

  // 버튼이 아닌 길(안드로이드 뒤로 가기·스와이프)로 [시작] 전에 내려가도 회차를 남기지 않는다.
  useEffect(() => navigation.addListener('beforeRemove', () => void discardIfUnstarted()), [navigation, discardIfUnstarted]);

  // 새 연습(R8)은 실행 화면으로 바뀌어 있어 replace 하면 상세가 하나 더 쌓인다 — 이미 있는 상세까지 내려간다.
  const exitToDetail = () => {
    void discardIfUnstarted();
    router.dismissTo('/reading/detail');
  };

  // 「나가기」·뒤로 가기는 확인 없이 바로 저장하고 나간다(SOMA-821: 「리딩을 멈출까요?」 시트를 없앴다 — 읽은 데까지는 늘 저장되고,
  // [시작] 전이면 leaveReading 이 회차를 지운다. 저장 안 함 갈래는 그대로다).
  const [exiting, setExiting] = useState(false);
  const onExit = () => leaveReading();
  // 저장은 기다리지 않는다 — 큐에 넣고 바로 넘어가면 화면을 떠난 뒤에도 마저 보낸다(leavingRef). 예전에는 저장이 닿을 때까지
  // 최대 3초를 아무 표시 없이 기다려 버퍼링처럼 보였다.
  const leaveReading = () => {
    if (leavingRef.current) return;
    leavingRef.current = true;
    const cur = runRef.current;
    if (cur && cur.status !== 'done') {
      tts.stop();
      stopDeviceVoice();
      stt.abort();
      void mic.stop();
      if (!shouldDiscard()) {
        const paused = cur.status === 'paused' ? cur : pauseRun(cur);
        runRef.current = paused;
        setRun(paused);
        const queue = queueRef.current;
        if (queue) {
          queue.push(progressPayload(paused));
          trackLeavingSave(queue.flushed());
        }
      }
    }
    // 막아 둔 뒤로 가기(usePreventRemove)가 풀린 다음 그림에서 넘어간다.
    setExiting(true);
  };
  useEffect(() => {
    if (exiting) exitToDetail();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [exiting]);

  /**
   * 멈춘 채 「그만하기」 — 여기까지로 이번 회차를 끝낸다. 끝까지 간 게 아니므로 연습으로 세지 않고(10/29 정함)
   * 멈춘 위치만 저장해 다음에 이어 읽게 한다.
   */
  const stopHere = () => {
    const cur = runRef.current;
    if (!cur || cur.status !== 'paused' || !session) return;
    let next: RunState;
    if (monologue) {
      // 독백은 지금 문장까지만 맞춰 본다 — 아직 안 간 문장을 「빠뜨림」으로 세지 않는다.
      const heard = monoHeard();
      monoDone.current = heard;
      monoPiece.current = '';
      // 아무것도 못 알아들었으면 지금 문장도 읽지 않은 것으로 센다 — 끝 화면과 이어 읽기 카드가 같은 줄 수를 보이게(10/29).
      const upTo = heard.trim() ? cur.index : cur.index - 1;
      const idx = sentenceIndexes(cur, monoFrom.current ?? cur.index).filter((i) => i <= upTo);
      const result = monologueResults(idx.map((i) => cur.lineIds[i]), idx.map((i) => cur.lines[i].text), heard);
      setMonoResult(result);
      const trimmed: RunState = { ...cur, endIndex: Math.max(cur.startIndex - 1, Math.min(cur.endIndex, upTo)) };
      next = finishMonologueRun(trimmed, sttModeRef.current?.kind === 'stt' ? result.said : {});
    } else {
      next = stopRun(cur);
    }
    tts.stop();
    stopDeviceVoice();
    stt.abort();
    void mic.stop();
    stoppedEarlyRef.current = true;
    // 끝 화면이 센 마지막 읽은 줄 다음을 저장한다 — 이어 읽기 카드의 「K/N줄」이 끝 화면과 같아진다(10/29).
    queueRef.current?.push(stoppedProgressPayload(cur, next));
    commit(next);
  };
  /** 첫 리딩의 「그만 읽기」 — 읽는 중이면 멈춘 뒤 여기까지로 끝내고 첫 리딩 끝 화면으로 간다(10/29). */
  const firstStop = () => {
    const cur = runRef.current;
    if (!cur || cur.status === 'done') return;
    if (cur.status !== 'paused') doPause();
    firstStoppedRef.current = true;
    stopHere();
  };

  // 목소리를 내려받는(준비하는) 중에 뒤로 가면 리딩 탭 첫 화면으로 간다(10-27 정함). 내려받기는 화면을 떠나도 이어진다.
  useWaitExit(phase.kind === 'preparing', '/reading');
  // 안드로이드 뒤로 가기·스와이프도 확인 없이 같은 「저장하고 나가기」로 간다. 나가는 중(exiting)에는 풀어 준다.
  usePreventRemove(phase.kind === 'running' && !exiting && run?.status !== 'done', () => leaveReading());

  // 완료 화면이 뜨면 잠깐(DONE_LOCK_MS) 버튼을 막는다.
  useEffect(() => {
    if (phase.kind !== 'done') return;
    setDoneLocked(true);
    const timer = setTimeout(() => setDoneLocked(false), DONE_LOCK_MS);
    return () => clearTimeout(timer);
  }, [phase.kind]);

  /** 리딩 마무리 → 코칭 새 연습. 대본 제목·장면·내 배역을 장면 칸에 채워 넘긴다(SOMA-772). */
  const toCoach = () => {
    const cur = runRef.current;
    if (script && cur) {
      setContinueOrigin({
        kind: 'reading',
        scene: readingCoachScene({ title: script.title, lineIds: cur.lineIds, scenes: script.scenes, startIndex: cur.startIndex, myRoles: config?.myNames ?? [], t }),
      });
    }
    void logEvent('reading_to_coach', { reading_session_id: session?.id ?? '' });
    router.replace({ pathname: '/record-video', params: { mode: 'ai', next: 'upload' } });
  };

  /** @param startLineId 독백 결과의 「여기부터 다시」 — 그 문장부터 구간 끝까지 새 회차(SOMA-597). 없으면 같은 구간. */
  const readAgain = async (startLineId?: string) => {
    if (doneLocked || !script || !session || restarting) return;
    setRestarting(true);
    try {
      const from = startLineId ?? session.start_line_id;
      readAgainRequestIds.current[from] ??= newRequestId();
      const next = await startSession(
        script.id,
        buildStartBody({
          requestId: readAgainRequestIds.current[from],
          myCharacterIds: session.my_character_ids,
          startLineId: from,
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

  // ── 잠금 화면·알림의 진행(SOMA-802) ─────────────────────────────────────────────
  const holdNow = phase.kind === 'running' ? phase.hold : null;
  const myTurnNow = !!run && (run.status === 'mine' || (run.status === 'paused' && run.resumeTo === 'mine'));
  const chip = turnChip({
    hold: holdNow,
    paused: run?.status === 'paused',
    interrupted,
    myTurn: myTurnNow,
    textOnly: (lineEngine ?? engine) === 'text_only',
    turnDone,
    turnNote,
    listening,
  });
  // 1초마다 바뀌는 시간은 싣지 않으므로 글이 같으면 네이티브를 다시 부르지 않는다.
  const liveJson = useMemo(() => {
    if (!run || !script) return null;
    const live = liveStateOf({
      run,
      maskMode,
      revealed: myTurnNow && turnDone,
      showOriginal: aid === 'original',
      chipLabel: chip.label,
      scene: sceneLabelAt({ title: script.title, scenes: script.scenes, lineIds: run.lineIds, index: run.index }),
      labelOf: (role) => roleLabel(script.characters, role, t('reading.together')),
    });
    return live && JSON.stringify(live);
  }, [run, script, maskMode, myTurnNow, turnDone, aid, chip.label]);
  const liveOn = phase.kind === 'running' && !tipOpen && !!run && run.status !== 'done';
  const liveJsonRef = useRef(liveJson);
  liveJsonRef.current = liveJson;
  // 리딩이 시작되면(앱이 화면에 있을 때 — 안드로이드 14+ 의 마이크 서비스 조건) 띄우고, 끝나거나 화면을 떠나면 내린다.
  useEffect(() => {
    if (!liveOn) return;
    keepReadingInBackground();
    if (liveJsonRef.current) startReadingLive(JSON.parse(liveJsonRef.current), t('reading.liveChannel'));
    return () => stopReadingLive();
  }, [liveOn]);
  useEffect(() => {
    if (liveOn && liveJson) updateReadingLive(JSON.parse(liveJson));
  }, [liveOn, liveJson]);

  // ── 화면 ────────────────────────────────────────────────────────────────────
  if (!script || !session || !config || !run) {
    return (
      <View style={[styles.root, styles.center]}>
        <Text style={styles.dim}>{t('reading.noScript')}</Text>
        <Pressable style={styles.pill} onPress={() => router.dismissTo('/reading')}>
          <Text style={styles.pillText}>{t('reading.toMyScripts')}</Text>
        </Pressable>
      </View>
    );
  }

  if (phase.kind === 'need_mic') {
    return (
      <ReadingStatus
        icon="mic-off"
        title={t('reading.micNeededTitle')}
        body={t('reading.micNeededBody')}
        onBack={exitToDetail}
        primary={{ label: t('reading.micOpenSettings'), onPress: () => void Linking.openSettings() }}
        secondary={{ label: t('reading.exitLeave'), onPress: exitToDetail }}
      />
    );
  }

  if (phase.kind === 'preparing') {
    const progress = phase.progress;
    // pen R9.5·R9.6 — 가운데 액티와 큰 제목, 그 아래 진행 막대와 파란 진행 글. 내려받는 중이면 아래에 「처음 한 번만 받아요」 상자.
    const download = progress?.phase === 'download' ? progress : null;
    // 모델을 올리는 중·첫 대사를 만드는 중이면 끝난 단계를 퍼센트로 보인다(SOMA-631). 그 앞은 셀 것이 없어 제목만.
    const percent = download ? download.percent : loadPercent(progress);
    const title = download ? t('reading.voiceDownloadTitle') : percent !== null ? t('reading.voiceLoadTitle') : t('reading.voicePreparing');
    return (
      <View style={[styles.root, styles.prepRoot, { paddingTop: insets.top, paddingBottom: insets.bottom + 24 }]}>
        <View style={styles.prepBody}>
          <Image source={MASCOT_IMG[prepPose]} style={styles.prepMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <Text style={styles.prepTitle}>{title}</Text>
          {percent !== null && (
            <>
              <View style={styles.downloadTrack} accessibilityRole="progressbar" accessibilityValue={{ min: 0, max: 100, now: percent }}>
                <View style={[styles.downloadFill, { width: `${percent}%` }]} />
              </View>
              <Text style={styles.prepProgress}>{download ? `${percent}% · ${formatDownloadProgress(download, t)}` : `${percent}%`}</Text>
            </>
          )}
        </View>
        {/* 광고 칸(SOMA-876) — 연습 중 칸, 아래쪽 묶음 바로 위. */}
        <AdSlot slot="voice_prepare_wait" style={{ marginBottom: download ? 24 : 0 }} />
        {download && (
          <InfoBanner title={t('reading.voiceDownloadNoteTitle')} body={t('reading.voiceDownloadNoteBody')} />
        )}
        {dialog}
      </View>
    );
  }

  if (phase.kind === 'voice_failed') {
    const { failure } = phase;
    // pen 「상대역 목소리를 못 만들었어요」 — [다시 시도] 또는 기기 목소리(없으면 글로 보기)로 그대로 시작한다.
    return (
      <View style={styles.root}>
        <ReadingStatus
          title={t('reading.voiceFailTitle')}
          body={t('reading.voiceFailBody')}
          note={
            failure.kind === 'storage'
              ? t('reading.voiceFailStorage', { size: formatMegabytes(failure.neededBytes ?? modelDownloadBytes(activeVariant())) })
              : failure.kind === 'network'
                ? t('reading.voiceFailNetwork')
                : undefined
          }
          onBack={exitToDetail}
          primary={{ label: t('reading.voiceRetry'), onPress: () => void prepare() }}
          secondary={{
            label: t('reading.voiceUseDevice'),
            onPress: () => {
              chooseEngine(choosePartnerVoice({ cloud: false, appVoice: false, deviceVoice: deviceVoiceRef.current }));
              startRunning();
            },
          }}
        />
        {dialog}
      </View>
    );
  }

  if (phase.kind === 'voice_unsupported') {
    return (
      <ReadingStatus
        icon="smartphone"
        title={t('reading.voiceUnsupportedTitle')}
        body={t('reading.voiceUnsupportedBody')}
        onBack={exitToDetail}
        primary={{
          label: t('reading.continueAnyway'),
          onPress: () => {
            void markAppVoiceNoticed();
            startRunning();
          },
        }}
      />
    );
  }

  if (phase.kind === 'closed') {
    return <ReadingStatus title={phase.message} onBack={exitToDetail} primary={{ label: t('reading.toDetail'), onPress: exitToDetail }} />;
  }

  if (phase.kind === 'done' && wrapUp) {
    const wrap = wrapUpProgress(run.lines, run.endIndex);
    // pen 「새 · 리딩 마무리」. 이어 읽기 알림·「일정 붙여 두기」는 서버·알림 기능이 없어 숨긴다.
    return (
      <View style={[styles.root, { paddingTop: insets.top + 24 }]}>
        <ScrollView contentContainerStyle={styles.wrapContent}>
          <View style={styles.wrapBadge}>
            <Feather name="check-circle" size={16} color={palette.green} />
            <Text style={styles.wrapBadgeText}>{t('reading.wrapBadge')}</Text>
          </View>
          <View style={styles.wrapHead}>
            <Image source={MASCOT_IMG[donePose]} style={styles.wrapMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.wrapHeading}>{t('reading.wrapHeading')}</Text>
          </View>
          <View style={styles.wrapCard}>
            <Text style={styles.wrapMeta}>{t('reading.wrapMeta', { title: script.title, total: wrap.total })}</Text>
            <Text style={styles.wrapNext}>
              {wrap.next === null ? t('reading.wrapAll') : t('reading.wrapNext', { readTo: wrap.readTo, next: wrap.next })}
            </Text>
          </View>
          <Pressable style={styles.wrapRow} onPress={toCoach} accessibilityRole="button">
            <Feather name="video" size={18} color={palette.textDim} />
            <Text style={styles.wrapRowText}>{t('reading.wrapCoach')}</Text>
            <Feather name="chevron-right" size={18} color={palette.checkOff} />
          </Pressable>
        {ratingCard}
        </ScrollView>
        <CtaBar>
          <PrimaryButton label={t('common.confirm')} onPress={exitToDetail} />
        </CtaBar>
        {dialog}
      </View>
    );
  }

  if (phase.kind === 'done') {
    const completed = !stoppedEarlyRef.current && readingRunCompleted({
      reachedEnd: true,
      said: run.said,
      priorRecognized: sessionHasRecognized(session),
      recognition: sttMode?.kind ?? null,
    });
    // 완료 화면들이 함께 쓰는 「홈으로 가기」·「다른 대본으로」 — replace 하면 탭 묶음이 하나 더 쌓여 뒤로가기가 엉뚱한 탭으로 가서,
    // 이미 있는 탭까지 내려간다(SOMA-853).
    const goHomeButton = <PrimaryButton label={t('reading.goHome')} onPress={() => router.dismissTo('/(tabs)')} disabled={doneLocked} />;
    const otherScriptRow = (
      <Pressable style={[styles.readAgainRow, styles.otherScript]} onPress={() => router.dismissTo('/reading')} accessibilityRole="button">
        <Feather name="file-text" size={16} color={palette.textDim} />
        <Text style={styles.otherScriptText}>{t('reading.otherScript')}</Text>
      </Pressable>
    );
    const firstStopped = firstReading && firstStoppedRef.current;
    if ((completed && (firstRunRef.current || fromTutorialRef.current || firstReading)) || firstStopped) {
      // pen R9.51 첫 리딩 끝 — 액티 칭찬 아래 가운데에 큰 「홈으로 가기」, 그 밑에 「한 번 더 읽기」. 하단 버튼 영역은 없다.
      const total = wrapUpProgress(run.lines, run.endIndex).total;
      return (
        <View style={[styles.root, { paddingTop: insets.top + 12 }]}>
          <Text style={styles.firstDoneBar}>{t(completed ? 'reading.completeTitle' : 'reading.firstStopBar')}</Text>
          <View style={styles.firstDoneBody}>
            <Image source={MASCOT_IMG[FIRST_DONE_POSE]} style={styles.doneMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.firstDoneTitle}>{t(completed ? 'reading.firstDoneTitle' : 'reading.firstStopTitle')}</Text>
            <Text style={styles.firstDoneMeta}>{t('reading.firstDoneMeta', { title: script.title, roles: config.myNames.join(', '), total, count: readDialogueCount(run.lines, run.startIndex, run.endIndex) })}</Text>
            <View style={styles.firstDoneActions}>
              {goHomeButton}
              <Pressable
                style={[styles.readAgainRow, (doneLocked || restarting) && styles.readAgainOff]}
                onPress={() => void readAgain()}
                disabled={doneLocked || restarting}
                accessibilityRole="button"
                accessibilityLabel={t('reading.firstDoneAgain')}
                accessibilityState={{ disabled: doneLocked || restarting }}>
                {restarting ? (
                  <LoadingText label={t('loadingText.preparing')} color={palette.blueDeep} />
                ) : (
                  <>
                    <Feather name="rotate-ccw" size={16} color={palette.blueDeep} />
                    <Text style={styles.readAgainText}>{t('reading.firstDoneAgain')}</Text>
                  </>
                )}
              </Pressable>
            </View>
            {ratingCard}
          </View>
          {dialog}
        </View>
      );
    }
    if (monologue) {
      // 독백 결과(pen T79rDt) — 끝난 뒤 녹음 전체를 문장별로 맞춘 결과. 「원문과 다르게 말한 대사」 칸은 두지 않는다.
      const compared = sttMode?.kind === 'stt' && !!monoResult;
      const total = monoResult?.rows.length ?? 0;
      const statusLabel = { read: t('reading.monologueStatusRead'), missed: t('reading.monologueStatusMissed'), different: t('reading.monologueStatusDifferent') };
      return (
        <View style={[styles.root, { paddingBottom: keyboardHeight }]}>
          <ScrollView ref={doneScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.doneContent, { paddingTop: insets.top + 24 }]}>
            <Image source={MASCOT_IMG[completed ? donePose : NOT_COUNTED_POSE]} style={styles.doneMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
            <Text style={styles.doneTitle}>{t(completed ? 'reading.monologueDoneTitle' : 'reading.notCountedTitle')}</Text>
            {!completed ? (
              <Text style={styles.dim}>{t('reading.notCountedBody')}</Text>
            ) : compared ? (
              <Text style={styles.dim}>
                {monoResult!.missed > 0 ? t('reading.monologueMissed', { total, count: monoResult!.missed }) : t('reading.monologueAllRead', { total })}
              </Text>
            ) : null}
            <Text style={styles.dim}>{script.title}</Text>
            <View style={styles.doneStats}>
            <Text style={styles.doneStat}>{config.myNames.join(', ')} · {mmss(run.elapsedMs)}</Text>
            {pendingUploads > 0 && <Text style={styles.doneStatFaint}>{t('reading.recordingPending', { count: pendingUploads })}</Text>}
          </View>
            {/* 녹음 코치(무료, 위에 크게)·발음 보고서(작은 줄) — 서버 스위치를 켠 배포·허용된 사람만(SOMA-791·606). */}
            {completed && !fromTutorialRef.current && <><ReadingAfterCard sessionId={session.id} ready={pendingUploads === 0} part="coach" /><PrimaryButton label={t('reading.recordForCoach')} onPress={toCoach} disabled={doneLocked} /></>}
            {!compared ? (
              <View style={styles.noteBox}>
                <Feather name="info" size={16} color={palette.textMuted} />
                <Text style={styles.noteText}>{t('reading.noSttNote')}</Text>
              </View>
            ) : (
              <View style={styles.diffBox}>
                {monoResult!.rows.map((r, k) =>
                  r.status === 'missed' ? (
                    <Pressable
                      key={r.lineId}
                      style={styles.monoRow}
                      onPress={() => void readAgain(r.lineId)}
                      disabled={doneLocked || restarting}
                      accessibilityRole="button"
                      ph-label="reading_monologue_retry_from">
                      <Text style={styles.monoRowText}>{`${k + 1}. ${r.text}`}</Text>
                      <Text style={styles.monoTagMissed}>{`${statusLabel.missed} · ${t('reading.monologueRetryFrom')}`}</Text>
                    </Pressable>
                  ) : (
                    <View key={r.lineId} style={styles.monoRow}>
                      <Text style={styles.monoRowText}>{`${k + 1}. ${r.text}`}</Text>
                      <Text style={styles.monoTag}>{statusLabel[r.status]}</Text>
                    </View>
                  ),
                )}
              </View>
            )}
            <View style={styles.doneLinks}>
            <Pressable
              style={[styles.readAgainRow, (doneLocked || restarting) && styles.readAgainOff]}
              onPress={() => void readAgain()}
              disabled={doneLocked || restarting}
              accessibilityRole="button"
              accessibilityLabel={t('reading.readAgain')}
              accessibilityState={{ disabled: doneLocked || restarting }}>
              {restarting ? (
                <LoadingText label={t('loadingText.preparing')} color={palette.blueDeep} />
              ) : (
                <>
                  <Feather name="rotate-ccw" size={16} color={palette.blueDeep} />
                  <Text style={styles.readAgainText}>{t('reading.readAgain')}</Text>
                </>
              )}
            </Pressable>
            {otherScriptRow}
            </View>
            {completed && !fromTutorialRef.current && (
              <View style={styles.ratingSlot}>
                <ReadingRating sessionId={session.id} onInputFocus={liftRatingInput} />
              </View>
            )}
          {ratingCard}
          </ScrollView>
          <View style={[styles.doneBar, { paddingBottom: insets.bottom + 10 }]}>
            {completed && !fromTutorialRef.current && <ReadingAfterCard sessionId={session.id} ready={pendingUploads === 0} part="report" />}
            {goHomeButton}
          </View>
          {dialog}
        </View>
      );
    }
    const readCount = readDialogueCount(run.lines, run.startIndex, run.endIndex);
    const wholeScript = run.startIndex <= run.lines.findIndex((l) => l.type === 'dialogue') && run.endIndex >= run.lines.length - 1;
    const compared = sttMode?.kind === 'stt';
    const textOf = (lineId: string) => run.lines[run.lineIds.indexOf(lineId)]?.text ?? '';
    return (
      <View style={[styles.root, { paddingBottom: keyboardHeight }]}>
        <ScrollView ref={doneScrollRef} keyboardShouldPersistTaps="handled" contentContainerStyle={[styles.doneContent, { paddingTop: insets.top + 24 }]}>
          <Image source={MASCOT_IMG[completed ? donePose : NOT_COUNTED_POSE]} style={styles.doneMascot} contentFit="contain" cachePolicy="memory-disk" accessibilityIgnoresInvertColors />
          <Text style={styles.doneTitle}>{t(completed ? 'reading.completeTitle' : 'reading.notCountedTitle')}</Text>
          {!completed && <Text style={styles.dim}>{t('reading.notCountedBody')}</Text>}
          <Text style={styles.dim}>{script.title}</Text>
          <View style={styles.doneStats}>
            <Text style={styles.doneStat}>{completed ? t('reading.doneLineStats', { roles: config.myNames.join(', '), count: readCount, time: mmss(run.elapsedMs) }) : `${config.myNames.join(', ')} · ${mmss(run.elapsedMs)}`}</Text>
            {pendingUploads > 0 && <Text style={styles.doneStatFaint}>{t('reading.recordingPending', { count: pendingUploads })}</Text>}
          </View>
          {completed && !wholeScript && <Text style={styles.doneStatFaint}>{t('reading.donePartialNote')}</Text>}
          {/* 녹음 코치(무료, 위에 크게)·발음 보고서(작은 줄) — 서버 스위치를 켠 배포·허용된 사람만(SOMA-791·606). */}
          {completed && !fromTutorialRef.current && <ReadingAfterCard sessionId={session.id} ready={pendingUploads === 0} part="coach" />}

          {!completed ? null : !compared ? (
            <View style={styles.noteBox}>
              <Feather name="info" size={16} color={palette.textMuted} />
              <Text style={styles.noteText}>{t('reading.noSttNote')}</Text>
            </View>
          ) : different.kind === 'waiting' ? (
            <View style={styles.noteBox}>
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

          {/* 다시 연습은 실행 중 [다음] 자리(아래 오른쪽)를 피해 본문에 둔다 — 연타로 새 연습이 바로 시작되지 않게(SOMA-772). */}
          <View style={styles.doneLinks}>
          <Pressable
            style={[styles.readAgainRow, (doneLocked || restarting) && styles.readAgainOff]}
            onPress={() => void readAgain()}
            disabled={doneLocked || restarting}
            accessibilityRole="button"
            accessibilityLabel={t('reading.readAgain')}
            accessibilityState={{ disabled: doneLocked || restarting }}>
            {restarting ? (
              <LoadingText label={t('loadingText.preparing')} color={palette.blueDeep} />
            ) : (
              <>
                <Feather name="rotate-ccw" size={16} color={palette.blueDeep} />
                <Text style={styles.readAgainText}>{t('reading.readAgain')}</Text>
              </>
            )}
          </Pressable>
          {otherScriptRow}
          </View>

          {/* 이번 리딩 어땠나요?(SOMA-661) — 튜토리얼 예시 회차는 서버 회차가 아니라 받지 않는다. */}
          {completed && !fromTutorialRef.current && (
            <View style={styles.ratingSlot}>
              <ReadingRating sessionId={session.id} onInputFocus={liftRatingInput} />
            </View>
          )}

        {ratingCard}
        </ScrollView>
        <View style={[styles.doneBar, { paddingBottom: insets.bottom + 10 }]}>
          {completed && !fromTutorialRef.current && <ReadingAfterCard sessionId={session.id} ready={pendingUploads === 0} part="report" />}
            {goHomeButton}
        </View>
        {dialog}
      </View>
    );
  }

  // running
  const hold = phase.hold;
  const line = run.lines[run.index];
  const isDialogue = !!line && line.type === 'dialogue';
  const myTurn = myTurnNow;
  const paused = run.status === 'paused';
  const mineOf = (l: ScriptLine) => l.type === 'dialogue' && run.myRoles.includes(l.role);
  const hiddenOf = (l: ScriptLine) => isHidden({ maskMode, line: l, isMine: mineOf(l) });
  // 내 차례를 끝냈으면 가린 내 대사도 원문으로 펼친다(SOMA-785). 말하기 전에는 가린 그대로다.
  const revealed = myTurn && turnDone;
  const currentText = line ? shownText(line.text, hiddenOf(line) && !revealed, aid) : null;
  const labelOf = (role: string) => roleLabel(script.characters, role, t('reading.together'));
  const saidOf = (lineId: string) => (sttMode?.kind === 'stt' ? run.said[lineId] : undefined);
  const masking = maskMode !== 'none';

  const coachElement = coachMark ? (
    <ReadingCoachMark
      label={t('reading.coachLabel')}
      text={t(COACH_TEXT[coachMark])}
      onClose={() => finishCoachMark(coachMark)}
    />
  ) : null;

  const hint = paused ? t(interrupted ? 'reading.interruptedBody' : 'reading.pausedBody') : myTurn && turnNote === 'silence' ? t('reading.silenceHint') : myTurn && turnNote === 'limit' ? t('reading.limitHint') : null;


  // 지나간 줄은 같은 배역 묶음(SOMA-806)마다 하나로 쌓는다. 독백은 문장 목록이 지금 카드 안에 다 있어 위로 쌓지 않는다(pen c1MiZ).
  const past: { key: string; index: number; lines: { id: string; line: ScriptLine }[] }[] = [];
  if (!monologue) {
    for (const g of lineGroups(run.lines, { monologue })) {
      const start = Math.max(g.start, run.startIndex);
      const end = Math.min(g.end, (beatOn ? beatLines[0] : run.index) - 1, run.endIndex);
      if (start > end) continue;
      const lines = run.lines.slice(start, end + 1).map((l, k) => ({ id: run.lineIds[start + k], line: l }));
      past.push({ key: run.lineIds[start], index: start, lines });
    }
  }
  // 첫 대사 앞 지문(구간 밖, 무대·인물 소개) — 시작 멈춤 동안은 카드에 있고, 그 밖에는 기록 맨 위에 둔다(SOMA-937).
  const leadLines = monologue ? [] : directionsBefore(run.lines, run.startIndex).filter((i) => !beatLines.includes(i));
  // 지금 차례의 나머지 줄 — 묶인 대사는 한 카드에 줄마다 이어 보인다. 「첫 단어」는 첫 줄에만, 「원문 보기」는 묶음 전체에 적용된다.
  const span = turnSpan(run);
  const restLines = isDialogue && !monologue ? run.lines.slice(span.start + 1, span.end + 1) : [];
  const monoIndexes = monologue ? sentenceIndexes(run, run.startIndex) : [];
  const monoCounter = monologue
    ? t('reading.monologueProgress', { n: Math.max(0, monoIndexes.indexOf(run.index)) + 1, total: monoIndexes.length, time: mmss(run.elapsedMs) })
    : null;

  return (
    <View style={[styles.root, { paddingTop: insets.top }]}>
      <View style={styles.topBar}>
        <Pressable style={styles.exitBtn} onPress={onExit} hitSlop={8}>
          <Feather name="x" size={20} color={palette.textDim} />
          <Text style={styles.exitText}>{t('reading.exitLeave')}</Text>
        </Pressable>
        {notice?.kind === 'dropped' ? <Text style={styles.droppedText}>{t('reading.recordingDropped', { count: notice.count })}</Text> : <View />}
        <View style={styles.topRight}>
          <Text style={styles.counter}>{monoCounter ?? formatProgress(run)}</Text>
          {firstReading && phase.kind === 'running' && hold !== 'tip' && run.status !== 'done' && (
            // 첫 리딩은 대본 전체를 읽는다 — 긴 대본도 언제든 여기서 끝내고 첫 리딩 끝 화면으로 간다(10/29).
            <Pressable onPress={firstStop} hitSlop={8} accessibilityRole="button" ph-label="reading_first_stop">
              <Text style={styles.firstStopText}>{t('reading.firstStop')}</Text>
            </Pressable>
          )}
        </View>
      </View>
      <View style={styles.progressTrack} onLayout={(e) => setTipTop(e.nativeEvent.layout.y + e.nativeEvent.layout.height)}>
        <View style={[styles.progressFill, { width: `${Math.round((progressOf(run).done / Math.max(1, progressOf(run).total)) * 100)}%` }]} />
      </View>
      {proVoiceHint && (
        <Pressable style={styles.proHint} onPress={() => router.push('/pro')} accessibilityRole="button" accessibilityLabel={t('reading.proVoiceHint')}>
          <Text style={styles.proHintText}>{t('reading.proVoiceHint')}</Text>
        </Pressable>
      )}
      {notice?.kind === 'cloud_fallback' && (
        <View style={styles.toast}>
          <Text style={styles.toastText}>{t('reading.cloudFallbackToast')}</Text>
        </View>
      )}

      <ScrollView
        ref={scrollRef}
        style={styles.flow}
        contentContainerStyle={styles.flowContent}
        onContentSizeChange={() => !monologue && scrollRef.current?.scrollTo({ y: Math.max(0, dialogueCardY.current - 12), animated: true })}>
        {/* 지나간 대사를 누르면 그 줄부터 다시 한다(SOMA-785). 탭 기록에 대본 글이 실리지 않게 ph-label 을 붙인다. */}
        {leadLines.map((i) => {
          const l = run.lines[i];
          return <Text key={run.lineIds[i]} style={styles.direction}>{l.type === 'direction' ? directionLabel(l.text) : l.text}</Text>;
        })}
        {past.map(({ key, index, lines }) => {
          const l = lines[0].line;
          if (l.type !== 'dialogue') return <Text key={key} style={styles.direction}>{l.type === 'direction' ? directionLabel(l.text) : l.text}</Text>;
          return (
            <Pressable
              key={key}
              style={({ pressed }) => [styles.pastRow, pressed && styles.pastRowPressed]}
              onPress={() => jumpBack(index)}
              accessibilityRole="button"
              ph-label="reading_play_jump">
              <Text style={styles.pastRole}>{labelOf(l.role)}</Text>
              {/* 지금 줄보다 앞의 대사는 가리지 않는다(SOMA-802, 10/22 결정). 가린 내 대사는 말한 것과 함께 펼친다. */}
              {lines.map(({ id, line: g }) =>
                mineOf(g) && masking ? (
                  <SpokenText key={id} text={g.text} said={saidOf(id)} />
                ) : (
                  <Text key={id} style={styles.pastText}>{g.text}</Text>
                ),
              )}
            </Pressable>
          );
        })}

        {coachMark !== 'next' && coachElement}

        {monologue && (
          // 독백 — 문장 목록을 보이고 읽는 문장만 진하게(pen c1MiZ). 상대역 목소리는 없고 녹음은 끝낼 때까지 이어진다.
          <View style={[styles.card, styles.cardMine]} onLayout={(e) => (monoCardY.current = e.nativeEvent.layout.y)}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardRole, styles.cardRoleMine]}>{t('reading.monologueRole', { role: config.myNames.join(', ') })}</Text>
              <View style={styles.cardHeadRight}>
                <View style={styles.chip}>
                  {hold === 'tip' || paused || !listening ? (
                    <Feather name={paused ? 'pause' : 'mic'} size={14} color={palette.blueDeep} />
                  ) : (
                    <ListeningBars />
                  )}
                  <Text style={[styles.chipText, styles.chipTextMine]}>
                    {hold === 'tip' ? t('reading.chipBeforeStart') : paused ? t('reading.pause') : listening ? t('reading.monologueRecording') : t('reading.chipMicOpening')}
                  </Text>
                </View>
                {hold !== 'tip' && (
                  <Pressable onPress={openLineEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('reading.lineEditTitle')} ph-label="reading_play_line_edit">
                    <Feather name="edit-2" size={16} color={palette.blueDeep} />
                  </Pressable>
                )}
              </View>
            </View>
            {run.lines.slice(run.startIndex, run.endIndex + 1).map((l, k) => {
              const i = run.startIndex + k;
              if (l.type !== 'dialogue') return <Text key={run.lineIds[i]} style={styles.direction}>{l.type === 'direction' ? directionLabel(l.text) : l.text}</Text>;
              const now = i === run.index;
              return (
                <View key={run.lineIds[i]} onLayout={(e) => (monoItemY.current[i] = e.nativeEvent.layout.y)}>
                  {hiddenOf(l) && i >= run.index && !(now && aid === 'original') ? (
                    <HiddenBars text={l.text} tone={now ? 'current' : 'past'} />
                  ) : (
                    <Text style={now ? styles.monoNow : styles.monoOther}>{l.text}</Text>
                  )}
                </View>
              );
            })}
            {hiddenOf(line) && aid !== 'original' && hold !== 'tip' && (
              <View style={styles.aidRow}>
                <Pressable style={styles.aidPill} onPress={() => setAid('original')}>
                  <Feather name="eye" size={14} color={palette.blueDeep} />
                  <Text style={styles.aidText}>{t('reading.showOriginal')}</Text>
                </Pressable>
              </View>
            )}
          </View>
        )}

        {beatOn && (
          // 지문 멈춤 카드(SOMA-937) — 읽을 줄이 아니라 상황이라 회색 카드에 지문 글을 그대로 보인다. [다음]으로 바로 넘어간다.
          <View style={[styles.card, styles.cardOther]} accessibilityLiveRegion="polite">
            <View style={styles.cardHead}>
              <Text style={styles.cardRole}>{t('reading.directionCard')}</Text>
            </View>
            {beatLines.map((i) => {
              const l = run.lines[i];
              return (
                <Text key={run.lineIds[i]} style={l.type === 'scene' ? styles.beatScene : styles.beatText}>
                  {l.text}
                </Text>
              );
            })}
          </View>
        )}

        {isDialogue && !monologue && !beatOn && (
          <View style={[styles.card, myTurn ? styles.cardMine : styles.cardOther]} onLayout={(e) => (dialogueCardY.current = e.nativeEvent.layout.y)}>
            <View style={styles.cardHead}>
              <Text style={[styles.cardRole, myTurn && styles.cardRoleMine]}>
                {labelOf((line as DialogueLine).role)}
                {myTurn ? ` · ${t('reading.myTurn')}` : ''}
              </Text>
              <View style={styles.cardHeadRight}>
                <View style={styles.chip}>
                  {chip.icon === 'bars' ? <ListeningBars /> : <Feather name={chip.icon} size={14} color={myTurn ? palette.blueDeep : palette.textMuted} />}
                  <Text style={[styles.chipText, myTurn && styles.chipTextMine]}>{chip.label}</Text>
                </View>
                {hold !== 'tip' && (
                  <Pressable onPress={openLineEdit} hitSlop={10} accessibilityRole="button" accessibilityLabel={t('reading.lineEditTitle')} ph-label="reading_play_line_edit">
                    <Feather name="edit-2" size={16} color={myTurn ? palette.blueDeep : palette.textMuted} />
                  </Pressable>
                )}
              </View>
            </View>
            {currentText === null ? (
              <HiddenBars text={line.text} tone="current" />
            ) : aid === 'first_word' && hiddenOf(line) && !revealed ? (
              <View style={styles.firstWordRow}>
                <Text style={styles.lineText}>{currentText}</Text>
                <View style={styles.firstWordRest}>
                  <HiddenBars text={line.text.trim().slice(currentText.length)} tone="current" />
                </View>
              </View>
            ) : (
              <Text style={styles.lineText}>{currentText}</Text>
            )}
            {restLines.map((l, k) => {
              const shown = shownText(l.text, hiddenOf(l) && !revealed, aid === 'original' ? 'original' : 'none');
              const key = run.lineIds[span.start + 1 + k];
              return shown === null ? <HiddenBars key={key} text={l.text} tone="current" /> : <Text key={key} style={styles.lineText}>{shown}</Text>;
            })}
            {myTurn && hiddenOf(line) && !revealed && aid !== 'original' && (
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

        {isDialogue && myTurn && !beatOn && sttMode?.kind === 'stt' && (
          <View style={styles.saidBox}>
            <Text style={styles.saidLabel}>{t('reading.saidLabel')}</Text>
            <Text style={styles.saidText}>{said || t('reading.noSpeechYet')}</Text>
          </View>
        )}
      </ScrollView>

      {notice?.kind === 'jump' && (
        <View style={[styles.toast, styles.jumpToast]}>
          <Feather name="rotate-ccw" size={14} color="#fff" />
          <Text style={styles.toastText}>{t('reading.jumpToast', { text: notice.text })}</Text>
        </View>
      )}
      {!!hint && <Text style={styles.hint}>{hint}</Text>}
      {coachMark === 'next' && <View style={styles.coachAboveControls}>{coachElement}</View>}

      {/* 시작 전에는 아래 버튼 줄을 숨기되 자리는 남긴다 — 빼 버리면 대사 카드가 폰 아래 버튼 줄 밑으로 내려가 잘렸다(10/26). */}
      <>
      {hold === 'mask_sheet' && (
        // 대사 보기 고르기 — 시트 대신 컨트롤 바로 위에 세 칸으로 펼친다. 고르면 접히고, 펼친 동안은 자동 넘김이 멈춰 있다.
        <View style={styles.maskRow} accessibilityRole="radiogroup">
          {MASKS.map((m) => {
            const on = maskMode === m.key;
            return (
              <Pressable key={m.key} style={[styles.maskOpt, on && styles.maskOptOn]} onPress={() => changeMask(m.key)} accessibilityRole="radio" accessibilityState={{ checked: on }} ph-label="reading_play_mask_pick">
                <Text style={[styles.maskOptText, on && styles.maskOptTextOn]} numberOfLines={2}>{m.label}</Text>
              </Pressable>
            );
          })}
        </View>
      )}
      <View
        style={[styles.controls, { paddingBottom: insets.bottom + 12 }, hold === 'tip' && styles.controlsHidden]}
        pointerEvents={hold === 'tip' ? 'none' : 'auto'}
        accessibilityElementsHidden={hold === 'tip'}
        importantForAccessibility={hold === 'tip' ? 'no-hide-descendants' : 'auto'}>
        <Pressable style={[styles.eyeBtn, masking && styles.eyeBtnOn]} onPress={openMaskSheet} hitSlop={4} accessibilityRole="button" accessibilityLabel={t('reading.maskSheetTitle')} ph-label="reading_play_mask">
          <Feather name={masking ? 'eye-off' : 'eye'} size={20} color={masking ? palette.blueDeep : palette.textDim} />
          {masking && <View style={styles.eyeDot} />}
        </Pressable>
        {paused ? (
          <>
            <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={stopHere} accessibilityRole="button" ph-label="reading_play_stop">
              <Feather name="square" size={16} color={palette.textDim} />
              <Text style={styles.ctrlGhostText}>{t('reading.stopHere')}</Text>
            </Pressable>
            <Pressable style={[styles.ctrl, styles.ctrlPrimary]} onPress={doResume}>
              <Feather name="play" size={16} color="#fff" />
              <Text style={styles.ctrlPrimaryText}>{t('reading.resume')}</Text>
            </Pressable>
          </>
        ) : (
          <>
            {/* 독백에는 [이전]이 없다 — 한 호흡으로 끝까지 읽고 끝난 뒤 문장부터 다시 한다. */}
            {!monologue && (
              <Pressable
                style={[styles.eyeBtn, !canGoBack(run) && styles.backBtnOff]}
                onPress={goBack}
                disabled={!canGoBack(run)}
                hitSlop={4}
                accessibilityRole="button"
                accessibilityLabel={t('reading.prev')}
                ph-label="reading_play_prev">
                <Feather name="skip-back" size={20} color={palette.textDim} />
              </Pressable>
            )}
            <Pressable style={[styles.ctrl, styles.ctrlGhost]} onPress={doPause}>
              <Feather name="pause" size={16} color={palette.textDim} />
              <Text style={styles.ctrlGhostText}>{t('reading.pause')}</Text>
            </Pressable>
            <Pressable
              style={[styles.ctrl, styles.ctrlPrimary]}
              onPress={() => {
                if (monologue) void finishMonologue();
                else if (beatOn) setBeatDoneAt(run.index);
                else if (myTurn) void endMyTurn(run.index);
                else goNext(run.index);
              }}>
              <Text style={styles.ctrlPrimaryText}>{t(monologue ? 'reading.monologueFinish' : 'reading.next')}</Text>
              <Feather name="arrow-right" size={16} color="#fff" />
            </Pressable>
          </>
        )}
      </View>
      </>
      {hold === 'tip' && (
        // 리딩 시작 전 — 자동 넘김 안내와 [시작]을 가운데 팝업으로 띄운다(SOMA-839). 위 [나가기]는 덮지 않아 시작 전에도 나갈 수 있다.
        <View style={[styles.backdrop, { top: tipTop }]}>
          <View style={styles.startCard}>
            {startHint && <Text style={styles.startHint}>{t(monologue ? 'reading.monologueStartHint' : 'reading.startHint')}</Text>}
            <PrimaryButton label={t('reading.start')} onPress={() => void closeTip(false)} />
            {startHint && (
              <Pressable onPress={() => void closeTip(true)} hitSlop={8} accessibilityRole="button">
                <Text style={styles.startSkip}>{t('reading.startSkipNext')}</Text>
              </Pressable>
            )}
          </View>
        </View>
      )}

      {script && (
        <>
        <LineEditSheet
          scriptId={script.id}
          lineId={editing?.lineId ?? null}
          original={editing?.draft ?? null}
          characters={script.characters}
          choices={editing?.choices}
          loadLine={(id) => editing?.drafts?.[id] ?? null}
          onClose={closeLineEdit}
        />
        </>
      )}
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

/**
 * 가렸던 내 지나간 대사(SOMA-785) — 원문을 펼치고, 받아쓴 글이 있으면 다르게 말한 어절에 주황 밑줄을 긋고 아래에
 * 「말한 것  …」을 작게 둔다. 받아쓴 글이 없으면(말없이 넘김·음성 인식 없음) 원문만.
 */
function SpokenText({ text, said }: { text: string; said?: string }) {
  const heard = said?.trim();
  const words = heard ? diffWords(text, heard) : null;
  return (
    <View style={styles.spoken}>
      <Text style={styles.pastText}>
        {words
          ? words.map((w, i) => (
              <Fragment key={i}>
                {i > 0 ? ' ' : ''}
                <Text style={w.differs ? styles.differs : undefined}>{w.text}</Text>
              </Fragment>
            ))
          : text}
      </Text>
      {!!heard && (
        <Text style={styles.spokenSaid}>
          <Text style={styles.spokenLabel}>{t('reading.spokenLabel')}</Text>
          {`  ${heard}`}
        </Text>
      )}
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
  downloadTrack: { alignSelf: 'stretch', height: 8, borderRadius: 999, backgroundColor: palette.bgSoft, overflow: 'hidden', marginTop: 8 },
  downloadFill: { height: 8, borderRadius: 999, backgroundColor: palette.blue },
  prepRoot: { paddingHorizontal: 24 },
  prepBody: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 12 },
  prepMascot: { width: 84, height: 94, marginBottom: 8 },
  prepTitle: { color: palette.text, fontSize: 24, fontWeight: '800', lineHeight: 34, textAlign: 'center' },
  prepProgress: { color: palette.blue, fontSize: 14, fontWeight: '700', textAlign: 'center' },
  primaryWide: { alignSelf: 'stretch', backgroundColor: palette.blue, borderRadius: 14, paddingVertical: 16, alignItems: 'center', marginTop: 12 },
  primaryWideText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  textButton: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 15, paddingVertical: 10 },

  monoNow: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 18, lineHeight: 27, marginTop: 6 },
  monoOther: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 23, marginTop: 6 },
  monoRow: { alignSelf: 'stretch', gap: 2, paddingVertical: 8, borderBottomColor: palette.borderSoft, borderBottomWidth: 1 },
  monoRowText: { color: palette.text, fontFamily: 'Pretendard-SemiBold', fontSize: 15, lineHeight: 22 },
  monoTag: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 12 },
  monoTagMissed: { color: palette.amber, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  doneMascot: { width: 120, height: 120 },
  doneLinks: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 20 },
  otherScript: { marginTop: 0 },
  otherScriptText: { color: palette.textDim, fontSize: 15, fontWeight: '700' },
  firstDoneBar: { color: palette.text, fontSize: 17, fontWeight: '800', textAlign: 'center', paddingVertical: 12 },
  firstDoneBody: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 24, gap: 12 },
  firstDoneTitle: { color: palette.text, fontSize: 24, fontWeight: '800', lineHeight: 32, textAlign: 'center', marginTop: 12 },
  firstDoneMeta: { color: palette.textMuted, fontSize: 14, lineHeight: 21, textAlign: 'center' },
  firstDoneActions: { alignSelf: 'stretch', gap: 8, marginTop: 24 },
  doneIcon: { width: 56, height: 56, borderRadius: 28, backgroundColor: palette.green, alignItems: 'center', justifyContent: 'center' },
  doneTitle: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 22, marginTop: 4, textAlign: 'center' },
  doneContent: { alignItems: 'center', gap: 12, paddingHorizontal: 24, paddingBottom: 24 },
  doneStats: { alignSelf: 'stretch', backgroundColor: palette.bgSubtle, borderRadius: 14, padding: 16, gap: 6, alignItems: 'center' },
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
  // 완료 화면은 가운데 정렬이라, 평가 상자는 다른 카드처럼 폭을 채운다.
  maskRow: { flexDirection: 'row', gap: 8, paddingHorizontal: 16, paddingTop: 10, paddingBottom: 12, backgroundColor: palette.card },
  maskOpt: { flex: 1, alignItems: 'center', justifyContent: 'center', minHeight: 44, borderRadius: 12, borderWidth: 1, borderColor: palette.border, paddingHorizontal: 6, paddingVertical: 8, backgroundColor: palette.card },
  maskOptOn: { borderColor: palette.blue, backgroundColor: palette.blueSoft },
  maskOptText: { fontSize: 13, fontWeight: '600', textAlign: 'center', color: palette.textDim },
  maskOptTextOn: { color: palette.blueDeep, fontWeight: '800' },
  ratingSlot: { alignSelf: 'stretch' },
  doneBar: { paddingHorizontal: 24, paddingTop: 12, gap: 10, borderTopColor: palette.borderSoft, borderTopWidth: 1 },
  wrapContent: { paddingHorizontal: 24, paddingBottom: 24 },
  wrapBadge: { alignSelf: 'flex-start', flexDirection: 'row', alignItems: 'center', gap: 6, backgroundColor: palette.greenSoft, borderRadius: 999, paddingVertical: 6, paddingHorizontal: 12 },
  wrapBadgeText: { color: palette.green, fontSize: 13, fontWeight: '800', lineHeight: 18 },
  wrapHead: { flexDirection: 'row', alignItems: 'center', gap: 12, marginTop: 16 },
  wrapMascot: { width: 52, height: 58 },
  wrapHeading: { flex: 1, color: palette.text, fontSize: 22, fontWeight: '800', lineHeight: 29 },
  wrapCard: { backgroundColor: palette.bgSoft, borderRadius: 16, paddingVertical: 14, paddingHorizontal: 16, gap: 6, marginTop: 18 },
  wrapMeta: { color: palette.textMuted, fontSize: 12, fontWeight: '800', lineHeight: 17 },
  wrapNext: { color: palette.text, fontSize: 16, fontWeight: '800', lineHeight: 23 },
  readAgainRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, paddingVertical: 12, marginTop: 4 },
  readAgainOff: { opacity: 0.4 },
  readAgainText: { color: palette.blueDeep, fontSize: 15, fontWeight: '700' },
  wrapRow: { flexDirection: 'row', alignItems: 'center', gap: 8, paddingVertical: 12, marginTop: 12 },
  wrapRowText: { flex: 1, color: palette.textDim, fontSize: 14, fontWeight: '700', lineHeight: 20 },
  startCard: { width: '100%', maxWidth: 334, backgroundColor: palette.card, borderRadius: 22, paddingHorizontal: 22, paddingTop: 24, paddingBottom: 18, gap: 10 },
  startHint: { color: palette.blueDeep, fontSize: 14, fontWeight: '700', lineHeight: 21, textAlign: 'center' },
  startSkip: { color: palette.textMuted, fontSize: 13, fontWeight: '600', textAlign: 'center', paddingVertical: 4 },

  topBar: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 10, gap: 8 },
  exitBtn: { flexDirection: 'row', alignItems: 'center', gap: 3 },
  exitText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  droppedText: { color: palette.danger, fontFamily: 'Pretendard-Bold', fontSize: 12 },
  counter: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 12 },
  firstStopText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  progressTrack: { height: 4, backgroundColor: palette.bgSoft, marginHorizontal: 16, borderRadius: 2, overflow: 'hidden', marginTop: 8 },
  progressFill: { height: 4, borderRadius: 2, backgroundColor: palette.blue },
  toast: { marginHorizontal: 16, marginTop: 10, backgroundColor: palette.text, borderRadius: 14, paddingVertical: 12, paddingHorizontal: 16, alignItems: 'center' },
  proHint: { marginHorizontal: 16, marginTop: 10, paddingVertical: 8, alignItems: 'center' },
  proHintText: { fontSize: 13, fontWeight: '700', color: palette.flameDeep, textDecorationLine: 'underline' },
  toastText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 13 },
  jumpToast: { flexDirection: 'row', gap: 6, justifyContent: 'center', marginTop: 0, marginBottom: 10 },

  flow: { flex: 1 },
  flowContent: { flexGrow: 1, justifyContent: 'flex-end', paddingHorizontal: 20, paddingTop: 24, paddingBottom: 16, gap: 18 },
  // 지나간 지문은 대사보다 한 단계 진하게 — 같은 연회색이라 지문인지 알아보기 어려웠다(SOMA-937).
  direction: { color: palette.textMuted, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20 },
  beatText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 17, lineHeight: 26 },
  beatScene: { color: palette.textDim, fontFamily: 'Pretendard-Bold', fontSize: 15, lineHeight: 22 },
  pastRow: { gap: 3, paddingHorizontal: 4 },
  pastRole: { color: palette.checkOff, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  pastText: { color: palette.checkOff, fontFamily: 'Pretendard', fontSize: 15, lineHeight: 22 },
  pastRowPressed: { backgroundColor: palette.blueSoft, borderRadius: 12 },
  spoken: { gap: 2 },
  differs: { textDecorationLine: 'underline', textDecorationColor: palette.flame, color: palette.textMuted },
  spokenSaid: { color: palette.textFaint, fontFamily: 'Pretendard', fontSize: 12, lineHeight: 18 },
  spokenLabel: { fontFamily: 'Pretendard-SemiBold' },
  card: { borderRadius: 16, paddingVertical: 16, paddingHorizontal: 18, gap: 10, borderWidth: 1.5 },
  cardOther: { backgroundColor: palette.bgSoft, borderColor: palette.bgSoft },
  cardMine: { backgroundColor: palette.blueSoft, borderColor: palette.blue },
  cardHead: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', gap: 8 },
  cardRole: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 13, flexShrink: 1 },
  cardRoleMine: { color: palette.blueDeep },
  cardHeadRight: { flexDirection: 'row', alignItems: 'center', gap: 14 },
  chip: { flexDirection: 'row', alignItems: 'center', gap: 5 },
  chipText: { color: palette.textMuted, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  chipTextMine: { color: palette.blueDeep },
  saidBox: { backgroundColor: palette.bgSubtle, borderRadius: 12, padding: 12, gap: 4 },
  saidLabel: { color: palette.textFaint, fontFamily: 'Pretendard-SemiBold', fontSize: 11 },
  saidText: { color: palette.text, fontFamily: 'Pretendard', fontSize: 14, lineHeight: 20 },
  lineText: { color: palette.text, fontFamily: 'Pretendard-Bold', fontSize: 21, lineHeight: 31 },
  coachAboveControls: { paddingHorizontal: 16, paddingBottom: 8 },
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
  controlsHidden: { opacity: 0 },
  eyeBtn: { width: 54, height: 52, borderRadius: 12, backgroundColor: palette.bgSoft, alignItems: 'center', justifyContent: 'center' },
  eyeBtnOn: { backgroundColor: palette.blueSoft },
  backBtnOff: { opacity: 0.4 },
  eyeDot: { position: 'absolute', top: 9, right: 9, width: 7, height: 7, borderRadius: 4, backgroundColor: palette.blue },
  ctrl: { flex: 1, flexDirection: 'row', alignItems: 'center', justifyContent: 'center', gap: 6, borderRadius: 12, paddingVertical: 15 },
  ctrlGhost: { backgroundColor: palette.bgSoft },
  ctrlGhostText: { color: palette.textDim, fontFamily: 'Pretendard-SemiBold', fontSize: 16 },
  ctrlPrimary: { backgroundColor: palette.blue },
  ctrlOff: { backgroundColor: palette.checkOff },
  ctrlPrimaryText: { color: '#fff', fontFamily: 'Pretendard-Bold', fontSize: 16 },
  pill: { backgroundColor: palette.blue, borderRadius: 999, paddingHorizontal: 18, paddingVertical: 11 },
  pillText: { color: '#fff', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },

  backdrop: { position: 'absolute', left: 0, right: 0, bottom: 0, backgroundColor: 'rgba(15, 21, 37, 0.45)', alignItems: 'center', justifyContent: 'center', padding: 28 },
});
