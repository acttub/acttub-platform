import { Stack, useFocusEffect, useRouter } from 'expo-router';
import { type VideoSource } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { AppState, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { AdSlot } from '@/components/ad-slot';
import { useAppDialog } from '@/components/app-dialog';
import { CoachMessage } from '@/components/coach-message';
import { CoachVideoRow } from '@/components/coach-video-row';
import { logFoldOpen, SceneFoldBody } from '@/components/practice-chrome';
import { PrimaryButton, TextButton } from '@/components/ui/buttons';
import { CtaBar } from '@/components/ui/cta-bar';
import { InfoBanner } from '@/components/ui/info-banner';
import { palette } from '@/constants/palette';
import { space, type } from '@/constants/tokens';
import { useSpotlightTarget } from '@/hooks/use-spotlight-target';
import { finishTutorial, useTutorialSpotlight } from '@/hooks/use-tutorial-spotlight';
import { useWaitExit } from '@/hooks/use-wait-exit';
import { logEvent } from '@/lib/analytics';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t, translateList } from '@/lib/i18n';
import { localCopyFor } from '@/lib/library/library-runner';
import { logMetaEvent } from '@/lib/meta-events';
import { onPushReceived } from '@/lib/notifications';
import type { PendingAnalysisHandle } from '@/lib/pending-analysis';
import {
  analysisFailureMessage,
  analysisPartialNotice,
  analysisPushTarget,
  analysisRecoveryAction,
  cancelAnalysis,
  watchAnalysis,
} from '@/lib/practice/analysis-run';
import { startPractice } from '@/lib/practice/session-state';
import { inProgressPracticeId } from '@/lib/practice/start';
import type { PracticeDetail, PracticeStatus } from '@/lib/practice/types';
import { previewVideoSource } from '@/lib/preview-video';
import { newRequestId } from '@/lib/request-id';
import { TARGET } from '@/lib/spotlight-targets';
import { sampleVideoUri } from '@/lib/tutorial-loop';
import { isSamplePracticeId, SAMPLE_ANALYZING_STEP_MS, sampleDetail, sampleScene } from '@/lib/tutorial-sample';

/** 경과 시간 기반 단계 문구로 기다림을 설계한다(실제 진행률은 서버가 주지 않는다). */
const STAGES = translateList('analyzing.stages');

/**
 * 코치 화면의 「영상 보는 중」(practice.analyze, SOMA-778). 옛 A10 분석 화면을 대화 화면 안으로 옮겼다.
 *
 * 영상은 이미 보관함에 있고(practice.record) 회차도 만들어져 있다 — 회차 상태를 4초마다 읽기만 한다. 코치 대화
 * 시작(`/v2/coach/start`)은 분석이 끝나기 전엔 409 analysis_not_ready 라, 상태가 대화 단계가 된 뒤에 회차를 들고
 * {@code onReady} 로 대화를 연다. 화면을 떠나면 조회만 멈추고 작업은 서버에서 계속 돈다. 돌아오면(포커스·앱 활성)
 * 기다리지 않고 서버 상태부터 읽는다. 완료 푸시가 오면 다음 조회를 기다리지 않는다. 앱을 껐다 켜도 돌아오게
 * 복구 기록을 남긴다(lib/app-bootstrap). "그만두기"는 작업 취소이고 연습을 숨기지 않는다.
 */
