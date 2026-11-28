import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { AppState, Linking, PanResponder, Platform, Pressable, ScrollView, StyleSheet, Text, View, useWindowDimensions, type TextStyle } from 'react-native';
import { StatusBar } from 'expo-status-bar';
import Animated, { useAnimatedStyle, useSharedValue, withTiming } from 'react-native-reanimated';
import { useSafeAreaInsets } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { RecordAlbumButton } from '@/components/record-album-button';
import { RecordModeSlider } from '@/components/record-mode-slider';
import { easing, motion } from '@/constants/motion';
import { palette } from '@/constants/palette';
import { radius, space, type } from '@/constants/tokens';
import { keepDeviceFile } from '@/lib/account-files';
import { formatClipDuration } from '@/lib/archive-format';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { CHALLENGE_FUNNEL_EVENTS, permissionResultParams, videoSourceParams } from '@/lib/challenge/funnel';
import { translate as t } from '@/lib/i18n';
import { setRecordScript, takeRecordScript, type RecordScriptLine } from '@/lib/practice/record-script';
import { clampPrompt, directionText, loadPromptSize, nextPromptSize, promptView, savePromptSize, type PromptSize } from '@/lib/practice/scene-prompt';
import { recordSceneTake } from '@/lib/practice/scene-takes';
import { RECORD_MODES, SCENE_RECORD_MODES, recordModeAfterSwipe, type RecordMode } from '@/lib/record-modes';
import { saveRecordingToLibrary } from '@/lib/library/library-runner';
import { RECORD_VIDEO_BPS, RECORD_VIDEO_QUALITY, VIDEO_MAX_MS, videoRejectDialog } from '@/lib/library/video-checks';
import { normalizeVideoDurationMs } from '@/lib/upload-input';
import { peekRecordedVideo, setRecordedVideo, takeRecordedVideo } from '@/lib/recorded-video';
import { setPickedVideo } from '@/lib/practice/picked-video';
import { VIDEO_PICKER_OPTIONS } from '@/lib/video-picker-options';
import { getAppConfig } from '@/lib/app-config';

const MAX_SEC = Math.floor(VIDEO_MAX_MS / 1000);
/** onCameraReady 가 안 오는 기기에서 셔터를 열어 주는 시간. */
const CAMERA_READY_FALLBACK_MS = 1500;
/** 멈춤을 누른 뒤 녹화가 끝나기를 기다리는 시간. 넘으면 화면을 풀어 준다. */
const STOP_WATCH_MS = 4000;

/**
 * 앱 내 영상 촬영 (SOMA-477).
 *
 * 갤러리에서 고르는 것 말고, 연기 영상을 앱에서 바로 찍는다. 5분이 되면 자동으로
 * 멈추고(서버·업로드 상한과 같은 값), 결과를 recorded-video 핸드오프에 얹어
 * 업로드 화면으로 돌아간다.
 *
 * mode=challenge 면 대사 카드를 위에 띄우고 60초 상한이다. 찍고 나면 챌린지 올리기로.
 *
 * 버튼 자리는 모든 촬영이 같다(pen record-video.*): 위 닫기·시간 알약·대사 가리기, 아래 앨범·셔터·카메라 전환.
 * 녹화 중엔 앨범·전환이 자리를 둔 채 숨고, 셔터는 멈춤 네모, 시간 알약은 빨강이다.
 *
 * 촬영이 끝나면(A2.1, practice.record) 기기에 먼저 저장하고 업로드 대기 큐에 넣는다 — 서버 확정 전에는 "기기에 저장 ·
 * 업로드 대기", 확정 뒤에는 "보관함 저장"이다. 어디로 보낼지 정하지 않아도 보관함에 남는다.
 *
 * 시뮬레이터엔 카메라가 없어 실기기에서만 실제로 돈다.
 */
/** 촬영 화면이 지금 하는 일. 녹화와 오늘의 대사 불러오기는 겹치지 않는다. */
type Phase = 'idle' | 'loadingToday' | 'recording';

/** 남은 시간 한 줄 — 「5분 남았어요」·「4분 48초 남았어요」·「48초 남았어요」. */
function remainingLabel(sec: number): string {
  if (sec < 60) return t('record.remaining', { sec });
  const min = Math.floor(sec / 60);
  return sec % 60 === 0 ? t('record.remainingWholeMin', { min }) : t('record.remainingMin', { min, sec: sec % 60 });
}

