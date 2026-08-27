import { getInfoAsync } from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { type VideoSource } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
  AppState,
  BackHandler,
  Platform,
  Pressable,
  ScrollView,
  StyleSheet,
  Text,
  View,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { logEvent } from '@/lib/analytics';
import {
  AnalysisTerminalError,
  OperationInactiveError,
  abandonAnalysis,
  appAnalysisOperationOwner,
  runAnalysisPipeline,
  type AnalysisOperation,
  type AnalysisPendingHandle,
} from '@/lib/analysis-operation';
import { pendingAnalysisStore } from '@/lib/analysis-storage';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { markPracticedToday } from '@/lib/notifications';
import { formatSizeChange, startVideoCompression } from '@/lib/compress';
import { sceneValueForDisplay } from '@/lib/upload-input';
import { startPractice, takePendingUpload, type PendingUpload } from '@/lib/practice';
import { previewVideoSource } from '@/lib/preview-video';
import { palette } from '@/constants/palette';
import {
  PracticeFooter,
  ProgressRow,
  SceneFoldBody,
  SceneFoldLink,
  SceneSummary,
} from '@/components/practice-chrome';
import { translate as t, translateList } from '@/lib/i18n';

/** 경과 시간 기반 단계 문구로 기다림을 설계한다(실제 진행률은 서버가 주지 않음). */
const STAGES = translateList('analyzing.stages');

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

/**
 * 폴링 사이 대기. 백그라운드에서 얼었다가 포그라운드로 돌아오면 남은 대기를
 * 건너뛰고 즉시 다음 상태 확인으로 넘어간다 — 복귀하자마자 결과를 보여주기 위해.
 */
function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const finish = () => {
      cleanup();
      resolve();
    };
    const onAbort = () => {
      cleanup();
      reject(signal.reason);
    };
    const timer = setTimeout(finish, ms);
    const appState = AppState.addEventListener('change', (state) => {
      if (state === 'active') finish();
    });
    const cleanup = () => {
      clearTimeout(timer);
      appState.remove();
      signal.removeEventListener('abort', onAbort);
    };
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * A3. 분석 대기 — 압축 → 업로드(intent·PUT·complete) → 세션 생성 → 상태 폴링(analyzed까지).
 * 기다리는 동안 방금 올린 영상을 바로 볼 수 있게 로컬 원본을 재생한다.
 */
