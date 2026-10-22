import * as ImagePicker from 'expo-image-picker';
import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { useIsFocused, usePreventRemove } from '@react-navigation/native';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { Stepper } from '@/components/practice-chrome';
import { VideoSourceSheet } from '@/components/video-source-sheet';
import { UploadReasonSheet } from '@/components/upload-reason-sheet';
import { CoachBubble } from '@/components/ui/mascot-bubble';
import { NavIconButton } from '@/components/ui/nav-header';
import { IconOptionRow as ChoiceRow } from '@/components/ui/option-card';
import { palette } from '@/constants/palette';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useVideoPreviewEvents } from '@/hooks/use-video-preview-events';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t } from '@/lib/i18n';
import {
  confirmedVideoFor,
  flushLibraryUploads,
  onLibraryChange,
  pendingLibraryUploads,
  saveRecordingToLibrary,
} from '@/lib/library/library-runner';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { initialPickedVideo, takePickedVideo, type PickedVideo } from '@/lib/practice/picked-video';
import { canStart, planFor, type StartPlan } from '@/lib/practice/resume';
import {
  BLOCKAGE_NOTE_MAX,
  blockageNoteOverflow,
  buildContinueBody,
  buildStartBody,
  emptyBlockageDraft,
  fingerprintOf,
  inProgressPracticeId,
  sceneOverflow,
  startFailure,
  type BlockageDraft,
} from '@/lib/practice/start';
import { takeContinueOrigin } from '@/lib/practice/session-state';
import {
  blockageCategoryFor,
  DEFAULT_PURPOSE,
  firstUploadStep,
  previousUploadStep,
  SESSION_PURPOSES,
  stepperIndex,
  type SessionPurpose,
  type UploadStep,
} from '@/lib/practice/session-purpose';
import {
  PRACTICE_UPLOAD_EVENTS,
  rightsToggleParams,
  startBlockReason,
  startBlockedParams,
  uploadExitParams,
  videoPickedParams,
  videoReadyParams,
  type PickSource,
} from '@/lib/practice/upload-events';
import { attemptFor, newRequestId, type RequestAttempt } from '@/lib/request-id';
import { TARGET } from '@/lib/spotlight-targets';
import { currentTutorial, stageTrack } from '@/lib/tutorial';
import { sampleVideoUri } from '@/lib/tutorial-loop';
import { SAMPLE_PRACTICE_ID } from '@/lib/tutorial-sample';
import { normalizeVideoDurationMs } from '@/lib/upload-input';
import { limitVideoBuffer, sourceWhileFocused } from '@/lib/video-memory';

/**
 * A8·A8.1·A9.x 새 연습 준비(practice.start · practice.resume).
 *
 * 두 단계다(pen 「새 · 오늘 세션 목적」→「새 · 영상 고르기」). 장면 정보(상황·인물·원하는 것) 단계는 SOMA-778에서 없앴다 —
 * 장면 없이 시작하고 서버는 빈 값으로 둔다(practice.start). 목적은 누르면 바로 영상 단계로 넘어간다(「다음」 버튼 없음).
 * 세션 목적 세 갈래는 기존 막힘 큰 갈래로 보낸다(lib/practice/session-purpose). 「지금 찍기」는 바로
 * 카메라로 간다. 영상 단계 맨 아래에 권리 체크와 시작 버튼이 있고, 체크해야 시작한다.
 * 튜토리얼·예시는 한 장에서 비추므로 바로 영상 단계로 연다. 시작하면 코치 화면으로 가고, 분석 대기도 거기서 한다.
 *
 * 영상은 새로 찍거나 갤러리에서 고른다 — 여기서 올리지 않는다(올리기는 업로드 큐가 한다).
 * 도움 갈래와 상세 설명은 선택이고, 시작을 누르면 회차 하나와 분석 작업 하나가 생긴다. 상황·인물·목표 칸과
 * 「이전 연습 이어서 하기」, 세부 칩은 SOMA-656 에서 뺐다 — 다음 테이크(이어하기)로 들어오면 지난 장면은 화면 없이
 * 그대로 보내고, 세부는 비워 보내 서버 기본값(그 외)이 된다.
 * 다음 테이크도 영상은 늘 새로 고르거나 찍는다 — 빈 영상 상자에서 시작하고 본문에 고른 video_id 를 싣는다(SOMA-672).
 * 같은 시도의 재전송은 같은 요청 id 라 회차는 하나다. 묶음에 진행 중 회차가 있으면(409) 그
 * 회차로 돌려보낸다. 이론 선택은 0.1.0에서 뺐다.
 */
