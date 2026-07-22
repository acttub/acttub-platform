import { getInfoAsync } from 'expo-file-system/legacy';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { logEvent } from '@/lib/analytics';
import { api, type PracticeSessionDetail } from '@/lib/api';
import { compressVideo, formatSizeChange } from '@/lib/compress';
import { startPractice, takePendingUpload, type PendingUpload } from '@/lib/practice';
import { palette } from '@/constants/palette';

/** 경과 시간 기반 단계 문구로 기다림을 설계한다(실제 진행률은 서버가 주지 않음). */
const STAGES = [
  '장면을 처음부터 끝까지 보고 있어요…',
  '대사·템포·움직임·표정을 뜯어보는 중…',
  '의도와 견주어 보는 중이에요…',
  '거의 다 됐어요. 정리하고 있어요…',
];

const POLL_INTERVAL_MS = 4_000;
const POLL_TIMEOUT_MS = 10 * 60 * 1000;

function errorMessage(code: PracticeSessionDetail['error_code']): string {
  switch (code) {
    case 'gemini_timeout':
    case 'max_attempts_exceeded':
      return '분석 시간이 초과됐어요. 영상을 더 짧게 잘라서 다시 시도해주세요.';
    case 'unsupported_media':
      return '지원하지 않는 영상 형식이에요. mp4로 다시 올려주세요.';
    case 'gemini_parse_error':
      return '분석 결과를 정리하지 못했어요. 다시 시도해주세요.';
    default:
      return '분석에 실패했어요. 다시 시도해주세요.';
  }
}

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));

/**
 * A3. 분석 대기 — 압축 → 업로드(intent·PUT·complete) → 세션 생성 → 상태 폴링(analyzed까지).
 * 기다리는 동안 방금 올린 영상을 바로 볼 수 있게 로컬 원본을 재생한다.
 */