export function CoachWaiting({
  practiceId,
  preview,
  onReady,
}: {
  practiceId: string | null;
  preview: boolean;
  onReady: () => void;
}) {
  const router = useRouter();
  const { user } = useAuth();
  const { confirm, alert, dialog } = useAppDialog();
  // 부모가 그릴 때마다 새 함수를 넘겨도 조회를 다시 시작하지 않게 ref 로 든다.
  const onReadyRef = useRef(onReady);
  onReadyRef.current = onReady;

  const [status, setStatus] = useState<PracticeStatus | null>(null);
  const [detail, setDetail] = useState<PracticeDetail | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [retrying, setRetrying] = useState(false);
  const [stopping, setStopping] = useState(false);
  const [stage, setStage] = useState(0);
  const [elapsedSec, setElapsedSec] = useState(0);
  const [sceneOpen, setSceneOpen] = useState(false);
  const [videoUri, setVideoUri] = useState<VideoSource | null>(null);

  const controllerRef = useRef<AbortController | null>(null);
  const pendingHandleRef = useRef<PendingAnalysisHandle | null>(null);
  const finishedRef = useRef(false);
  const retryRequestId = useRef<string | null>(null);

  // 튜토리얼 예시(SOMA-494) — 조회도 분석도 없이 몇 초 뒤 대화를 연다.
  // 설명(스포트라이트)을 다 본 뒤에 넘긴다 — 읽는 도중에 화면이 바뀌면 안 된다.
  const sample = isSamplePracticeId(practiceId);
  // 영상 보는 중에 뒤로 가면 코칭 탭 첫 화면으로 간다(10-27 정함). 분석은 서버에서 계속되고 끝나면 완료 푸시가 온다.
  const leave = useWaitExit(!sample && !error, '/coaching');
  const [sampleReady, setSampleReady] = useState(false);
  const [guideDone, setGuideDone] = useState(false);
  const progressTarget = useSpotlightTarget(TARGET.analyzingProgress);
  const tutorialGuide = useTutorialSpotlight('analyzing', { onDone: () => setGuideDone(true) });

  useEffect(() => {
    if (!sample) return;
    let alive = true;
    void (async () => {
      for (let i = 0; i < SAMPLE_ANALYZING_STEP_MS.length; i += 1) {
        setStage(Math.min(i, STAGES.length - 1));
        await new Promise((resolve) => setTimeout(resolve, SAMPLE_ANALYZING_STEP_MS[i]));
        if (!alive) return;
      }
      setSampleReady(true);
    })();
    return () => {
      alive = false;
    };
  }, [sample]);

  useEffect(() => {
    if (!sample || !practiceId || !sampleReady || (tutorialGuide.active && !guideDone)) return;
    finishedRef.current = true;
    startPractice({
      practiceId,
      rootId: practiceId,
      ordinal: 1,
      scene: sampleScene(),
      videoUri: sampleVideoUri(),
      playbackUrl: null,
    });
    onReadyRef.current();
  }, [guideDone, practiceId, sample, sampleReady, tutorialGuide.active]);

  /** 분석이 끝났다. 장면·재생 주소를 받아 대화를 연다. */
  const enterCoach = useCallback(
    async (analysis: 'ready' | 'partial' | null, signal: AbortSignal) => {
      if (!practiceId || finishedRef.current) return;
      const loaded = await api.getPractice(practiceId, { signal }).catch(() => null);
      if (!loaded || signal.aborted) {
        if (!signal.aborted) setError(t('analyzing.statusUnavailable'));
        return;
      }
      const localUri = loaded.video_id && !loaded.video_purged ? await localCopyFor(loaded.video_id).catch(() => null) : null;
      if (pendingHandleRef.current) {
        await pendingAnalysisStore.remove(pendingHandleRef.current).catch(() => undefined);
        pendingHandleRef.current = null;
      }
      const notice = analysis ? analysisPartialNotice(analysis) : null;
      if (notice) await alert({ title: t('analysis.partialTitle'), message: notice });
      if (signal.aborted) {
        return;
      }
      finishedRef.current = true;
      startPractice({
        practiceId,
        rootId: loaded.root_id ?? practiceId,
        ordinal: loaded.ordinal ?? 1,
        conversationId: loaded.conversation_id,
        scene: {
          situation: loaded.scene.situation ?? '',
          character: loaded.scene.character ?? '',
          goal: loaded.scene.goal ?? '',
        },
        videoUri: localUri ?? '',
        playbackUrl: loaded.playback_url ?? null,
      });
      // 말로 하는 회차는 분석을 하지 않았으므로 분석·광고 전환으로 집계하지 않는다.
      if (analysis && loaded.video_id) {
        void logEvent('analysis_complete', { analysis });
        logMetaEvent('practice_analysis_complete');
      }
      onReadyRef.current();
    },
    [alert, practiceId],
  );

  /** 상태를 읽기 시작한다. 이미 읽고 있으면 그것을 멈추고 지금 상태부터 다시 읽는다. */
  const run = useCallback(async () => {
    if (!practiceId || preview || sample || finishedRef.current) return;
    controllerRef.current?.abort();
    const controller = new AbortController();
    controllerRef.current = controller;
    setError(null);
    const outcome = await watchAnalysis(practiceId, controller.signal, {
      getStatus: (id, signal) => api.getPracticeStatus(id, { signal }),
      delay: (ms, signal) =>
        new Promise<void>((resolve, reject) => {
          const timer = setTimeout(resolve, ms);
          signal.addEventListener(
            'abort',
            () => {
              clearTimeout(timer);
              reject(signal.reason);
            },
            { once: true },
          );
        }),
      onStatus: setStatus,
    });
    if (controllerRef.current !== controller) return;
    if (outcome.kind === 'ready') {
      await enterCoach(outcome.analysis, controller.signal);
      return;
    }
    if (outcome.kind === 'failed') {
      void logEvent('analysis_failed', { reason: outcome.reason ?? 'unknown' });
      setError(analysisFailureMessage(outcome.reason));
      return;
    }
    if (outcome.kind === 'error') setError(t('analyzing.statusUnavailable'));
  }, [enterCoach, practiceId, preview, sample]);

  useEffect(() => {
    if (preview) {
      const seed = (require('@/lib/ui-preview') as typeof import('@/lib/ui-preview')).seedPreviewAnalyzing();
      setDetail(seed.detail);
      setVideoUri(previewVideoSource());
      return;
    }
    if (!practiceId) {
      router.replace('/upload');
      return;
    }
    if (sample) {
      // 예시는 서버에 회차가 없다 — 복구 기록도 남기지 않는다.
      setDetail(sampleDetail());
      setVideoUri(sampleVideoUri());
      return;
    }
    void api
      .getPractice(practiceId)
      .then(async (loaded) => {
        setDetail(loaded);
        const localUri = loaded.video_id && !loaded.video_purged ? await localCopyFor(loaded.video_id).catch(() => null) : null;
        setVideoUri(localUri ?? loaded.playback_url ?? null);
      })
      .catch(() => undefined);
    // 앱을 껐다 켜도 이 회차로 돌아온다(진행 중 회차는 하나다).
    if (user?.id) {
      void pendingAnalysisStore
        .save({ schemaVersion: 2, owner: user.id, practice_id: practiceId }, practiceId)
        .then((handle) => {
          pendingHandleRef.current = handle;
        })
        .catch(() => undefined);
    }
    return () => {
      controllerRef.current?.abort();
      controllerRef.current = null;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [practiceId]);

  // 화면을 떠나면 조회만 멈춘다(작업은 서버에서 계속 돈다). 돌아오면 기다리지 않고 다시 읽는다.
  useFocusEffect(
    useCallback(() => {
      void run();
      return () => {
        controllerRef.current?.abort();
      };
    }, [run]),
  );

  // 배경에서 돌아온 직후에도 다음 조회를 기다리지 않는다.
  useEffect(() => {
    const subscription = AppState.addEventListener('change', (next) => {
      if (next === 'active') void run();
    });
    return () => subscription.remove();
  }, [run]);

  // 완료 푸시가 오면 다음 조회(4초)를 기다리지 않고 바로 읽는다.
  useEffect(() => {
    if (!practiceId || preview) return;
    return onPushReceived((data) => {
      const target = analysisPushTarget(data);
      if (target?.practiceId === practiceId) void run();
    });
  }, [practiceId, preview, run]);

  useEffect(() => {
    if (error) return;
    const startedAt = Date.now();
    const timer = setInterval(() => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)), 1000);
    return () => clearInterval(timer);
  }, [error]);

  useEffect(() => {
    if (error) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 20_000);
    return () => clearInterval(timer);
  }, [error]);

  /** "그만두기" — 작업을 취소로 끝낸다. 영상은 그대로 두고 연습을 숨기지 않는다. */
  const stop = useCallback(async () => {
    if (!practiceId || stopping) return;
    if (sample) {
      finishTutorial('left');
      router.dismissTo('/(tabs)');
      return;
    }
    const ok = await confirm({
      title: t('analyzing.stopTitle'),
      message: t('analyzing.stopMsg'),
      cancelLabel: t('analyzing.stopCancel'),
      confirmLabel: t('analyzing.stopConfirm'),
      destructive: true,
    });
    if (!ok) return;
    setStopping(true);
    controllerRef.current?.abort();
    try {
      await cancelAnalysis(practiceId, (id) => api.cancelPractice(id));
      if (pendingHandleRef.current) {
        await pendingAnalysisStore.remove(pendingHandleRef.current).catch(() => undefined);
        pendingHandleRef.current = null;
      }
      finishedRef.current = true;
      void logEvent('analysis_cancelled', {});
      router.dismissTo('/(tabs)');
    } catch {
      setError(t('analyzing.stopFailed'));
    } finally {
      setStopping(false);
    }
  }, [confirm, practiceId, router, sample, stopping]);

  /** 실패한 회차를 다시 시도한다 — 새 작업이 생기고 stage 가 analyzing 으로 돌아간다. */
  const retry = useCallback(async () => {
    if (!practiceId || retrying) return;
    const recovery = analysisRecoveryAction(status);
    if (recovery === 'none') return;
    if (recovery === 'reload') {
      void run();
      return;
    }
    setRetrying(true);
    try {
      retryRequestId.current ??= newRequestId();
      await api.retryPracticeAnalysis(practiceId, { requestId: retryRequestId.current });
      retryRequestId.current = null;
      setStatus(null);
      void run();
    } catch (e) {
      const code = e !== null && typeof e === 'object' ? (e as { code?: string }).code : null;
      if (code === 'analysis_not_failed') {
        retryRequestId.current = null;
        void run();
      } else if (code === 'practice_in_progress') {
        const groups = await api.listPracticeGroups().catch(() => null);
        const open = groups ? inProgressPracticeId(groups.groups, detail?.root_id ?? practiceId) : null;
        if (open) router.replace({ pathname: '/coach', params: { practiceId: open } });
        else setError(t('start.inProgressBody'));
      } else if (code === 'guest_daily_analysis_limit') {
        setError(t('start.dailyLimit'));
      } else if (code === 'request_fingerprint_mismatch') {
        retryRequestId.current = null;
        setError(t('errors.requestChanged'));
      } else {
        setError(t('analyzing.retryFailed'));
      }
    } finally {
      setRetrying(false);
    }
  }, [detail?.root_id, practiceId, retrying, router, run, status]);

  const jobStatus = status?.job?.status ?? 'pending';
  const stageText = jobStatus === 'pending' && !sample ? t('analyzing.queued') : STAGES[stage];
  const elapsedText =
    elapsedSec < 60
      ? t('common.secElapsed', { sec: elapsedSec })
      : t('common.minSecElapsed', { min: Math.floor(elapsedSec / 60), sec: elapsedSec % 60 });
  const recovery = analysisRecoveryAction(status);

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      {/* 기다리는 동안은 장면·묶음 제목을 보이지 않는다 — 대화 화면의 대체 제목 그대로다. */}
      <Stack.Screen options={{ title: t('coach.fallbackTitle'), headerShadowVisible: false }} />
      <ScrollView contentContainerStyle={styles.body}>
        <CoachVideoRow
          open={sceneOpen}
          sub={t('coach.videoHint')}
          onPress={() => {
            if (!sceneOpen) logFoldOpen('analyzing');
            setSceneOpen((was) => !was);
          }}
        />
        <SceneFoldBody open={sceneOpen} videoUri={videoUri} track="analyzing" />

        {/* 코치 말풍선 자리에서 기다린다(pen 09 「질문 대화 · 영상 보는 중」). */}
        <View ref={progressTarget.ref} onLayout={progressTarget.onLayout}>
          <CoachMessage below={error ? null : <Text style={styles.elapsed}>{elapsedText}</Text>}>
            {error ? (
              <>
                <Text style={styles.errorTitle}>{t('analyzing.errorTitle')}</Text>
                <Text style={styles.errorBody}>
                  {error} {recovery !== 'none' ? t('analyzing.errorBody') : ''}
                </Text>
              </>
            ) : (
              <View style={styles.watchingBox} accessibilityLiveRegion="polite">
                <View style={styles.typingRow}>
                  <Text style={styles.watching}>{t('coach.watching')}</Text>
                </View>
                <Text style={styles.stageText}>{stageText}</Text>
              </View>
            )}
          </CoachMessage>
        </View>

        {error && (
          <View style={styles.errorActions}>
            {recovery !== 'none' && (
              <PrimaryButton label={t('common.retry')} phLabel="analyzing_retry" onPress={() => void retry()} loading={retrying} style={styles.wide} />
            )}
            <TextButton label={t('analyzing.leaveLater')} phLabel="analyzing_leave_later" onPress={() => router.dismissTo('/(tabs)')} />
          </View>
        )}
      </ScrollView>

      {/* 광고 칸(SOMA-876) — 연습 중 칸이라 무료 사용자 일부만 받는다. 아래 버튼 묶음 바로 위, 24 띄운다. */}
      {!error && !sample && <AdSlot slot="analyzing_wait" style={styles.ad} />}

      {/* 아래 바 — 안내 띠, 보조 글자 버튼 「그만두기」 위, 주 버튼 「끝나면 알려 주세요」 맨 아래. */}
      {!error && (
        <CtaBar safeBottom={false}>
          {sample ? (
            <Text style={styles.notice}>{t('tutorial.sampleAnalyzing')}</Text>
          ) : (
            <InfoBanner title={t('analyzing.leaveTitle')} body={t('analyzing.leaveBody')} style={styles.banner} />
          )}
          <TextButton
            label={stopping ? t('analyzing.cleaning') : t('analyzing.stopConfirm')}
            phLabel="analyzing_stop"
            disabled={stopping}
            onPress={() => void stop()}
          />
          {/* 분석은 서버에서 계속 돌고 끝나면 완료 푸시가 온다(account.notification) — 뒤로 가기와 같은 코칭 탭으로 나간다. */}
          {!sample && <PrimaryButton label={t('analyzing.notifyMe')} phLabel="analyzing_notify_me" onPress={leave} />}
        </CtaBar>
      )}
      {dialog}
      {tutorialGuide.element}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: space[4], paddingHorizontal: space[4], paddingBottom: space[5], gap: space[3] },
  wide: { alignSelf: 'stretch' },
  ad: { marginHorizontal: space.gutter, marginBottom: space[3] },
  banner: { marginBottom: space[2] },

  // 말풍선 안 — 「영상 보는 중이에요」 body1-bold, 아래 단계 문구 caption.
  watchingBox: { gap: space[1] },
  typingRow: { flexDirection: 'row', alignItems: 'center', gap: space[2] },
  watching: { ...type.body1Bold, color: palette.text },
  stageText: { ...type.caption, color: palette.textSub },
  elapsed: { ...type.caption, color: palette.textMeta },

  errorTitle: { ...type.body1Bold, color: palette.text },
  errorBody: { ...type.caption, color: palette.danger },
  errorActions: { alignItems: 'center', gap: space[2], paddingLeft: space[10] },

  notice: { ...type.caption, color: palette.textMeta, textAlign: 'center' },
});