export default function RecordVideoScreen() {
  const { height: windowHeight } = useWindowDimensions();
  // SafeAreaView 대신 루트 값을 쓴다 — 전체 화면 모달 안의 SafeAreaView 는 올라오는 중 받은 0을 고치지 않아 iOS 에서 버튼이 상태 표시줄 밑에 깔렸다.
  const insets = useSafeAreaInsets();
  const safePad = { paddingTop: insets.top, paddingBottom: insets.bottom };
  const router = useRouter();
  // mode=ai: 하단 탭 촬영 버튼에서 "AI 코칭"을 고르고 옴 → 찍으면 업로드 화면으로. 업로드 화면의 촬영 버튼에서
  //   왔으면(picker 없음) 보관함에 저장하고 그 업로드 화면으로 되돌아간다.
  // mode=plain: "기본 촬영" → 찍으면 보관함에 저장하고 그 영상 화면으로.
  // mode=challenge: 대사 띄운 챌린지 촬영.
  // picker=1: 하단 탭 가운데 버튼에서 곧장 옴 — 셔터 아래 줄을 넘겨 용도를 고른다(SOMA-494).
  const params = useLocalSearchParams<{
    mode?: string;
    line?: string;
    work?: string;
    challengeId?: string;
    picker?: string;
    next?: string;
    maxSec?: string;
    /** mode=scene 으로 들어온 길(scene_record_start 계측) — step·card·row·retake. */
    from?: string;
  }>();
  const picker = params.picker === '1';
  // next=upload: 코칭 탭 「지금 찍어서 코칭 받기」 → 찍는 법 → 여기. 준비 화면이 뒤에 없으니 찍은 뒤 새로 연다.
  const toUpload = params.next === 'upload';
  const [mode, setMode] = useState<string | undefined>(params.mode);
  // 오늘의 대사로 넘기면 여기에 그 챌린지를 채운다 — 챌린지 화면에서 오면 처음부터 들어 있다.
  const [challengeParams, setChallengeParams] = useState({
    challengeId: params.challengeId,
    line: params.line,
    work: params.work,
  });
  const { challengeId, line, work } = challengeParams;
  const isChallenge = mode === 'challenge';
  // maxSec 파라미터(올리기 망설임 「길게 찍기 부담돼요」의 10초)는 기본 길이보다 짧을 때만 따른다.
  const limitParam = Number(params.maxSec);
  // 챌린지(오늘의 대사) 촬영 상한은 참여 영상 상한과 같다 — 기본 60초(pen A18), 서버 설정(SOMA-939).
  const baseMaxSec = isChallenge ? getAppConfig().challenge.entryMaxSeconds : MAX_SEC;
  const maxSec = Number.isFinite(limitParam) && limitParam > 0 ? Math.min(limitParam, baseMaxSec) : baseMaxSec;
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCam, readCam] = useCameraPermissions();
  const [micPerm, requestMic, readMic] = useMicrophonePermissions();
  // 챌린지는 혼자 자기 얼굴을 찍는 경우가 대부분이라 전면 카메라로 시작한다(11/2 폰 QA). 코칭 촬영은 그대로 후면.
  const [facing, setFacing] = useState<'front' | 'back'>(isChallenge ? 'front' : 'back');
  const [phase, setPhase] = useState<Phase>('idle');
  const recording = phase === 'recording';
  const [elapsed, setElapsed] = useState(0);
  // iOS 는 카메라 세션이 준비되기 전(onCameraReady 전)에 녹화를 부르면 녹화가 시작되지도 끝나지도 않아 화면이 멈춘 듯 보이고,
  // 녹화 중엔 닫기 대신 시간이 떠서 나갈 수도 없었다(10/23 iOS 제보). 준비 신호를 받은 뒤에만 셔터를 받는다.
  // 일부 기기에서 신호가 안 오면 영영 못 찍으니 1.5초 뒤에는 준비된 것으로 본다.
  const [cameraReady, setCameraReady] = useState(false);
  const stopWatchRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const [lineHidden, setLineHidden] = useState(false);
  // 코칭 촬영에 대본을 띄운다(「내 대본으로 찍기」·대본 만들기 「지금 찍을래요」). 처음 그릴 때 꺼내며 비운다.
  const [recordScript] = useState(() => (isChallenge ? null : takeRecordScript()));
  const [scriptHidden, setScriptHidden] = useState(false);
  // 연습 탭 「촬영하기」 — 대본(id 포함)을 들고 왔을 때만 장면 촬영이다. 셔터 아래 줄에 「장면 촬영」이 먼저 보이고 처음 고른 값이다.
  const sceneScript = recordScript?.scriptId ? recordScript : null;
  const modeLine = sceneScript ? SCENE_RECORD_MODES : RECORD_MODES;
  const showModeLine = picker || !!sceneScript;
  useEffect(() => {
    if (mode === 'scene' && !sceneScript) setMode('plain');
  }, [mode, sceneScript]);
  // 대본 보기 — 기본은 한 줄씩(프롬프터), 「대본 전체」를 누르면 예전 전체 카드. 글자 크기는 기기에 기억한다.
  const [promptAt, setPromptAt] = useState(0);
  const [fullScript, setFullScript] = useState(false);
  const [promptSize, setPromptSize] = useState<PromptSize>('normal');
  useEffect(() => {
    let live = true;
    void loadPromptSize().then((size) => {
      if (live) setPromptSize(size);
    });
    return () => {
      live = false;
    };
  }, []);
  const prompt = useMemo(() => (recordScript ? promptView(recordScript.lines, promptAt) : null), [promptAt, recordScript]);
  // 줄이 바뀔 때 아래에서 짧게 밀려 올라온다. 「동작 줄이기」면 reanimated 가 바로 끝 상태로 둔다(constants/motion).
  const promptShift = useSharedValue(0);
  const promptAnim = useAnimatedStyle(() => ({ opacity: 1 - Math.abs(promptShift.value) / 24, transform: [{ translateY: promptShift.value }] }));
  const movePrompt = useCallback(
    (delta: 1 | -1, how: 'tap' | 'button') => {
      if (!prompt || prompt.total === 0) return;
      const next = clampPrompt(prompt.no - 1 + delta, prompt.total);
      if (next === prompt.no - 1) return;
      if (delta > 0) logEvent('scene_prompt_next', { how });
      setPromptAt(next);
      promptShift.value = delta > 0 ? 12 : -12;
      promptShift.value = withTiming(0, { duration: motion.fast, easing: easing.enter });
    },
    [prompt, promptShift],
  );
  const changePromptSize = () => {
    const next = nextPromptSize(promptSize);
    setPromptSize(next);
    void savePromptSize(next);
  };
  // 종료 처리가 겹쳐 두 번 도는 것을 막는다(자동 정지 + 사용자 정지).
  const finishedRef = useRef(false);
  // 이 화면을 곧바로 떠나는 중이다. 안드로이드에서 사라지는 화면의 뷰를 다시 그리면 앱이 꺼지므로
  // (화면 전환 중 뷰를 옮겨 붙이다 실패 — react-native-screens #4677) 떠난 뒤에는 상태를 바꾸지 않는다.
  const leavingRef = useRef(false);
  // 셔터를 누른 시각. 끝날 때의 콜백이 녹화 시작 때 잡혀 elapsed state 로는 길이를 알 수 없다.
  const startedAtRef = useRef(0);
  const { alert, dialog } = useAppDialog();
  const { user } = useAuth();
  // 권한 요청은 화면에 들어오자마자 한 번만 — OS 팝업이 곧바로 뜬다.
  const askedRef = useRef(false);
  // 챌린지 촬영에 들어올 때 이미 권한이 있었는지 한 번만 남긴다(SOMA-616).
  const permLoggedRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => {
      if (!leavingRef.current) setElapsed((s) => s + 1);
    }, 1000);
    return () => clearInterval(id);
  }, [recording]);

  useEffect(() => {
    if (cameraReady) return;
    const timer = setTimeout(() => setCameraReady(true), CAMERA_READY_FALLBACK_MS);
    return () => clearTimeout(timer);
  }, [cameraReady]);

  useEffect(
    () => () => {
      if (stopWatchRef.current) clearTimeout(stopWatchRef.current);
    },
    [],
  );

  const ready = !!(camPerm?.granted && micPerm?.granted);

  // 들어오자마자 OS 권한 팝업(카메라 → 마이크)을 한 번 띄운다. 거절했거나 전에 거절해 팝업이 다시
  // 안 뜨면 화면 안의 버튼으로 다시 묻거나 설정으로 보낸다 — iOS 전체화면 모달 위에서는 우리 안내
  // 팝업이 안 떠서 검은 화면에 갇힌 적이 있다.
  // OS 팝업이 떠 있는 동안은 안내 띠를 숨기고 돌아가는 표시만 둔다(pen P2.1·P2.2).
  // 「팝업이 떠 있다」는 앱이 잠깐 비활성(iOS inactive · 안드로이드 background)이 되는 것으로 안다. 요청 약속(promise)만
  // 믿으면 안 된다 — 안드로이드에서 「다시 묻지 않음」 뒤 요청이 끝나지 않아 돌아가는 표시에 갇혔다(10/24 폰 확인).
  const [asking, setAsking] = useState(false);
  const [appActive, setAppActive] = useState(AppState.currentState !== 'background' && AppState.currentState !== 'inactive');
  useEffect(() => {
    const sub = AppState.addEventListener('change', (state) => setAppActive(state !== 'background' && state !== 'inactive'));
    return () => sub.remove();
  }, []);
  // 요청을 보낸 뒤 1초 안에 팝업이 안 뜨면(이미 거절 고정 등) 기다리지 않고 띠를 보인다.
  useEffect(() => {
    if (!asking) return;
    const timer = setTimeout(() => setAsking(false), 1000);
    return () => clearTimeout(timer);
  }, [asking]);
  const askPermissions = useCallback(async () => {
    setAsking(true);
    try {
      const cam = camPerm?.granted ? camPerm : await requestCam();
      const mic = micPerm?.granted ? micPerm : await requestMic();
      if (isChallenge) {
        permLoggedRef.current = true;
        logEvent(CHALLENGE_FUNNEL_EVENTS.permissionResult, permissionResultParams(cam, mic, true));
      }
      return cam.granted && mic.granted;
    } finally {
      setAsking(false);
    }
  }, [camPerm, isChallenge, micPerm, requestCam, requestMic]);

  // 권한이 이미 있어 팝업 없이 들어온 챌린지 촬영도 같은 단계로 센다.
  useEffect(() => {
    if (!isChallenge || !ready || permLoggedRef.current) return;
    permLoggedRef.current = true;
    logEvent(CHALLENGE_FUNNEL_EVENTS.permissionResult, permissionResultParams(camPerm, micPerm, false));
  }, [camPerm, isChallenge, micPerm, ready]);

  useEffect(() => {
    if (ready || askedRef.current || !camPerm || !micPerm) return;
    askedRef.current = true;
    void askPermissions();
  }, [ready, camPerm, micPerm, askPermissions]);

  // 다시 물어도 팝업이 안 뜨는 상태(거절 후 "다시 묻지 않음")면 설정으로 보낸다.
  const blocked = (!!camPerm && !camPerm.granted && !camPerm.canAskAgain) || (!!micPerm && !micPerm.granted && !micPerm.canAskAgain);

  // 설정에서 카메라·마이크를 켜고 돌아오면 바로 반영한다 — 훅은 스스로 다시 읽지 않는다(SOMA-817).
  // 다시 「묻지」 않고 「읽기」만 한다. 예전엔 돌아올 때마다 요청을 보내, 안드로이드에서 거절 팝업이 닫히자마자(앱이 다시
  // active) 같은 팝업이 또 떴다 — 거절 → 또 물음 → 거절이 이어졌다(10/24 폰 확인, 이전 빌드도 같음).
  useEffect(() => {
    if (!blocked) return;
    const sub = AppState.addEventListener('change', (state) => {
      if (state !== 'active') return;
      void readCam();
      void readMic();
    });
    return () => sub.remove();
  }, [blocked, readCam, readMic]);

  /** 촬영·선택한 영상을 보관함(기기 저장 + 업로드 대기)에 넣는다. 너무 길면 안내하고 넣지 않는다. */
  const saveToLibrary = useCallback(async (): Promise<{ id: string; uri: string } | null> => {
    const video = peekRecordedVideo();
    if (!video || !user?.id) return null;
    const outcome = await saveRecordingToLibrary({ uri: video.uri, durationMs: video.durationMs, owner: user.id });
    if (outcome.kind === 'rejected') {
      await alert(videoRejectDialog(outcome.code));
      return null;
    }
    return { id: outcome.entry.id, uri: outcome.entry.uri };
  }, [alert, user?.id]);

  /**
   * 용도를 바꾼다. 오늘의 대사는 그날 선정된 챌린지를 불러와 대사 카드를 띄운다 — 없으면 안내만 하고
   * 지금 용도에 머문다(챌린지 탭에서 대사를 고르면 된다).
   */
  const changeMode = useCallback(
    async (next: RecordMode) => {
      if (phase !== 'idle' || next === mode) return;
      if (next !== 'challenge' || challengeId) {
        setMode(next);
        return;
      }
      setPhase('loadingToday');
      try {
        const { featured } = await api.listChallenges({ tab: 'popular' });
        if (!featured) {
          void alert({ title: t('recordMode.noTodayTitle'), message: t('recordMode.noToday') });
          return;
        }
        setChallengeParams({ challengeId: featured.id, line: featured.line, work: featured.work });
        setMode('challenge');
      } catch {
        void alert({ title: t('recordMode.noTodayTitle'), message: t('recordMode.noToday') });
      } finally {
        setPhase('idle');
      }
    },
    [alert, challengeId, mode, phase],
  );

  // 화면을 옆으로 넘겨도 용도가 바뀐다(인스타처럼). 가로로 충분히 움직였을 때만 가로챈다 — 버튼 누르기는 그대로다.
  // 대본을 한 줄씩 보는 중이면 미리보기 아무 데나 누르면 다음 내 대사다(녹화 중에도).
  const promptTapping = !!prompt && prompt.total > 0 && !scriptHidden && !fullScript;
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => showModeLine || promptTapping,
        onMoveShouldSetPanResponder: (_, g) => showModeLine && Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 10 && Math.abs(g.dy) < 10) {
            if (promptTapping) movePrompt(1, 'tap');
            return;
          }
          if (!showModeLine || Math.abs(g.dx) < 40 || recording) return;
          const current = (mode ?? 'ai') as RecordMode;
          void changeMode(recordModeAfterSwipe(modeLine, current, g.dx < 0 ? 'left' : 'right'));
        },
      }),
    [changeMode, mode, modeLine, movePrompt, promptTapping, recording, showModeLine],
  );
  const goNext = useCallback(() => {
    if (isChallenge) {
      leavingRef.current = true;
      // 대사가 정해지지 않았으면 올릴 대사를 먼저 고른다(C9.16).
      if (!challengeId) {
        router.replace('/line-pick');
        return;
      }
      router.replace({
        pathname: '/challenge-upload',
        params: { challengeId: challengeId ?? '', line: line ?? '', work: work ?? '' },
      });
      return;
    }
    if (mode === 'ai') {
      // 보관함에 저장하고(업로드 대기) 그 항목을 새 연습 준비 화면으로 넘긴다 — 여기서 올리지 않는다.
      void saveToLibrary().then((pending) => {
        const video = takeRecordedVideo();
        if (pending) {
          setPickedVideo({
            videoId: null,
            pendingId: pending.id,
            uri: pending.uri,
            playbackUrl: null,
            durationMs: video?.durationMs ?? null,
            source: 'record',
          });
        }
        // 하단 탭에서 곧장 왔으면 새 준비 화면을 연다. 준비 화면의 촬영 버튼에서 왔으면 그 화면으로 돌아간다 —
        // 새 준비 화면을 또 열면 다음 테이크(이어하기)가 새 연습으로 바뀐다(SOMA-672).
        if (picker) router.replace('/upload');
        else if (toUpload) router.replace('/upload');
        else router.back();
      });
      return;
    }
    if (mode === 'scene' && sceneScript?.scriptId) {
      // 장면 촬영 — 보관함에 넣고(어느 버튼을 고르든 남는다) 그 대본에 「찍었어요」를 남긴 뒤 작은 결과 화면으로.
      // 결과 화면의 「다시 찍기」가 같은 대본으로 카메라를 다시 열 수 있게 대본을 한 번 더 얹는다.
      const scriptId = sceneScript.scriptId;
      void saveToLibrary().then((pending) => {
        const video = takeRecordedVideo();
        leavingRef.current = true;
        if (!pending) {
          router.back();
          return;
        }
        const durationMs = video?.durationMs ?? null;
        logEvent('scene_record_done', { seconds: Math.round((durationMs ?? 0) / 1000) });
        void recordSceneTake(user?.id, scriptId, { pendingId: pending.id, uri: pending.uri, durationMs });
        setRecordScript(sceneScript);
        router.replace({
          pathname: '/scene-take',
          params: { pendingId: pending.id, uri: pending.uri, durationMs: String(durationMs ?? '') },
        });
      });
      return;
    }
    if (mode === 'plain') {
      // 기본 촬영 — 기기에 저장하고 업로드 대기 큐에 넣은 뒤 이전 화면으로(영상 상세 화면은 SOMA-820에서 없앴다).
      void saveToLibrary().then(() => {
        takeRecordedVideo();
        router.back();
      });
      return;
    }
    leavingRef.current = true;
    router.back();
  }, [challengeId, isChallenge, line, mode, picker, router, saveToLibrary, sceneScript, toUpload, user?.id, work]);

  // 닫기는 녹화 중·멈춘 뒤에도 받는다 — 예전엔 녹화 중 막혀 있어, iOS 에서 멈춤 뒤 녹화가 늦게 끝나면 위쪽 닫기가 안 눌렸다(10/25 QA).
  // 찍던 것은 버린다. 먼저 끝남·떠남 표시를 해서 녹화가 끝나도 저장·이동하지 않게 한다.
  const close = useCallback(() => {
    finishedRef.current = true;
    leavingRef.current = true;
    if (recording) cameraRef.current?.stopRecording();
    router.back();
  }, [recording, router]);

  const finishWith = useCallback(
    (uri: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (uri) {
        // 찍은 영상은 캐시에 남는다. 올리지 않고 나가도 탈퇴 때 지울 수 있게 장부에 적는다.
        void keepDeviceFile(uri);
        setRecordedVideo({
          uri,
          // 카메라가 켜지는 지연만큼 길게 재므로 네이티브가 멈추는 상한을 넘기지 않는다.
          durationMs: Math.min(Date.now() - startedAtRef.current, maxSec * 1000),
          name: `recording-${Date.now()}.mov`,
        });
        goNext();
        return;
      }
      leavingRef.current = true;
      router.back();
    },
    [goNext, maxSec, router],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || phase !== 'idle' || !cameraReady) return;
    setPhase('recording');
    setElapsed(0);
    startedAtRef.current = Date.now();
    if (mode === 'scene') logEvent('scene_record_start', { from: params.from ?? 'unknown' });
    try {
      // maxDuration 으로 상한에서 네이티브가 스스로 멈춘다 — resolve 되면 결과를 넘긴다.
      // iOS 는 코덱을 정해야 videoBitrate 가 먹는다(H.264).
      const result = await cameraRef.current.recordAsync(
        Platform.OS === 'ios' ? { maxDuration: maxSec, codec: 'avc1' } : { maxDuration: maxSec },
      );
      // 닫기로 버린 녹화는 고른 것도 실패도 아니다.
      if (isChallenge && !leavingRef.current) {
        logEvent(CHALLENGE_FUNNEL_EVENTS.videoSource, videoSourceParams('camera', result?.uri ? 'selected' : 'failed'));
      }
      finishWith(result?.uri ?? null);
    } catch {
      // 촬영이 실패하면 화면만 되돌린다(업로드에서 다시 시도).
      if (isChallenge && !leavingRef.current) logEvent(CHALLENGE_FUNNEL_EVENTS.videoSource, videoSourceParams('camera', 'failed'));
      finishWith(null);
    } finally {
      // 곧바로 다른 화면으로 넘어갔으면 녹화 표시를 되돌리지 않는다 — 같은 순간에 바꾸면 안드로이드에서 꺼진다.
      if (!leavingRef.current) setPhase('idle');
    }
  }, [phase, cameraReady, finishWith, isChallenge, maxSec, mode, params.from]);

  const stopRecording = useCallback(() => {
    if (!cameraRef.current || !recording) return;
    cameraRef.current.stopRecording(); // recordAsync 의 promise 를 resolve 시킨다
    // 멈춤을 눌렀는데 녹화가 끝나지 않으면(iOS 에서 녹화가 실제로 시작되지 않았던 경우) 화면을 풀어 다시 찍거나 닫게 한다.
    if (stopWatchRef.current) clearTimeout(stopWatchRef.current);
    stopWatchRef.current = setTimeout(() => {
      stopWatchRef.current = null;
      if (finishedRef.current || leavingRef.current) return;
      setPhase('idle');
      setElapsed(0);
      void alert({ title: t('record.stuckTitle'), message: t('record.stuckBody') });
    }, STOP_WATCH_MS);
  }, [recording, alert]);

  // 상한이 지나도 네이티브가 멈추지 않으면(녹화가 실제로 시작되지 않은 경우) 멈춤을 대신 누른다.
  useEffect(() => {
    if (recording && elapsed > maxSec + 2 && !stopWatchRef.current) stopRecording();
  }, [recording, elapsed, maxSec, stopRecording]);

  // 챌린지 모드 "업로드" — 찍는 대신 갤러리에서 골라 그대로 올리기로 간다.
  const pickFromGallery = useCallback(async () => {
    if (recording) return;
    const result = await ImagePicker.launchImageLibraryAsync(VIDEO_PICKER_OPTIONS);
    const picked = !result.canceled && !!result.assets[0];
    if (isChallenge) logEvent(CHALLENGE_FUNNEL_EVENTS.videoSource, videoSourceParams('gallery', picked ? 'selected' : 'cancelled'));
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (finishedRef.current) return;
    finishedRef.current = true;
    void keepDeviceFile(asset.uri);
    setRecordedVideo({
      uri: asset.uri,
      // 픽커의 duration 은 플랫폼마다 초/밀리초가 섞여 온다 — 업로드 화면과 같은 정규화를 쓴다.
      durationMs: normalizeVideoDurationMs(asset.duration ?? null),
      name: asset.fileName ?? `video-${Date.now()}.mp4`,
      source: 'gallery',
    });
    goNext();
  }, [goNext, isChallenge, recording]);


  const flip = () => setFacing((f) => (f === 'back' ? 'front' : 'back'));

  // 권한이 아직 없으면 촬영 화면 그대로(검은 바탕) 두고 화면 안에서 묻는다 — 닫기는 늘 보인다.
  // OS 팝업이 떠 있는 동안은 띠를 숨기고, 거절됐으면 아래 띠에서 다시 묻거나(허용하기) 설정을 연다(다시 물을 수 없을 때).
  if (!ready) {
    const known = !!camPerm && !!micPerm;
    const showNotice = known && appActive && !asking;
    return (
      <View style={styles.root}>
        <StatusBar style="light" />
        <View style={[styles.overlay, safePad]}>
          <View style={styles.topBar}>
            <CloseButton phLabel="record_perm_close" onPress={() => router.back()} />
          </View>
          {showNotice && (
            <View style={styles.permNotice}>
              <Feather name="camera-off" size={20} color={palette.amber} />
              <View style={styles.permNoticeBody}>
                <Text style={styles.permNoticeTitle}>{t('record.permissionTitle')}</Text>
                <Text style={styles.permNoticeText}>{blocked ? t('record.deniedBody') : t('record.permissionBody')}</Text>
              </View>
              <Pressable
                onPress={() => (blocked ? void Linking.openSettings() : void askPermissions())}
                accessibilityRole="button"
                hitSlop={10}
                ph-label="record_perm_action">
                <Text style={styles.permNoticeAction}>{t(blocked ? 'record.deniedOpen' : 'record.permissionAllow')}</Text>
              </Pressable>
            </View>
          )}
        </View>
        {dialog}
      </View>
    );
  }

  const remaining = Math.max(0, maxSec - elapsed);
  // 위에 띄우는 글: 챌린지 대사 카드 또는 코칭 촬영 대본 카드. 있으면 시간 알약과 가리기 버튼이 함께 보인다.
  // 리딩 녹음 코칭 끝에서 오면(next=upload + line, SOMA-791) 챌린지가 아니어도 찍을 한 줄을 띄운다.
  const coachLine = !isChallenge && !picker && toUpload && !!line;
  const cover = isChallenge ? (line ? 'line' : null) : coachLine ? 'line' : recordScript ? 'script' : null;
  const coverHidden = cover === 'line' ? lineHidden : scriptHidden;
  const toggleCover = () => (cover === 'line' ? setLineHidden((v) => !v) : setScriptHidden((v) => !v));
  const showPill = recording || isChallenge || !!recordScript || coachLine;
  const hintText = recording
    ? remainingLabel(remaining)
    : isChallenge
      ? t('record.challengeHint')
      : promptTapping
        ? t('record.promptTapHint')
        : picker
        ? t('recordMode.swipeHint')
        : maxSec < baseMaxSec
          ? t('record.hintShort', { sec: maxSec })
          : t('record.hint');
  // 「오늘의 대사 불러오는 중」은 안내 자리에 둔다 — 셔터가 움직이지 않는다.
  const hint =
    phase === 'loadingToday' ? (
      <Text style={styles.hint}>{t('recordMode.loadingToday')}</Text>
    ) : (
      <Text style={styles.hint}>{hintText}</Text>
    );

  return (
    <View style={styles.root}>
      {/* 검은 카메라 화면 — 상태 표시줄 글자를 흰색으로(앱 기본은 검은 글자라 시간·배터리가 안 보였다). */}
      <StatusBar style="light" />
      <CameraView
        ref={cameraRef}
        style={styles.camera}
        facing={facing}
        mode="video"
        // 720p·2Mbps — 줄이기가 실패해도 원본이 100MiB 안이라 그대로 올라간다(SOMA-737 후속).
        videoQuality={RECORD_VIDEO_QUALITY}
        videoBitrate={RECORD_VIDEO_BPS}
        onCameraReady={() => setCameraReady(true)}
      />
      {/* 넘기기는 여기서 받는다 — 위 겹침은 box-none 이라 빈 곳 터치를 자기가 받지 않는다. */}
      <View style={StyleSheet.absoluteFill} {...swipe.panHandlers} />

      <View style={[styles.overlay, safePad]} pointerEvents="box-none">
        <View style={styles.topGroup} pointerEvents="box-none">
          <View style={styles.topBar}>
            <CloseButton phLabel="record_close" onPress={close} />
            {showPill && (
              <View style={[styles.timerPill, recording && styles.timerPillRec]}>
                <View style={[styles.recDot, recording && styles.recDotRec]} />
                <Text style={styles.timerText}>
                  {formatClipDuration(elapsed)} / {formatClipDuration(maxSec)}
                </Text>
              </View>
            )}
            {cover ? (
              <Pressable
                style={styles.roundBtn}
                onPress={toggleCover}
                accessibilityRole="button"
                accessibilityLabel={t(coverHidden ? 'record.showLine' : 'record.hideLine')}
                ph-label={cover === 'script' ? 'record_toggle_script' : 'record_toggle_line'}>
                <Feather name={coverHidden ? 'eye-off' : 'eye'} size={22} color={palette.onAccent} />
              </Pressable>
            ) : (
              <View style={styles.closeBtn} />
            )}
          </View>
          {cover === 'line' && !lineHidden && (
            <View style={styles.card}>
              <View style={styles.cardLabelRow}>
                <Feather name="message-square" size={12} color={palette.blueSoft} />
                <Text style={styles.cardLabel}>
                  {t('record.lineLabel')}
                  {work ? ` · 《${work}》` : ''}
                </Text>
              </View>
              <Text style={styles.lineText}>{line}</Text>
            </View>
          )}
          {cover === 'script' && recordScript && !scriptHidden && !fullScript && prompt && prompt.current && (
            // 대본 보기(프롬프터) — 앞 줄(작게·흐리게) → 지금 내 대사(크게·굵게) → 다음 줄. 렌즈 가까이 위쪽에 둔다.
            <View style={styles.card} testID="record-prompter">
              <Text style={styles.cardLabel} numberOfLines={1}>
                {prompt.current.mine && prompt.current.speaker
                  ? t('record.promptLabel', { role: prompt.current.speaker, no: prompt.no, total: prompt.total })
                  : t('record.promptLabelAll', { no: prompt.no, total: prompt.total })}
              </Text>
              <Animated.View style={[styles.promptBody, promptAnim]}>
                {prompt.prev && <PromptSideLine line={prompt.prev} />}
                <Text style={[styles.promptNow, PROMPT_NOW_SIZE[promptSize]]}>{prompt.current.text}</Text>
                {prompt.next && <PromptSideLine line={prompt.next} />}
              </Animated.View>
            </View>
          )}
          {cover === 'script' && recordScript && !scriptHidden && (fullScript || !prompt?.current) && (
            <View style={styles.card} testID="record-script-full">
              <Text style={styles.cardLabel} numberOfLines={1}>{t('record.scriptLabel', { title: recordScript.title })}</Text>
              {/* 대본 카드는 화면 4분의 1 안쪽 — 대사가 많으면 안에서 넘긴다(작은 폰에서 얼굴 위치를 가리지 않게). */}
              <ScrollView style={{ maxHeight: Math.round(windowHeight * 0.24) }} contentContainerStyle={styles.scriptBody}>
                {recordScript.lines.map((l, i) =>
                  l.kind === 'dialogue' ? (
                    <Text key={i} style={[styles.scriptLine, l.mine && styles.scriptLineMine]}>
                      {l.speaker ? <Text style={[styles.scriptSpeaker, l.mine && styles.scriptSpeakerMine]}>{`${l.speaker}  `}</Text> : null}
                      {l.text}
                    </Text>
                  ) : (
                    <Text key={i} style={styles.scriptDirection}>{l.kind === 'scene' || l.text.trim().startsWith('(') ? l.text : `(${l.text})`}</Text>
                  ),
                )}
              </ScrollView>
            </View>
          )}
          {cover === 'script' && recordScript && !scriptHidden && !!prompt?.current && (
            <View style={styles.promptBar} pointerEvents="box-none">
              {!fullScript && (
                <>
                  <PromptButton label={t('record.promptPrev')} phLabel="record_prompt_prev" disabled={prompt.no <= 1} onPress={() => movePrompt(-1, 'button')} />
                  <PromptButton label={t('record.promptNext')} phLabel="record_prompt_next" disabled={prompt.no >= prompt.total} onPress={() => movePrompt(1, 'button')} />
                </>
              )}
              <PromptButton
                label={t(fullScript ? 'record.promptOne' : 'record.promptAll')}
                phLabel="record_prompt_full"
                onPress={() => setFullScript((v) => !v)}
              />
              {!fullScript && (
                <PromptButton
                  label={t('record.promptSize')}
                  a11yLabel={t('record.promptSizeA11y', { size: t(`record.promptSize_${promptSize}`) })}
                  phLabel="record_prompt_size"
                  onPress={changePromptSize}
                />
              )}
            </View>
          )}
        </View>

        <View style={styles.bottomGroup}>
          {!isChallenge && hint}
          <View style={styles.controls}>
            {/* 녹화 중엔 앨범·전환을 자리를 둔 채 숨긴다 — 셔터가 늘 가운데에 머문다. */}
            <RecordAlbumButton hidden={recording} onPress={() => void pickFromGallery()} />
            <Pressable
              accessibilityRole="button"
              accessibilityLabel={recording ? t('record.stop') : t('record.start')}
              ph-label="record_shutter"
              onPress={() => (recording ? stopRecording() : void startRecording())}
              style={styles.shutter}>
              <View style={recording ? styles.shutterStop : styles.shutterIn} />
            </Pressable>
            <Pressable
              style={[styles.roundBtn, recording && styles.hiddenKeepSpace]}
              disabled={recording}
              accessibilityRole="button"
              accessibilityLabel={t('record.flip')}
              accessibilityElementsHidden={recording}
              importantForAccessibility={recording ? 'no-hide-descendants' : 'auto'}
              ph-label="record_flip"
              onPress={flip}>
              <Feather name="refresh-cw" size={22} color={palette.onAccent} />
            </Pressable>
          </View>
          {isChallenge && hint}
          {/* 녹화 중에도 용도 줄 자리를 비워 두지 않는다 — 치우면 아래 정렬이라 셔터가 그만큼 내려간다(SOMA-737). */}
          {showModeLine && (
            <View style={recording ? styles.hiddenKeepSpace : undefined} pointerEvents={recording ? 'none' : 'auto'} collapsable={false}>
              <RecordModeSlider
                modes={modeLine}
                value={(mode ?? 'ai') as RecordMode}
                onChange={(next) => void changeMode(next)}
                disabled={phase === 'loadingToday'}
              />
            </View>
          )}
        </View>
      </View>
      {dialog}
    </View>
  );
}

