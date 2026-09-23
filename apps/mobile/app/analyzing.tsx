import { Stack, useFocusEffect, useLocalSearchParams, useRouter } from 'expo-router';
import { type VideoSource } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, AppState, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { PracticeFooter, ProgressRow, SceneFoldBody, SceneFoldLink, SceneSummary } from '@/components/practice-chrome';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { translate as t, translateList } from '@/lib/i18n';
import { localCopyFor } from '@/lib/library/library-runner';
import { logMetaEvent } from '@/lib/meta-events';
import { markPracticedToday, onPushReceived } from '@/lib/notifications';
import type { PendingAnalysisHandle } from '@/lib/pending-analysis';
import {
  analysisFailureMessage,
  analysisRecoveryAction,
  analysisPartialNotice,
  analysisPushTarget,
  cancelAnalysis,
  watchAnalysis,
} from '@/lib/practice/analysis-run';
import { startPractice } from '@/lib/practice/session-state';
import { inProgressPracticeId } from '@/lib/practice/start';
import type { PracticeDetail, PracticeStatus } from '@/lib/practice/types';
import { previewVideoSource } from '@/lib/preview-video';
import { newRequestId } from '@/lib/request-id';

/** 경과 시간 기반 단계 문구로 기다림을 설계한다(실제 진행률은 서버가 주지 않는다). */
const STAGES = translateList('analyzing.stages');

/**
 * A10 분석 진행(practice.analyze).
 *
 * 영상은 이미 보관함에 있고(practice.record) 회차도 만들어져 있다 — 이 화면은 회차 상태를
 * 4초마다 읽기만 한다. 화면을 떠나면 조회만 멈추고 작업은 서버에서 계속 돈다. 돌아오면
 * 기다리지 않고 서버 상태부터 읽는다. 완료 푸시가 오면 다음 조회를 기다리지 않는다.
 * "그만두기"는 작업 취소이고 연습을 숨기지 않는다.
 */