export default function AnalyzingScreen() {
  const router = useRouter();
  const uploadRef = useRef<PendingUpload | null>(null);
  const sessionIdRef = useRef<string | null>(null);
  const cancelledRef = useRef(false);
  const [stage, setStage] = useState(0);
  const [compressPct, setCompressPct] = useState<number | null>(null);
  const [uploading, setUploading] = useState(false);
  const [sizeNote, setSizeNote] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [videoUri, setVideoUri] = useState<string | null>(null);

  // 방금 올린 로컬 원본을 대기 중 재생 (서버 업로드본·압축본이 아니라 원본).
  const player = useVideoPlayer(videoUri, (p) => {
    p.loop = true;
  });

  const pollUntilDone = useCallback(async (sessionId: string): Promise<PracticeSessionDetail> => {
    const deadline = Date.now() + POLL_TIMEOUT_MS;
    while (Date.now() < deadline) {
      if (cancelledRef.current) throw new Error('cancelled');
      const status = await api.getPracticeSessionStatus(sessionId);
      // 요청 도중 화면을 떠났으면 여기서 멈춘다 — 아래 detail 조회·startPractice(전역 상태 변경)로
      // 이어지지 않게. (인플라이트 요청 자체 취소는 별도 과제)
      if (cancelledRef.current) throw new Error('cancelled');
      if (status.status === 'failed') throw new Error(errorMessage(status.error_code));
      if (status.status === 'analyzed') {
        const detail = await api.getPracticeSession(sessionId);
        if (cancelledRef.current) throw new Error('cancelled');
        return detail;
      }
      await sleep(POLL_INTERVAL_MS);
    }
    throw new Error('분석이 예상보다 오래 걸려요. 잠시 후 기록에서 다시 확인해주세요.');
  }, []);

  const run = useCallback(async () => {
    const upload = uploadRef.current;
    if (!upload) return;
    setError(null);
    setStage(0);
    logEvent('analysis_start', {});

    try {
      // 이미 세션이 있으면(재시도) 업로드를 건너뛰고 재분석만 트리거한다.
      let sessionId = sessionIdRef.current;
      if (sessionId) {
        setUploading(false);
        await api.reanalyze(sessionId);
      } else {
        // 1) 압축
        setCompressPct(0);
        const compressed = await compressVideo(upload.video.uri, setCompressPct);
        setCompressPct(null);
        setSizeNote(formatSizeChange(compressed));
        const uploadUri = compressed.uri;
        const mime = compressed.uri === upload.video.uri ? upload.video.mimeType : 'video/mp4';
        const info = await getInfoAsync(uploadUri);
        const sizeBytes =
          compressed.compressedBytes ??
          (info.exists && typeof info.size === 'number' ? info.size : 0);

        // 2) 업로드 intent → presigned PUT → complete
        setUploading(true);
        const intent = await api.createUploadIntent({
          mime_type: mime,
          size_bytes: sizeBytes,
          duration_ms: upload.durationMs,
        });
        await api.putToUploadUrl(intent.upload_url, uploadUri, mime);
        await api.completeUpload(intent.intent_id);
        setUploading(false);

        // 3) 연습 세션 생성 (분석 자동 시작)
        const created = await api.createPracticeSession({
          upload_intent_id: intent.intent_id,
          subtext: upload.subtext,
        });
        sessionId = created.session_id;
        sessionIdRef.current = sessionId;
      }

      // 4) analyzed까지 폴링
      const detail = await pollUntilDone(sessionId);
      const summaryId = detail.summary?.summary_id;
      if (!summaryId) throw new Error('분석 결과를 불러오지 못했어요. 다시 시도해주세요.');

      // 재생용으로는 서버 업로드본이 아닌 로컬 원본 uri를 남긴다.
      startPractice({
        practiceSessionId: sessionId,
        summaryId,
        subtext: upload.subtext,
        videoUri: upload.video.uri,
        playbackUrl: detail.playback_url ?? null,
      });
      logEvent('analysis_complete', {});
      if (!cancelledRef.current) router.replace('/coach');
    } catch (err) {
      if (cancelledRef.current || (err instanceof Error && err.message === 'cancelled')) return;
      setCompressPct(null);
      setUploading(false);
      const message = err instanceof Error ? err.message : '분석에 실패했어요.';
      logEvent('analysis_failed', { reason: message.slice(0, 90) });
      setError(message);
    }
  }, [pollUntilDone, router]);

  useEffect(() => {
    cancelledRef.current = false;
    const p = takePendingUpload();
    uploadRef.current = p;
    if (!p) {
      router.replace('/upload');
      return;
    }
    setVideoUri(p.video.uri);
    run();
    return () => {
      cancelledRef.current = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

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

  return (
    <SafeAreaView style={styles.safe}>
      <Stack.Screen
        options={{
          title: '분석 중',
          headerBackVisible: false,
          gestureEnabled: false,
          headerStyle: { backgroundColor: palette.navy },
          headerTintColor: '#FFFFFF',
          headerShadowVisible: false,
        }}
      />
      {videoUri && !error && (
        <VideoView style={styles.video} player={player} nativeControls contentFit="contain" />
      )}
      <ScrollView contentContainerStyle={styles.center}>
        {error ? (
          <>
            <Text style={styles.errorTitle}>분석이 잘 안 됐어요</Text>
            <Text style={styles.errorBody}>{error}</Text>
            <Text style={styles.errorHint}>올려주신 영상은 그대로 있으니 다시 시도해볼 수 있어요.</Text>
            <Pressable style={styles.retry} onPress={run}>
              <Text style={styles.retryText}>다시 시도</Text>
            </Pressable>
            <Pressable onPress={() => router.replace('/upload')}>
              <Text style={styles.backLink}>영상 다시 선택하기</Text>
            </Pressable>
          </>
        ) : (
          <>
            <ActivityIndicator size="large" color={palette.blue} />
            <Text style={styles.stageText}>{stageText}</Text>
            {sizeNote && <Text style={styles.sizeNote}>📦 {sizeNote}</Text>}
            <Text style={styles.eta}>
              보통 1~3분 정도 걸려요. 기다리는 동안 방금 찍은 영상을 다시 봐도 좋아요.
            </Text>
            <View style={styles.tipBox}>
              <Text style={styles.tipTitle}>기다리는 동안</Text>
              <Text style={styles.tipBody}>
                분석이 끝나면 코치가 먼저 말을 걸어요. 점수나 판정이 아니라, 그 장면에서 뭘 하려
                했는지 함께 되짚는 대화예요.
              </Text>
            </View>
          </>
        )}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.navy },
  center: { flexGrow: 1, justifyContent: 'center', alignItems: 'center', padding: 24, gap: 14 },
  video: {
    width: '100%',
    aspectRatio: 16 / 9,
    backgroundColor: '#111827',
  },
  stageText: { fontSize: 17, fontWeight: '700', color: '#FFFFFF', textAlign: 'center', marginTop: 8 },
  sizeNote: {
    fontSize: 13,
    fontWeight: '700',
    color: '#4ADE9E',
    backgroundColor: 'rgba(255,255,255,0.08)',
    borderRadius: 8,
    paddingHorizontal: 10,
    paddingVertical: 5,
    overflow: 'hidden',
  },
  eta: { fontSize: 13, color: '#9FB0C9', textAlign: 'center', lineHeight: 19 },
  tipBox: { backgroundColor: 'rgba(255,255,255,0.08)', borderRadius: 14, padding: 16, marginTop: 24 },
  tipTitle: { fontSize: 12, fontWeight: '700', color: '#8FA5FF', marginBottom: 6 },
  tipBody: { fontSize: 13, color: '#C6D0E2', lineHeight: 20 },
  errorTitle: { fontSize: 18, fontWeight: '700', color: '#FFFFFF' },
  errorBody: { fontSize: 14, color: '#FF8A8E', textAlign: 'center', lineHeight: 20 },
  errorHint: { fontSize: 13, color: '#9FB0C9', textAlign: 'center' },
  retry: {
    backgroundColor: palette.blue,
    borderRadius: 14,
    paddingVertical: 14,
    paddingHorizontal: 40,
    marginTop: 8,
  },
  retryText: { color: '#fff', fontSize: 15, fontWeight: '700' },
  backLink: { color: '#8FA5FF', fontSize: 14, marginTop: 10, textDecorationLine: 'underline' },
});