const PURPOSE_ICON: Record<SessionPurpose, 'star' | 'unlock' | 'book-open'> = {
  review: 'star',
  unblock: 'unlock',
  character: 'book-open',
};
export default function UploadScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { alert, dialog } = useAppDialog();

  // 튜토리얼의 예시(SOMA-494) — 예시 영상과 장면을 채워 두고, 시작하면 서버 없이 예시 회차로 간다.
  const params = useLocalSearchParams<{ sample?: string; first?: string }>();
  const sample = params.sample === '1';
  // 첫 코칭을 마치기 전에만 파란 안내(어디를 누르면 되는지)를 보인다 — 코칭 탭이 처음 화면에서 넘겨 준다.
  const firstTime = params.first === '1';
  const [plan] = useState<StartPlan>(() => planFor(sample ? null : takeContinueOrigin()));
  const [picked, setPicked] = useState<PickedVideo | null>(() =>
    sample
      ? { videoId: null, pendingId: null, uri: sampleVideoUri(), playbackUrl: null, durationMs: null }
      : initialPickedVideo(Boolean(plan.continueFrom)),
  );
  // 장면 칸은 없다(SOMA-778). 노트·리딩에서 넘겨받은 장면만 화면 없이 그대로 보낸다.
  const scene = plan.scene;
  const [step, setStep] = useState<UploadStep>(() =>
    firstUploadStep({ sample, tutorial: currentTutorial()?.track === stageTrack('upload') }),
  );
  const [purpose, setPurpose] = useState<SessionPurpose>(DEFAULT_PURPOSE);
  // 기본 목적은 보내기용일 뿐이다 — 직접 고르기 전에는 고른 것처럼 칠하지 않는다(10/22 피드백).
  const [purposePicked, setPurposePicked] = useState(false);
  const [blockage, setBlockage] = useState<BlockageDraft>(() => ({
    ...emptyBlockageDraft,
    category: blockageCategoryFor(DEFAULT_PURPOSE),
  }));
  const choosePurpose = (next: SessionPurpose) => {
    setPurpose(next);
    setPurposePicked(true);
    setBlockage((was) => ({ ...was, category: blockageCategoryFor(next), detail: null }));
  };
  // 뒤로 가기(헤더·안드로이드)는 앞 단계로 돌아간다. 다음 화면(코치)으로 넘어갈 때는 풀어 둔다 —
  // usePreventRemove 는 렌더된 값을 보므로 풀린 값이 반영된 다음 틱에 이동한다.
  const [leaving, setLeaving] = useState(false);
  const [reasonSheet, setReasonSheet] = useState(false);
  const showReason = () => setReasonSheet(true);
  const closeReason = () => { setReasonSheet(false); setStep('purpose'); };
  const reasonRoute = (go: () => void) => {
    setReasonSheet(false);
    setTimeout(() => leaveThen(go), Platform.OS === 'ios' ? 450 : 0);
  };
  usePreventRemove(!leaving && previousUploadStep(step) !== null, () => {
    const back = previousUploadStep(step);
    if (back && !sample && !picked) showReason();
    else if (back) setStep(back);
  });
  const leaveThen = (go: () => void) => {
    setLeaving(true);
    setTimeout(go, 0);
  };
  // 묶음 제목(SOMA-671). 이어하기는 원래 묶음 제목을 그대로 쓰므로 새 연습에서만 받는다.
  const [agreedRights, setAgreedRights] = useState(sample);
  const pickTarget = useSpotlightTarget(TARGET.uploadPick);
  const sampleTarget = useSpotlightTarget(TARGET.uploadSample);
  const rightsTarget = useSpotlightTarget(TARGET.uploadRights);
  const startTarget = useSpotlightTarget(TARGET.uploadStart);
  const tutorialGuide = useTutorialSpotlight('upload');
  const [starting, setStarting] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const attemptRef = useRef<RequestAttempt | null>(null);
  const startLockRef = useRef(false);

  // 어디서 멈추는지 세는 계측(SOMA-698, lib/practice/upload-events). 예시(튜토리얼) 화면은 세지 않는다.
  const sourceRef = useRef<PickSource | null>(null);
  const pendingSinceRef = useRef<number | null>(null);
  const blockedTapsRef = useRef(0);
  const startedRef = useRef(false);
  const exitRef = useRef({ openedAt: Date.now(), hasVideo: false, uploading: false, rights: false });
  const notePicked = useCallback(
    (source: PickSource, video: PickedVideo) => {
      if (sample) return;
      const needsUpload = Boolean(video.pendingId && !video.videoId);
      sourceRef.current = source;
      pendingSinceRef.current = needsUpload ? Date.now() : null;
      void logEvent(PRACTICE_UPLOAD_EVENTS.videoPicked, videoPickedParams(source, needsUpload, video.durationMs));
    },
    [sample],
  );
  const noteReady = useCallback(() => {
    if (sample || pendingSinceRef.current === null) return;
    void logEvent(
      PRACTICE_UPLOAD_EVENTS.videoReady,
      videoReadyParams(sourceRef.current ?? 'library', Date.now() - pendingSinceRef.current),
    );
    pendingSinceRef.current = null;
  }, [sample]);

  const previewUri = picked?.uri ?? picked?.playbackUrl ?? null;
  const focused = useIsFocused();
  const player = useVideoPlayer(sourceWhileFocused(previewUri, focused), (p) => {
    p.loop = false;
    limitVideoBuffer(p);
  });
  // 올린 영상을 사용자가 미리보기에서 실제로 틀어 보는지 센다.
  useVideoPreviewEvents(player, 'upload', previewUri, { sample, continued: Boolean(plan.continueFrom) });

  // 보관함·촬영·갤러리에서 돌아오면 고른 영상을 받는다.
  useFocusEffect(
    useCallback(() => {
      const next = takePickedVideo();
      if (next) {
        setPicked(next);
        setError(null);
        setStep('source');
        notePicked(next.source ?? 'library', next);
      }
    }, [notePicked]),
  );

  // 보관함 목록은 재생 주소를 주지 않는다(상세에서만 준다) — 목록에서 고른 영상은 상세로 받아 미리보기를 채운다.
  useEffect(() => {
    if (!picked?.videoId || picked.uri || picked.playbackUrl) return;
    let cancelled = false;
    api
      .getVideo(picked.videoId)
      .then((video) => {
        if (cancelled || !video.playback_url) return;
        setPicked((was) => (was && was.videoId === video.id ? { ...was, playbackUrl: video.playback_url ?? null } : was));
      })
      .catch(() => undefined);
    return () => {
      cancelled = true;
    };
  }, [picked?.videoId, picked?.uri, picked?.playbackUrl]);

  // 올리는 중이던 영상이 확정되면 그 id로 바꾼다 — 그래야 시작할 수 있다.
  useEffect(() => {
    if (!picked?.pendingId || picked.videoId) return;
    const check = () => {
      const videoId = confirmedVideoFor(picked.pendingId as string);
      if (!videoId) return;
      noteReady();
      setPicked((was) => (was ? { ...was, videoId } : was));
    };
    check();
    return onLibraryChange(check);
  }, [picked?.pendingId, picked?.videoId, noteReady]);

  const videoId = picked?.videoId ?? null;
  const uploading = Boolean(picked?.pendingId && !picked.videoId);

  // 올리는 중에는 미리보기를 멈춘다 — 같은 파일을 재생하면 압축이 쓰는 하드웨어 코덱과 겹쳐 압축이 멎을 수 있다(SOMA-737, 추정).
  useEffect(() => {
    if (!uploading) return;
    try {
      player.pause();
    } catch {}
  }, [uploading, player]);

  // 압축·올리기가 실패로 남았는지. 실패해도 「올리는 중」으로만 보이면 끝나지 않는 것처럼 보인다(SOMA-737).
  const [uploadFailed, setUploadFailed] = useState(false);
  useEffect(() => {
    const pendingId = picked?.pendingId;
    if (!pendingId || picked?.videoId || !user?.id) {
      setUploadFailed(false);
      return;
    }
    let alive = true;
    const owner = user.id;
    const check = () => {
      void pendingLibraryUploads(owner)
        .then((list) => {
          if (alive) setUploadFailed(list.find((e) => e.id === pendingId)?.status === 'failed');
        })
        .catch(() => undefined);
    };
    check();
    const off = onLibraryChange(check);
    return () => {
      alive = false;
      off();
    };
  }, [picked?.pendingId, picked?.videoId, user?.id]);

  // 영상 상자를 누르면 뜨는 시트(SOMA-656). 시트가 닫힌 뒤에 다음 화면·사진 선택 창을 연다 — iOS 는 닫히는 모달 위에
  // 새 창을 띄우지 못한다.
  const [sourceSheet, setSourceSheet] = useState(false);
  const fromSheet = (action: () => void) => () => {
    setSourceSheet(false);
    setTimeout(action, Platform.OS === 'ios' ? 450 : 0);
  };
  const record = () => router.push({ pathname: '/record-video', params: { mode: 'ai' } });

  const pickFromGallery = async () => {
    if (!user?.id) return;
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], allowsEditing: true, quality: 1 });
    if (result.canceled || !result.assets[0]) { if (!picked) showReason(); return; }
    const asset = result.assets[0];
    const durationMs = normalizeVideoDurationMs(asset.duration ?? null);
    const outcome = await saveRecordingToLibrary({ uri: asset.uri, durationMs, owner: user.id });
    if (outcome.kind === 'rejected') {
      void alert({ title: t('upload.titleNew'), message: videoErrorMessage(outcome.code) });
      return;
    }
    const next = { videoId: null, pendingId: outcome.entry.id, uri: outcome.entry.uri, playbackUrl: null, durationMs };
    setPicked(next);
    setStep('source');
    notePicked('gallery', next);
  };

  const start = async () => {
    if (startLockRef.current || starting) return;
    if (sample) {
      if (agreedRights) leaveThen(() => router.replace({ pathname: '/coach', params: { practiceId: SAMPLE_PRACTICE_ID } }));
      return;
    }
    if (!agreedRights || !canStart(videoId)) return;
    const overflow = sceneOverflow(scene);
    if (overflow) {
      setError(t('start.sceneTooLong'));
      return;
    }
    if (blockageNoteOverflow(blockage)) {
      setError(t('start.noteTooLong'));
      return;
    }
    startLockRef.current = true;
    setStarting(true);
    setError(null);
    try {
      if (uploading && picked?.pendingId) {
        // 아직 올리는 중이면 확정될 때까지 한 번 밀어 준다(422 video_not_ready 를 미리 피한다).
        await flushLibraryUploads(user?.id ?? '');
        const confirmed = confirmedVideoFor(picked.pendingId);
        if (!confirmed) {
          setError(t('start.stillUploading'));
          return;
        }
        noteReady();
        setPicked({ ...picked, videoId: confirmed });
      }
      const resolvedVideoId = picked?.videoId ?? confirmedVideoFor(picked?.pendingId ?? '') ?? null;
      if (!resolvedVideoId) {
        setError(t('start.stillUploading'));
        return;
      }
      const continueFrom = plan.continueFrom;
      const body = continueFrom
        ? buildContinueBody({ requestId: 'pending', videoId: resolvedVideoId, scene, blockage })
        : buildStartBody({ requestId: 'pending', videoId: resolvedVideoId, scene, blockage });
      const attempt = attemptFor(attemptRef.current, fingerprintOf(body), newRequestId);
      attemptRef.current = attempt;
      const practice = continueFrom
        ? await api.continuePractice(continueFrom.practiceId, { ...body, request_id: attempt.requestId })
        : await api.createPractice({ ...body, request_id: attempt.requestId } as Parameters<typeof api.createPractice>[0]);
      startedRef.current = true;
      logEvent('practice_start', { ordinal: practice.ordinal, continued: Boolean(continueFrom) });
      leaveThen(() => router.replace({ pathname: '/coach', params: { practiceId: practice.id } }));
    } catch (e) {
      const failure = startFailure(e);
      if (failure.kind === 'in_progress') {
        const open = await api
          .listPracticeGroups('all')
          .then(({ groups }) => inProgressPracticeId(groups, plan.continueFrom?.rootId ?? null))
          .catch(() => null);
        if (open) {
          startedRef.current = true;
          void alert({ title: t('start.inProgressTitle'), message: t('start.inProgressBody') });
          leaveThen(() => router.replace({ pathname: '/coach', params: { practiceId: open } }));
          return;
        }
        setError(t('start.inProgressBody'));
        return;
      }
      if (failure.kind === 'fingerprint_mismatch') attemptRef.current = null;
      setError(
        failure.kind === 'video_not_ready'
          ? t('start.stillUploading')
          : failure.kind === 'daily_limit'
            ? t('start.dailyLimit')
            : failure.kind === 'offline'
              ? t('start.offline')
              : videoErrorMessage(e),
      );
    } finally {
      startLockRef.current = false;
      setStarting(false);
    }
  };

  // 질문 받기를 누른 뒤에는 보낸 내용이 바뀌지 않게 영상·권리 체크를 잠근다(SOMA-671).
  const locked = starting;
  const ready = sample ? agreedRights : agreedRights && canStart(videoId) && !uploading;

  // 화면을 떠날 때 보낼 마지막 상태. 올리는 중인 영상도 '고른 영상'으로 친다.
  useEffect(() => {
    exitRef.current = {
      ...exitRef.current,
      hasVideo: canStart(videoId) || uploading,
      uploading,
      rights: agreedRights,
    };
  });
  useEffect(
    () => () => {
      if (sample || startedRef.current) return;
      void logEvent(
        PRACTICE_UPLOAD_EVENTS.screenExit,
        uploadExitParams({
          ...exitRef.current,
          source: sourceRef.current,
          blockedTaps: blockedTapsRef.current,
          now: Date.now(),
        }),
      );
    },
    [sample],
  );
  // 준비가 안 된(회색) 질문 받기를 누르면 무엇에 막혔는지 센다.
  const noteBlocked = () => {
    if (sample) return;
    const reason = startBlockReason({ hasVideo: canStart(videoId) || uploading, uploading, rights: agreedRights });
    if (!reason) return;
    blockedTapsRef.current += 1;
    void logEvent(PRACTICE_UPLOAD_EVENTS.startBlocked, startBlockedParams(reason));
  };
  // 준비 전에 누른 질문 받기. 올리는 중이면 업로드를 한 번 더 밀어 준다 — 「잠시 뒤에 다시 눌러 주세요」대로 누르면
  // 멈춘 업로드가 다시 돈다(SOMA-734).
  const pressBlocked = () => {
    if (uploading && user?.id) void flushLibraryUploads(user.id).catch(() => undefined);
    noteBlocked();
  };
  const toggleRights = () => {
    const next = !agreedRights;
    setAgreedRights(next);
    if (!sample) void logEvent(PRACTICE_UPLOAD_EVENTS.rightsToggle, rightsToggleParams(next));
  };
  // 준비가 끝났으면 버튼만 둔다 — 무엇이 모자란지만 알린다.
  // 올리는 중이면 영상은 이미 고른 것이다 — 「영상을 채워주세요」가 아니라 올리는 중이라고 말한다(SOMA-671).
  const hint = ready
    ? null
    : !sample && uploading
      ? uploadFailed
        ? t('start.uploadFailed')
        : t('start.stillUploading')
      : !sample && !canStart(videoId)
        ? t('upload.missingVideo')
        : t('upload.missingRights');

  const sourceOptions = [
    { key: 'record', icon: 'video' as const, title: t('upload.recordCta'), sub: t('upload.recordSub'), onPress: fromSheet(record) },
    { key: 'gallery', icon: 'image' as const, title: t('upload.pickGallery'), sub: t('upload.gallerySub'), onPress: fromSheet(() => void pickFromGallery()) },
  ];

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: plan.continueFrom ? t('start.titleContinue') : t('upload.titleNew'),
          headerShadowVisible: false,
          // pen 03 「새 연습」 머리 — 오른쪽 설정 아이콘(24).
          headerRight: () => (
            <NavIconButton icon="settings" size={24} label={t('settings.title')} phLabel="upload_settings" onPress={() => router.push('/settings')} />
          ),
        }}
      />
      <View style={styles.stepRow}>
        <Stepper current={stepperIndex(step)} />
      </View>

      {step === 'purpose' && (
        <ScrollView contentContainerStyle={styles.stepBody}>
          {/* 「처음이면 ~를 누르세요」는 코칭 탭 첫 화면에서 한 번만 한다 — 단계마다 반복하지 않는다(10/20 피드백). */}
          <CoachBubble title={t('upload.purposeBubble')} guide={null} />
          <View style={styles.choices}>
            {/* 누르면 바로 영상 단계로 간다 — 「다음」 버튼도 꺾쇠도 없다(SOMA-778). */}
            {SESSION_PURPOSES.map((item) => (
              <ChoiceRow
                key={item}
                icon={PURPOSE_ICON[item]}
                title={t(`upload.purpose.${item}`)}
                sub={t(`upload.purposeSub.${item}`)}
                selected={purposePicked && purpose === item}
                mark="none"
                onPress={() => {
                  choosePurpose(item);
                  setStep('source');
                }}
              />
            ))}
          </View>
        </ScrollView>
      )}

      {step === 'source' && (
        <View style={styles.flex}>
          <ScrollView contentContainerStyle={styles.stepBody}>
            {!sample && (
              <CoachBubble
                title={picked ? t('upload.readyBubble') : t('upload.sourceBubble')}
                guide={null}
              />
            )}

            {picked ? (
              <View
                style={styles.pickedBlock}
                ref={sample ? sampleTarget.ref : pickTarget.ref}
                onLayout={sample ? sampleTarget.onLayout : pickTarget.onLayout}>
                {previewUri ? (
                  <VideoView style={styles.preview} player={player} nativeControls contentFit="contain" />
                ) : (
                  <View style={[styles.preview, styles.previewEmpty]}>
                    <ActivityIndicator color="#fff" />
                  </View>
                )}
                <View style={styles.pickedRow}>
                  {sample && (
                    <View style={styles.sampleBadge}>
                      <Text style={styles.sampleBadgeText}>{t('tutorial.sampleBadge')}</Text>
                    </View>
                  )}
                  {!sample && (
                    <Pressable style={styles.repick} onPress={() => setSourceSheet(true)} disabled={locked}>
                      <Text style={styles.repickText}>{t('upload.repick')}</Text>
                    </Pressable>
                  )}
                  <Text style={styles.pickedMeta} numberOfLines={1}>
                    {sample
                      ? t('tutorial.sample.situation')
                      : uploading
                        ? t('archive.statusUploading')
                        : t('archive.statusSaved')}
                  </Text>
                </View>
              </View>
            ) : (
              <View style={styles.choices} ref={pickTarget.ref} onLayout={pickTarget.onLayout}>
                <ChoiceRow
                  icon="video"
                  title={t('upload.sourceRecord')}
                  sub={t('upload.sourceRecordSub')}
                  highlight={firstTime}
                  onPress={record}
                />
                <ChoiceRow icon="image" title={t('upload.pickGallery')} sub={t('upload.sourceGallerySub')} onPress={() => void pickFromGallery()} />
                <ChoiceRow icon="message-circle" title={t('uploadReason.noVideo')} sub={t('uploadReason.optional')} onPress={showReason} />
              </View>
            )}

            {/* 질문 받기를 누른 뒤 — 보내는 중이라는 걸 바로 보인다(SOMA-671). */}
            {locked && (
              <View style={styles.sendingBar} accessibilityLiveRegion="polite">
                <ActivityIndicator size="small" color={palette.blue} />
                <Text style={styles.sendingText}>{t('upload.sending')}</Text>
              </View>
            )}
            {error && <Text style={styles.errorText}>{error}</Text>}
          </ScrollView>

          {/* 영상 단계 맨 아래 — 권리 체크(pen 옛 장면 단계의 체크 모양), 시작 버튼, 무엇이 모자란지(SOMA-778). */}
          <View style={styles.bottom}>
            <Pressable
              ref={rightsTarget.ref}
              onLayout={rightsTarget.onLayout}
              style={styles.rightsRow}
              onPress={toggleRights}
              disabled={locked}
              accessibilityRole="checkbox"
              accessibilityState={{ checked: agreedRights, disabled: locked }}>
              <View style={[styles.check, agreedRights && styles.checkOn]}>
                {agreedRights && <Text style={styles.checkMark}>✓</Text>}
              </View>
              <Text style={styles.rightsText}>{t('upload.rights')}</Text>
            </Pressable>
            <Pressable
              ref={startTarget.ref}
              onLayout={startTarget.onLayout}
              style={[styles.submit, (!ready || starting) && styles.submitDisabled]}
              onPress={() => (ready ? void start() : pressBlocked())}
              disabled={starting}
              accessibilityRole="button"
              accessibilityState={{ disabled: !ready || starting }}>
              {starting ? (
                <ActivityIndicator color={palette.bg} />
              ) : (
                <Text style={[styles.submitText, (!ready || starting) && styles.submitTextDisabled]}>
                  {/* 영상이 아직 올라가는 중이면 무엇을 기다리는지 버튼이 말한다(SOMA-671). */}
                  {uploading ? t('upload.submitUploading') : plan.prefilled ? t('upload.submitRetake') : t('upload.submitNew')}
                </Text>
              )}
            </Pressable>
            {hint && <Text style={styles.submitHint}>{hint}</Text>}
          </View>
        </View>
      )}
      {/* 고른 영상을 바꿀 때 쓰는 시트(SOMA-656). 처음 고르기는 위의 세 줄이 한다. */}
      <VideoSourceSheet
        visible={sourceSheet}
        title={t('start.pickTitle')}
        sub={t('upload.dropHint')}
        onClose={() => setSourceSheet(false)}
        options={sourceOptions}
      />
      {reasonSheet && <UploadReasonSheet onClose={closeReason}
        onTalk={() => reasonRoute(() => router.replace('/talk'))}
        onScript={() => reasonRoute(() => router.replace('/script-cocreate'))}
        onRecord={() => reasonRoute(record)} />}
      {dialog}
      {tutorialGuide.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  // pen 03 「Stepper」 — 머리 아래 1 띄워 가운데, 21 띄워 말풍선. 본문 좌우 20, 말풍선과 선택지 사이 14.
  stepRow: { alignItems: 'center', paddingTop: 1 },
  stepBody: { paddingTop: 21, paddingHorizontal: 20, paddingBottom: 24, gap: 14 },
  choices: { gap: 4 },
  // pen 03 「Footer」 — 안쪽 [0,20,10,20]: 권리 체크 · 14 · 버튼 48 · 9 · 안내 14/500.
  bottom: { paddingHorizontal: 20, paddingTop: 12, paddingBottom: 10, backgroundColor: palette.bg },

  sampleBadge: { backgroundColor: palette.blueSoft, borderRadius: 8, paddingHorizontal: 10, paddingVertical: 5 },
  sampleBadgeText: { fontSize: 12.5, fontWeight: '800', color: palette.blue },
  // pen 09 「새 연습 · 영상 고름」 — 영상 높이 178 · 모서리 22, 8 띄워 「영상 다시 선택」 알약(28) · 7 · 「보관함 저장」.
  pickedBlock: { gap: 8 },
  preview: { width: '100%', height: 178, borderRadius: 22, overflow: 'hidden', backgroundColor: palette.text },
  previewEmpty: { alignItems: 'center', justifyContent: 'center' },
  pickedRow: { flexDirection: 'row', alignItems: 'center', gap: 7 },
  repick: { height: 28, borderRadius: 14, paddingHorizontal: 11, justifyContent: 'center', backgroundColor: palette.blueSoft },
  repickText: { fontSize: 15, fontWeight: '700', lineHeight: 19, color: palette.blueDeep },
  pickedMeta: { flex: 1, fontSize: 15, fontWeight: '500', lineHeight: 19, color: palette.textFaint },
  errorText: { color: palette.danger, fontSize: 13, fontWeight: '700' },

  sendingBar: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: palette.blueSoft,
    borderRadius: 12,
    paddingVertical: 10,
    paddingHorizontal: 12,
  },
  sendingText: { flex: 1, fontSize: 13.5, fontWeight: '800', color: palette.blueDeep },
  // pen 03 「Rights」 — 네모 22(모서리 6), 10 띄워 글 15/700 #333D4B(줄 21).
  rightsRow: { flexDirection: 'row', alignItems: 'flex-start', gap: 10 },
  check: { width: 22, height: 22, borderRadius: 6, borderWidth: 1.5, borderColor: palette.checkOff, alignItems: 'center', justifyContent: 'center', marginTop: 1 },
  checkOn: { backgroundColor: palette.blue, borderColor: palette.blue },
  checkMark: { color: palette.bg, fontSize: 13, fontWeight: '900' },
  rightsText: { flex: 1, fontSize: 15, fontWeight: '700', lineHeight: 21, color: palette.textStrong },

  // pen 버튼/Primary — 높이 48 · 모서리 16 · 글자 17/700. 막혀 있으면 Disabled(#E5E8EB · #B0B8C1). 준비 전에도 눌러서
  // 무엇에 막혔는지 세야 해서(SOMA-698) 공통 Button(막히면 안 눌림) 대신 같은 모양을 직접 그린다.
  submit: { height: 48, borderRadius: 16, backgroundColor: palette.blue, alignItems: 'center', justifyContent: 'center', marginTop: 14 },
  submitDisabled: { backgroundColor: palette.border },
  submitText: { fontSize: 17, fontWeight: '700', color: palette.onAccent },
  submitTextDisabled: { color: palette.checkOff },
  submitHint: { fontSize: 14, fontWeight: '500', color: palette.textFaint, lineHeight: 18, textAlign: 'center', marginTop: 9 },
});
