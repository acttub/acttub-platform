import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import { Stack, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { MAX_VIDEO_DURATION_MS } from '@/lib/upload-input';
import { setRecordedVideo } from '@/lib/recorded-video';

const MAX_SEC = Math.floor(MAX_VIDEO_DURATION_MS / 1000);

/**
 * 앱 내 영상 촬영 (SOMA-477).
 *
 * 갤러리에서 고르는 것 말고, 연기 영상을 앱에서 바로 찍는다. 5분이 되면 자동으로
 * 멈추고(서버·업로드 상한과 같은 값), 결과를 recorded-video 핸드오프에 얹어
 * 업로드 화면으로 돌아간다.
 *
 * 시뮬레이터엔 카메라가 없어 실기기에서만 실제로 돈다.
 */
export default function RecordVideoScreen() {
  const router = useRouter();
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  // 종료 처리가 겹쳐 두 번 도는 것을 막는다(자동 정지 + 사용자 정지).
  const finishedRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const ready = camPerm?.granted && micPerm?.granted;

  const finishWith = useCallback(
    (uri: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (uri) {
        setRecordedVideo({
          uri,
          durationMs: elapsed > 0 ? elapsed * 1000 : null,
          name: `recording-${Date.now()}.mov`,
        });
      }
      router.back();
    },
    [elapsed, router],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setElapsed(0);
    try {
      // maxDuration 으로 5분에서 네이티브가 스스로 멈춘다 — resolve 되면 결과를 넘긴다.
      const result = await cameraRef.current.recordAsync({ maxDuration: MAX_SEC });
      finishWith(result?.uri ?? null);
    } catch {
      // 촬영이 실패하면 화면만 되돌린다(업로드에서 다시 시도).
      finishWith(null);
    } finally {
      setRecording(false);
    }
  }, [recording, finishWith]);

  const stopRecording = useCallback(() => {
    if (!cameraRef.current || !recording) return;
    cameraRef.current.stopRecording(); // recordAsync 의 promise 를 resolve 시킨다
  }, [recording]);

  // --- 권한이 아직 없으면 요청 화면 ---
  if (!ready) {
    const denied = camPerm?.status === 'denied' || micPerm?.status === 'denied';
    const ask = async () => {
      await requestCam();
      await requestMic();
    };
    return (
      <SafeAreaView style={styles.permSafe}>
        <Stack.Screen options={{ title: t('record.screenTitle') }} />
        <View style={styles.permBody}>
          <Text style={styles.permTitle}>{t('record.permissionTitle')}</Text>
          <Text style={styles.permText}>{t('record.permissionBody')}</Text>
          <Pressable
            style={styles.permBtn}
            onPress={() => (denied ? void Linking.openSettings() : void ask())}>
            <Text style={styles.permBtnText}>
              {denied ? t('record.openSettings') : t('record.grant')}
            </Text>
          </Pressable>
        </View>
      </SafeAreaView>
    );
  }

  const remaining = Math.max(0, MAX_SEC - elapsed);
  const remainMin = Math.floor(remaining / 60);
  const remainSec = remaining % 60;

  return (
    <View style={styles.safe}>
      <Stack.Screen options={{ title: t('record.screenTitle'), headerShown: false }} />
      <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode="video" />

      <SafeAreaView style={styles.overlay} pointerEvents="box-none">
        <View style={styles.topRow}>
          {recording ? (
            <View style={styles.timerPill}>
              <View style={styles.recDot} />
              <Text style={styles.timerText}>
                {remainMin}:{String(remainSec).padStart(2, '0')}
              </Text>
            </View>
          ) : (
            <Pressable style={styles.closeBtn} onPress={() => router.back()}>
              <Text style={styles.closeText}>✕</Text>
            </Pressable>
          )}
        </View>

        <View style={styles.bottomGroup}>
          {!recording && <Text style={styles.hint}>{t('record.hint')}</Text>}
          <View style={styles.bottomRow}>
            {/* 왼쪽 슬롯: 녹화 중엔 빈 칸으로 둬서 셔터가 늘 가운데에 오게 한다. */}
            {recording ? (
              <View style={styles.flipBtn} />
            ) : (
              <Pressable
                style={styles.flipBtn}
                accessibilityLabel={t('record.flip')}
                onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
                <Text style={styles.flipIcon}>⟲</Text>
              </Pressable>
            )}
            <Pressable
              accessibilityLabel={recording ? t('record.stop') : t('record.start')}
              onPress={() => (recording ? stopRecording() : void startRecording())}
              style={[styles.shutter, recording && styles.shutterRecording]}>
              <View style={recording ? styles.shutterInnerStop : styles.shutterInner} />
            </Pressable>
            <View style={styles.flipBtn} />
          </View>
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  camera: { ...StyleSheet.absoluteFillObject },
  overlay: { flex: 1, justifyContent: 'space-between' },
  topRow: { flexDirection: 'row', justifyContent: 'flex-start', padding: 16 },
  closeBtn: {
    width: 40,
    height: 40,
    borderRadius: 20,
    backgroundColor: 'rgba(0,0,0,0.45)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  closeText: { color: '#FFFFFF', fontSize: 18, fontWeight: '700' },
  timerPill: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(0,0,0,0.55)',
    paddingHorizontal: 14,
    paddingVertical: 8,
    borderRadius: 999,
  },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.danger },
  timerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  bottomGroup: { gap: 12 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingBottom: 8,
  },
  flipBtn: { width: 52, height: 52, alignItems: 'center', justifyContent: 'center' },
  flipIcon: { color: '#FFFFFF', fontSize: 26 },
  shutter: {
    width: 78,
    height: 78,
    borderRadius: 39,
    borderWidth: 4,
    borderColor: '#FFFFFF',
    alignItems: 'center',
    justifyContent: 'center',
  },
  shutterRecording: { borderColor: palette.danger },
  shutterInner: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#FFFFFF' },
  shutterInnerStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: palette.danger },
  hint: { color: '#FFFFFF', textAlign: 'center', fontSize: 13, opacity: 0.85 },
  permSafe: { flex: 1, backgroundColor: palette.bg },
  permBody: { flex: 1, justifyContent: 'center', padding: 28, gap: 12 },
  permTitle: { fontSize: 20, fontWeight: '800', color: palette.text },
  permText: { fontSize: 15, lineHeight: 22, color: palette.textDim },
  permBtn: {
    marginTop: 8,
    backgroundColor: palette.blue,
    paddingVertical: 14,
    borderRadius: 14,
    alignItems: 'center',
  },
  permBtnText: { color: '#FFFFFF', fontSize: 16, fontWeight: '700' },
});