/** 프롬프터의 앞·다음 줄 — 작게·흐리게. 대사는 화자 이름(파랑)을 앞에, 지문은 괄호에 넣는다. */
function PromptSideLine({ line }: { line: RecordScriptLine }) {
  if (line.kind !== 'dialogue') return <Text style={styles.promptSide} numberOfLines={2}>{directionText(line.text)}</Text>;
  return (
    <Text style={styles.promptSide} numberOfLines={2}>
      {line.speaker ? <Text style={styles.promptSpeaker}>{`${line.speaker}  `}</Text> : null}
      {line.text}
    </Text>
  );
}

/** 대본 카드 아래 글자 버튼(‹ 이전 · 다음 › · 대본 전체 · 글자 크기) — 카메라 위라 시간 알약과 같은 반투명 알약에 얹는다. */
function PromptButton({ label, a11yLabel, phLabel, disabled, onPress }: { label: string; a11yLabel?: string; phLabel: string; disabled?: boolean; onPress: () => void }) {
  return (
    <Pressable
      style={[styles.promptBtn, disabled && styles.promptBtnOff]}
      onPress={onPress}
      disabled={disabled}
      hitSlop={6}
      accessibilityRole="button"
      accessibilityLabel={a11yLabel ?? label}
      accessibilityState={{ disabled: !!disabled }}
      ph-label={phLabel}>
      <Text style={styles.promptBtnText}>{label}</Text>
    </Pressable>
  );
}