export default function AnalyzingScreen() {
  const router = useRouter();
  const { user } = useAuth();
  const { recoveryKey, sessionId: recoveredSessionId } = useLocalSearchParams<{
    recoveryKey?: string;
    sessionId?: string;
  }>();
  const activeOperationRef = useRef<AnalysisOperation | null>(null);
  const availabilityUnsubscribeRef = useRef<(() => void) | null>(null);
  const mountedRef = useRef(false);
  const runRef = useRef<(retryFailed?: boolean) => Promise<void>>(async () => undefined);
  const uploadRef = useRef<PendingUpload | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const pendingHandleRef = useRef<AnalysisPendingHandle | null>(null);
  const [stage, setStage] = useState(0);
  const [compressPct, setCompressPct] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sizeNote, setSizeNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  // VideoSource 인 건 개발 미리보기 때문이다 — 번들 샘플은 require() 로 들어와 숫자다.
  const [videoUri, setVideoUri] = useState<VideoSource | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  // 목업이 '1분 12초 경과'를 보여준다. 얼마나 기다렸는지 보이면 덜 불안하다.
  const [elapsedSec, setElapsedSec] = useState(0);
  // 개발 빌드에서 화면만 보려고 들어온 경우. 업로드·분석을 돌리지 않는다.
  // 훅은 조건 밖에서 부른다 — `__DEV__ &&` 를 앞에 두면 렌더마다 훅 순서가 달라진다.
  const params = useLocalSearchParams();
  const preview = __DEV__ && params.preview === '1';
  const [sceneOpen, setSceneOpen] = useState(false);
  /**
   * 화면에 보여줄 장면·막힌 곳.
   *
   * uploadRef 에서 바로 읽으면 안 된다 — ref 는 값이 바뀌어도 다시 그리지 않으므로,
   * 첫 렌더의 null 이 그대로 남아 '분석에 쓰는 내용' 이 끝까지 안 떴다.
   */
  const [sceneInfo, setSceneInfo] = useState<{
    scene: PendingUpload['scene'];
    blockage: PendingUpload['blockage'];
  } | null>(null);
  const { confirm, dialog } = useAppDialog();

  const run = useCallback(async (retryFailed = false) => {
    const operation = appAnalysisOperationOwner.start();
    if (!operation) {
      if (activeOperationRef.current || availabilityUnsubscribeRef.current) return;
      const unsubscribe = appAnalysisOperationOwner.onAvailable(() => {
        unsubscribe();
        if (availabilityUnsubscribeRef.current === unsubscribe) {
          availabilityUnsubscribeRef.current = null;
        }
        if (mountedRef.current) void runRef.current(retryFailed);
      });
      availabilityUnsubscribeRef.current = unsubscribe;
      return;
    }
    availabilityUnsubscribeRef.current?.();
    availabilityUnsubscribeRef.current = null;
    activeOperationRef.current = operation;
    const upload = uploadRef.current;
    const ownerId = user?.id;
    if (!ownerId) {
      appAnalysisOperationOwner.finish(operation);
      activeOperationRef.current = null;
      setError(t('analyzing.loginLost'));
      return;
    }
    operation.runIfActive(() => {
      setError(null);
      setStage(0);
      setUploading(false);
      logEvent('analysis_start', {});
      // 연습이 실제로 일어난 시점 — "마지막 연습 + 3일" 리마인드를 다시 건다.
      void markPracticedToday();
    });

    try {
      const result = await runAnalysisPipeline({
        operation,
        ownerId,
        upload,
        recovered: pendingHandleRef.current,
        existingSessionId: sessionIdRef.current,
        retryFailed,
        dependencies: {
          compress: async (pendingUpload, currentOperation) => {
            currentOperation.runIfActive(() => setCompressPct(0));
            const compression = startVideoCompression(
              pendingUpload.video.uri,
              (percent) => currentOperation.runIfActive(() => setCompressPct(percent)),
            );
            currentOperation.attachCompressionCancel(compression.cancel);
            const compressed = await compression.result;
            if (compressed.kind === 'cancelled') return compressed;
            currentOperation.runIfActive(() => {
              setCompressPct(null);
              setSizeNote(formatSizeChange(compressed));
            });
            return compressed;
          },
          getFileSize: async (uri) => {
            const info = await getInfoAsync(uri);
            return info.exists && typeof info.size === 'number' ? info.size : 0;
          },
          createUploadIntent: (input, signal) => {
            operation.runIfActive(() => setUploading(true));
            return api.createUploadIntent(input, { signal });
          },
          uploadToUrl: async (uploadUrl, fileUri, mimeType, currentOperation) => {
            const uploadTask = api.startUploadToUrl(uploadUrl, fileUri, mimeType);
            currentOperation.attachUploadCancel(uploadTask.cancel);
            return uploadTask.result;
          },
          completeUpload: async (intentId, signal) => {
            await api.completeUpload(intentId, { signal });
          },
          createPracticeSession: async (input, signal) => {
            const created = await api.createPracticeSession(input, { signal });
            operation.runIfActive(() => setUploading(false));
            return created;
          },
          getStatus: (currentSessionId, signal) =>
            api.getPracticeSessionStatus(currentSessionId, { signal }),
          reanalyze: (currentSessionId, signal) =>
            api.reanalyze(currentSessionId, { signal }),
          getDetail: (currentSessionId, signal) =>
            api.getPracticeSession(currentSessionId, { signal }),
          savePending: pendingAnalysisStore.save,
          removePending: pendingAnalysisStore.remove,
          delay: abortableDelay,
          now: () => Date.now(),
          pollIntervalMs: POLL_INTERVAL_MS,
          pollTimeoutMs: POLL_TIMEOUT_MS,
        },
      });
      operation.runIfActive(() => {
        sessionIdRef.current = result.sessionId;
        pendingHandleRef.current = operation.pendingHandle;
        const detail = result.detail;
        // 복구 경로의 장면은 서버에서 온다 — 건너뛴 칸의 자리표시자('.')를 빈 값으로 되돌린다.
        const scene = upload?.scene ?? {
          situation: sceneValueForDisplay(detail.situation),
          character: sceneValueForDisplay(detail.character_context),
          goal: sceneValueForDisplay(detail.goal),
        };
        const playbackUrl = detail.playback_url ?? null;
        startPractice({
          practiceSessionId: result.sessionId,
          scene,
          videoUri: upload?.video.uri ?? playbackUrl ?? '',
          playbackUrl,
        });
        logEvent('analysis_complete', {});
        router.replace('/coach');
      });
      appAnalysisOperationOwner.finish(operation);
      if (activeOperationRef.current === operation) activeOperationRef.current = null;
    } catch (err) {
      if (!operation.isActive() || err instanceof OperationInactiveError) return;
      operation.runIfActive(() => {
        sessionIdRef.current = operation.sessionId;
        pendingHandleRef.current = operation.pendingHandle;
        setCompressPct(null);
        setUploading(false);
        const message = err instanceof Error ? err.message : t('analyzing.failed');
        logEvent('analysis_failed', { reason: message.slice(0, 90) });
        setError(message);
      });
      appAnalysisOperationOwner.finish(operation);
      if (activeOperationRef.current === operation) activeOperationRef.current = null;
    }
  }, [router, user?.id]);
  runRef.current = run;

  useEffect(() => {
    let mounted = true;
    mountedRef.current = true;
    const initialize = async () => {
      if (recoveryKey && recoveredSessionId && user?.id) {
        const recovered = await pendingAnalysisStore.loadForOwner(user.id).catch(() => null);
        if (!mounted) return;
        if (
          recovered &&
          recovered.key === recoveryKey &&
          recovered.record.session_id === recoveredSessionId
        ) {
          pendingHandleRef.current = recovered;
          sessionIdRef.current = recovered.record.session_id;
          setVideoUri(null);
          await run(false);
          return;
        }
      }
      // 개발 미리보기로 곧장 들어오면(딥링크) 대기물이 없다. 그때만 가짜로 채운다.
      if (preview) {
        const seed = (
          require('@/lib/ui-preview') as typeof import('@/lib/ui-preview')
        ).seedPreviewAnalyzing();
        setVideoUri(previewVideoSource(true));
        setSceneInfo({ scene: seed.scene, blockage: seed.blockage });
        return;
      }
      const pendingUpload = takePendingUpload();
      uploadRef.current = pendingUpload;
      if (!pendingUpload) {
        router.replace('/upload');
        return;
      }
      setVideoUri(pendingUpload.video.uri);
      setSceneInfo({ scene: pendingUpload.scene, blockage: pendingUpload.blockage });
      await run(false);
    };
    void initialize();
    return () => {
      mounted = false;
      mountedRef.current = false;
      availabilityUnsubscribeRef.current?.();
      availabilityUnsubscribeRef.current = null;
      const activeOperation = activeOperationRef.current;
      if (activeOperation) void appAnalysisOperationOwner.leave(activeOperation);
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const abandon = useCallback(async () => {
    if (abandoning) return;
    setAbandoning(true);
    try {
      await abandonAnalysis(sessionIdRef.current, pendingHandleRef.current, {
        deleteSession: api.deletePracticeSession,
        removePending: pendingAnalysisStore.remove,
      });
      sessionIdRef.current = null;
      pendingHandleRef.current = null;
      uploadRef.current = null;
      router.replace('/upload');
    } catch (err) {
      setError(
        err instanceof AnalysisTerminalError || err instanceof Error
          ? err.message
          : t('analyzing.organizeFail'),
      );
    } finally {
      setAbandoning(false);
    }
  }, [abandoning, router]);

  /**
   * 안드로이드 하드웨어 뒤로가기로 조용히 빠져나가면 압축·업로드가 통째로 날아간다.
   * (iOS는 headerBackVisible·gestureEnabled를 이미 막아뒀다.)
   */
  const confirmLeave = useCallback(async () => {
    const leave = await confirm({
      title: t('analyzing.stopTitle'),
      message: t('analyzing.stopMsg'),
      cancelLabel: t('analyzing.stopCancel'),
      confirmLabel: t('analyzing.stopConfirm'),
      destructive: true,
    });
    if (leave) void abandon();
  }, [abandon, confirm]);

  useEffect(() => {
    if (Platform.OS !== 'android' || error) return;
    const subscription = BackHandler.addEventListener('hardwareBackPress', () => {
      void confirmLeave();
      return true; // 기본 뒤로가기를 막는다
    });
    return () => subscription.remove();
  }, [confirmLeave, error]);

  useEffect(() => {
    if (error) return;
    const startedAt = Date.now();
    const timer = setInterval(
      () => setElapsedSec(Math.floor((Date.now() - startedAt) / 1000)),
      1000,
    );
    return () => clearInterval(timer);
  }, [error]);

  // 압축/업로드 중이 아닐 때만 단계 문구를 진행시킨다.
  useEffect(() => {
    if (error || compressPct !== null || uploading) return;
    const timer = setInterval(() => setStage((s) => Math.min(s + 1, STAGES.length - 1)), 20_000);
    return () => clearInterval(timer);
  }, [error, compressPct, uploading]);

  const stageText =
    compressPct !== null
      ? t('analyzing.compressing', { pct: compressPct })
      : uploading
        ? t('analyzing.uploadingVideo')
        : STAGES[stage];

  const scene = sceneInfo?.scene ?? null;
  const blockage = sceneInfo?.blockage ?? null;
  const elapsedText =
    elapsedSec < 60
      ? t('common.secElapsed', { sec: elapsedSec })
      : t('common.minSecElapsed', { min: Math.floor(elapsedSec / 60), sec: elapsedSec % 60 });

  return (
    // edges 를 아래로 한정한다 — 위는 네비게이션 헤더가 이미 인셋을 먹었고, 기본값
    // (전체)으로 두면 헤더 아래에 노치만큼 빈 칸이 한 번 더 생긴다.
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen
        options={{
          title: t('analyzing.screenTitle'),
          headerBackVisible: false,
          gestureEnabled: false,
          headerShadowVisible: false,
        }}
      />
      <ProgressRow
        label={error ? t('analyzing.stepError') : t('analyzing.stepLoading')}
        right={
          <SceneFoldLink
            open={sceneOpen}
            onToggle={() => setSceneOpen((was) => !was)}
            label={t('blockage.sceneFold')}
          />
        }
      />
      <SceneFoldBody open={sceneOpen} videoUri={videoUri} />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>{t('analyzing.errorTitle')}</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>{t('analyzing.errorBody')}</Text>
            <Pressable style={styles.retry} onPress={() => void run(true)}>
              <Text style={styles.retryText}>{t('common.retry')}</Text>
            </Pressable>
            <Pressable onPress={() => void abandon()} disabled={abandoning}>
              <Text style={styles.backLink}>
                {abandoning ? t('analyzing.cleaning') : t('analyzing.repickVideo')}
              </Text>
            </Pressable>
          </View>
        ) : (
          <>
            <View style={styles.progressBlock}>
              <ActivityIndicator size="large" color={palette.blue} />
              <Text style={styles.stageText}>{stageText}</Text>
              <Text style={styles.elapsed}>{elapsedText}</Text>
              {sizeNote && <Text style={styles.sizeNote}>{sizeNote}</Text>}
              <Text style={styles.notice}>
                {compressPct !== null || uploading
                  ? t('analyzing.keepScreenOn')
                  : t('analyzing.canClose')}
              </Text>
            </View>

            {scene && (
              <SceneSummary
                title={t('analyzing.whatWeUse')}
                scene={scene}
                blockage={
                  blockage && {
                    kind: `${t(`blockage.kindLabel.${blockage.blockage_kind}`)}${
                      blockage.sub_branch && blockage.sub_branch !== blockage.blockage_kind
                        ? ` › ${t(`blockage.kindLabel.${blockage.sub_branch}`)}`
                        : ''
                    }`,
                    detail: blockage.blockage_detail,
                  }
                }
              />
            )}
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
  stageText: {
    fontSize: 20,
    fontWeight: '900',
    color: palette.text,
    textAlign: 'center',
  },
  elapsed: { fontSize: 12, fontWeight: '600', color: palette.textFaint },
  sizeNote: { fontSize: 12, fontWeight: '700', color: palette.green },
  notice: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.textFaint,
    textAlign: 'center',
    lineHeight: 21,
  },

  errorBlock: { alignItems: 'center', gap: 12, paddingTop: 26 },
  errorTitle: { fontSize: 20, fontWeight: '900', color: palette.text },
  errorBody: {
    fontSize: 13.5,
    fontWeight: '600',
    color: palette.danger,
    textAlign: 'center',
    lineHeight: 22,
  },
  errorHint: {
    fontSize: 12.5,
    fontWeight: '600',
    color: palette.textFaint,
    textAlign: 'center',
  },
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