export default function AnalyzingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const params = useLocalSearchParams<{ practiceId?: string; recoveryKey?: string; preview?: string }>();
  const practiceId = typeof params.practiceId === 'string' ? params.practiceId : null;
  const preview = __DEV__ && params.preview === '1';
  const { confirm, alert, dialog } = useAppDialog();

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

  /** 분석이 끝났다. 장면·재생 주소를 받아 대화로 넘긴다. */
  const enterCoach = useCallback(
    async (analysis: 'ready' | 'partial', signal: AbortSignal) => {
      if (!practiceId || finishedRef.current) return;
      const loaded = await api.getPractice(practiceId, { signal }).catch(() => null);
      if (!loaded || signal.aborted) {
        if (!signal.aborted) setError(t('analyzing.statusUnavailable'));
        return;
      }
      const localUri = loaded?.video_id && !loaded.video_purged ? await localCopyFor(loaded.video_id).catch(() => null) : null;
      if (pendingHandleRef.current) {
        await pendingAnalysisStore.remove(pendingHandleRef.current).catch(() => undefined);
        pendingHandleRef.current = null;
      }
      const notice = analysisPartialNotice(analysis);
      if (notice) await alert({ title: t('analyzing.screenTitle'), message: notice });
      if (signal.aborted) {
        return;
      }
      finishedRef.current = true;
      startPractice({
        practiceId,
        rootId: loaded?.root_id ?? practiceId,
        ordinal: loaded?.ordinal ?? 1,
        conversationId: loaded?.conversation_id,
        scene: {
          situation: loaded?.scene.situation ?? '',
          character: loaded?.scene.character ?? '',
          goal: loaded?.scene.goal ?? '',
        },
        videoUri: localUri ?? '',
        playbackUrl: loaded?.playback_url ?? null,
      });
      logEvent('analysis_complete', { analysis });
      logMetaEvent('practice_analysis_complete');
      router.replace('/coach');
    },
    [alert, practiceId, router],
  );

  /** 상태를 읽기 시작한다. 이미 읽고 있으면 그것을 멈추고 지금 상태부터 다시 읽는다. */
  const run = useCallback(async () => {
    if (!practiceId || preview || finishedRef.current) return;
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
      logEvent('analysis_failed', { reason: outcome.reason ?? 'unknown' });
      setError(analysisFailureMessage(outcome.reason));
      return;
    }
    if (outcome.kind === 'error') setError(t('analyzing.statusUnavailable'));
  }, [enterCoach, practiceId, preview]);

  useEffect(() => {
    if (preview) {
      const seed = (require('@/lib/ui-preview') as typeof import('@/lib/ui-preview')).seedPreviewAnalyzing();
      setDetail(seed.detail);
      setVideoUri(previewVideoSource(true));
      return;
    }
    if (!practiceId) {
      router.replace('/upload');
      return;
    }
    void markPracticedToday();
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

  /** "그만두기" — 작업을 취소로 끝낸다. 영상은 보관함에 그대로 있고 연습을 숨기지 않는다. */
  const stop = useCallback(async () => {
    if (!practiceId || stopping) return;
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
      logEvent('analysis_cancelled', {});
      router.replace('/(tabs)');
    } catch {
      setError(t('analyzing.stopFailed'));
    } finally {
      setStopping(false);
    }
  }, [confirm, practiceId, router, stopping]);

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
        if (open) router.replace({ pathname: '/analyzing', params: { practiceId: open } });
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
  const stageText = jobStatus === 'pending' ? t('analyzing.queued') : STAGES[stage];
  const elapsedText =
    elapsedSec < 60
      ? t('common.secElapsed', { sec: elapsedSec })
      : t('common.minSecElapsed', { min: Math.floor(elapsedSec / 60), sec: elapsedSec % 60 });

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ title: t('analyzing.screenTitle'), headerShadowVisible: false }} />
      <ProgressRow
        label={error ? t('analyzing.stepError') : t('analyzing.stepLoading')}
        right={<SceneFoldLink open={sceneOpen} onToggle={() => setSceneOpen((was) => !was)} label={t('blockage.sceneFold')} />}
      />
      <SceneFoldBody open={sceneOpen} videoUri={videoUri} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>{t('analyzing.errorTitle')}</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>{t('analyzing.errorBody')}</Text>
            {analysisRecoveryAction(status) !== 'none' && (
              <Pressable style={styles.retry} onPress={() => void retry()} disabled={retrying}>
                {retrying ? <ActivityIndicator color={palette.bg} /> : <Text style={styles.retryText}>{t('common.retry')}</Text>}
              </Pressable>
            )}
            <Pressable onPress={() => router.replace('/(tabs)')}>
              <Text style={styles.backLink}>{t('analyzing.leaveLater')}</Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.progressBlock}>
              <ActivityIndicator size="large" color={palette.blue} />
              <Text style={styles.stageText}>{stageText}</Text>
              <Text style={styles.elapsed}>{elapsedText}</Text>
              <Text style={styles.notice}>{t('analyzing.canClose')}</Text>
            </View>

            {detail && (
              <SceneSummary
                title={t('analyzing.whatWeUse')}
                scene={{
                  situation: detail.scene.situation,
                  character: detail.scene.character,
                  goal: detail.scene.goal,
                }}
                blockage={{
                  kind: t(`blockage.helpLabel.${detail.blockage.category}`),
                  detail: detail.blockage.note,
                }}
              />
            )}

            <Pressable onPress={() => void stop()} disabled={stopping}>
              <Text style={styles.stopLink}>{stopping ? t('analyzing.cleaning') : t('analyzing.stopConfirm')}</Text>
            </Pressable>
          </>
        )}
        <PracticeFooter />
      </ScrollView>
      {dialog}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  body: { paddingTop: 28, paddingHorizontal: 20, paddingBottom: 20, gap: 24 },

  progressBlock: { alignItems: 'center', gap: 14, paddingTop: 26, paddingBottom: 10 },
  stageText: { fontSize: 20, fontWeight: '900', color: palette.text, textAlign: 'center' },
  elapsed: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  notice: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, textAlign: 'center', lineHeight: 21 },
  stopLink: { color: palette.textFaint, fontSize: 12.5, fontWeight: '700', textAlign: 'center' },

  errorBlock: { alignItems: 'center', gap: 12, paddingTop: 26 },
  errorTitle: { fontSize: 20, fontWeight: '900', color: palette.text },
  errorBody: { fontSize: 13.5, fontWeight: '600', color: palette.danger, textAlign: 'center', lineHeight: 22 },
  errorHint: { fontSize: 12.5, fontWeight: '600', color: palette.textFaint, textAlign: 'center' },
  retry: {
    height: 52,
    alignSelf: 'stretch',
    borderRadius: 14,
    backgroundColor: palette.blue,
    alignItems: 'center',
    justifyContent: 'center',
    marginTop: 8,
  },
  retryText: { color: palette.bg, fontSize: 15, fontWeight: '900' },
  backLink: { color: palette.textFaint, fontSize: 12.5, fontWeight: '700', marginTop: 6 },
});