/** 지금 내 대사 글자 크기 3단 — 토큰의 글자 단계만 쓴다. */
const PROMPT_NOW_SIZE: Record<PromptSize, TextStyle> = {
  small: type.body1Bold,
  normal: type.headline,
  large: type.title2,
};

function CloseButton({ onPress, phLabel }: { onPress: () => void; phLabel: string }) {
  return (
    <Pressable
      style={styles.closeBtn}
      onPress={onPress}
      hitSlop={8}
      accessibilityRole="button"
      accessibilityLabel={t('common.close')}
      ph-label={phLabel}>
      <Feather name="x" size={30} color={palette.onAccent} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.text },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topGroup: { flexShrink: 1, gap: space[2] },
  topBar: {
    height: 48,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[3],
  },
  closeBtn: { width: 44, height: 44, alignItems: 'center', justifyContent: 'center' },
  roundBtn: {
    width: 44,
    height: 44,
    borderRadius: radius.full,
    backgroundColor: palette.scrim,
    alignItems: 'center',
    justifyContent: 'center',
  },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[1.5],
    height: 32,
    paddingHorizontal: space[3],
    borderRadius: radius.full,
    backgroundColor: palette.scrim,
  },
  timerPillRec: { backgroundColor: palette.danger },
  recDot: { width: 8, height: 8, borderRadius: radius.full, backgroundColor: palette.danger },
  recDotRec: { backgroundColor: palette.onAccent },
  timerText: { ...type.body2Bold, color: palette.onAccent, fontVariant: ['tabular-nums'] },
  card: {
    marginHorizontal: space[3],
    padding: space[4],
    paddingTop: space[3],
    borderRadius: radius.lg,
    backgroundColor: palette.toast,
    gap: space[1.5],
  },
  cardLabelRow: { flexDirection: 'row', alignItems: 'center', gap: space[1] },
  cardLabel: { ...type.micro, color: palette.blueSoft },
  lineText: { ...type.headline, color: palette.onAccent },
  scriptBody: { gap: space[1.5] },
  scriptLine: { ...type.body2, color: palette.onMediaSub },
  scriptLineMine: { ...type.body2Bold, color: palette.onAccent },
  scriptSpeaker: { ...type.body2Bold, color: palette.onMediaSub },
  scriptSpeakerMine: { color: palette.blueSoft },
  scriptDirection: { ...type.caption, color: palette.onMediaSub },
  promptBody: { gap: space[2] },
  promptSide: { ...type.caption, color: palette.onMediaSub },
  promptSpeaker: { ...type.captionBold, color: palette.blueSoft },
  promptNow: { color: palette.onAccent },
  promptBar: { flexDirection: 'row', flexWrap: 'wrap', justifyContent: 'center', gap: space[2], paddingHorizontal: space[3] },
  promptBtn: { height: 32, paddingHorizontal: space[3], borderRadius: radius.full, backgroundColor: palette.scrim, alignItems: 'center', justifyContent: 'center' },
  promptBtnOff: { opacity: 0.4 },
  promptBtnText: { ...type.captionBold, color: palette.onAccent },
  bottomGroup: { gap: space[4], paddingBottom: space[3] },
  controls: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: space[6],
  },
  shutter: {
    width: 84,
    height: 84,
    borderRadius: radius.full,
    borderWidth: 4,
    borderColor: palette.onAccent,
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterIn: { width: 68, height: 68, borderRadius: radius.full, backgroundColor: palette.danger },
  shutterStop: { width: 32, height: 32, borderRadius: radius.sm, backgroundColor: palette.danger },
  hiddenKeepSpace: { opacity: 0 },
  hint: { ...type.caption, color: palette.onMediaSub, textAlign: 'center' },
  permNotice: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: space[3],
    marginHorizontal: space[4],
    marginBottom: space[6],
    padding: space[4],
    borderRadius: radius.lg,
    backgroundColor: palette.amberSoft,
  },
  permNoticeBody: { flex: 1, gap: space[1] },
  permNoticeTitle: { ...type.body2Bold, color: palette.text },
  permNoticeText: { ...type.caption, color: palette.textSub },
  permNoticeAction: { ...type.body2Bold, color: palette.blueDeep },
});
