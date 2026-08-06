import { getInfoAsync } from 'expo-file-system/legacy';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ActivityIndicator,
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
import { formatSizeChange, startVideoCompression } from '@/lib/compress';
import { startPractice, takePendingUpload, type PendingUpload } from '@/lib/practice';
import { palette } from '@/constants/palette';
import { PracticeFooter, ProgressRow, SceneFold, SceneSummary } from '@/components/practice-chrome';

/** 경과 시간 기반 단계 문구로 기다림을 설계한다(실제 진행률은 서버가 주지 않음). */
const STAGES = [
  '장면을 처음부터 끝까지 보고 있어요…',
  '대사·템포·움직임·표정을 뜯어보는 중…',
  '의도와 견주어 보는 중이에요…',
  '거의 다 됐어요. 정리하고 있어요…',
];

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  if (signal.aborted) return Promise.reject(signal.reason);
  return new Promise((resolve, reject) => {
    const timer = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    const onAbort = () => {
      clearTimeout(timer);
      signal.removeEventListener('abort', onAbort);
      reject(signal.reason);
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
  const [videoUri, setVideoUri] = useState<string | null>(null);
  const [abandoning, setAbandoning] = useState(false);
  // 목업이 '1분 12초 경과'를 보여준다. 얼마나 기다렸는지 보이면 덜 불안하다.
  const [elapsedSec, setElapsedSec] = useState(0);
  const { confirm, dialog } = useAppDialog();

  // 방금 올린 로컬 원본을 대기 중 재생 (서버 업로드본·압축본이 아니라 원본).
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = true;
  });

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
      setError('로그인 정보를 불러오지 못했어요. 다시 로그인해주세요.');
      return;
    }
    operation.runIfActive(() => {
      setError(null);
      setStage(0);
      setUploading(false);
      logEvent('analysis_start', {});
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
        const scene = upload?.scene ?? {
          situation: detail.situation,
          character: detail.character_context,
          goal: detail.goal,
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
        const message = err instanceof Error ? err.message : '분석에 실패했어요.';
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
      const pendingUpload = takePendingUpload();
      uploadRef.current = pendingUpload;
      if (!pendingUpload) {
        router.replace('/upload');
        return;
      }
      setVideoUri(pendingUpload.video.uri);
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
          : '분석을 정리하지 못했어요. 다시 시도해주세요.',
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
      title: '분석을 중단할까요?',
      message: '지금 나가면 올린 영상과 분석이 사라져요.',
      cancelLabel: '계속 기다리기',
      confirmLabel: '중단하고 나가기',
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
      ? `영상을 가볍게 줄이는 중… ${compressPct}%`
      : uploading
        ? '영상을 올리는 중이에요…'
        : STAGES[stage];

  const scene = uploadRef.current?.scene ?? null;
  const blockage = uploadRef.current?.blockage ?? null;
  const elapsedText =
    elapsedSec < 60
      ? `${elapsedSec}초 경과`
      : `${Math.floor(elapsedSec / 60)}분 ${elapsedSec % 60}초 경과`;

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen
        options={{
          title: '새 연습',
          headerBackVisible: false,
          gestureEnabled: false,
          headerShadowVisible: false,
        }}
      />
      <ProgressRow
        label={error ? '3단계 · 질문 준비' : '3단계 · 질문 준비 중'}
        right={<SceneFold videoUri={videoUri} scene={scene} blockage={blockage && {
          kind: `${blockage.blockage_kind}${blockage.sub_branch && blockage.sub_branch !== blockage.blockage_kind ? ` › ${blockage.sub_branch}` : ''}`,
          detail: blockage.blockage_detail,
        }} />}
      />
      <ScrollView contentContainerStyle={styles.body}>
        {error ? (
          <View style={styles.errorBlock}>
            <Text style={styles.errorTitle}>분석이 잘 안 됐어요</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>
              올려주신 영상은 그대로 있으니 다시 시도해볼 수 있어요.
            </Text>
            <Pressable style={styles.retry} onPress={() => void run(true)}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
            <Pressable onPress={() => void abandon()} disabled={abandoning}>
              <Text style={styles.backLink}>
                {abandoning ? '정리하는 중…' : '영상 다시 선택하기'}
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
                끝날 때까지 이 화면을 켜 둔 채로 기다려 주세요. 지금 나가면 올린 영상과
                분석이 사라져요.
              </Text>
            </View>

            {scene && (
              <SceneSummary
                title="분석에 쓰는 내용"
                scene={scene}
                blockage={
                  blockage && {
                    kind: `${blockage.blockage_kind}${
                      blockage.sub_branch && blockage.sub_branch !== blockage.blockage_kind
                        ? ` › ${blockage.sub_branch}`
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
