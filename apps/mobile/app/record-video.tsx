import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useRef, useState } from 'react';
import { Linking, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { translate as t } from '@/lib/i18n';
import { MAX_VIDEO_DURATION_MS, normalizeVideoDurationMs } from '@/lib/upload-input';
import { setRecordedVideo } from '@/lib/recorded-video';

const MAX_SEC = Math.floor(MAX_VIDEO_DURATION_MS / 1000);
/** 챌린지(오늘의 대사) 촬영은 60초 — pen A18 촬영 대기 화면과 같은 상한. */
const CHALLENGE_MAX_SEC = 60;

/**
 * 앱 내 영상 촬영 (SOMA-477).
 *
 * 갤러리에서 고르는 것 말고, 연기 영상을 앱에서 바로 찍는다. 5분이 되면 자동으로
 * 멈추고(서버·업로드 상한과 같은 값), 결과를 recorded-video 핸드오프에 얹어
 * 업로드 화면으로 돌아간다.
 *
 * mode=challenge 면 pen A18 "촬영 대기" 화면이 된다 — 대사 카드를 위에 띄우고, 60초 상한,
 * 카메라 전환은 오른쪽 위, 아래엔 업로드(갤러리)·셔터·대사 숨김. 찍고 나면 챌린지 올리기로.
 *
 * 시뮬레이터엔 카메라가 없어 실기기에서만 실제로 돈다.
 */
export default function RecordVideoScreen() {
  const router = useRouter();
  // next=choose: 하단 탭 촬영 버튼에서 → 찍은 뒤 챌린지/AI 갈림길로. 기본: 업로드로 되돌아감.
  const { next, mode, line, work } = useLocalSearchParams<{
    next?: string;
    mode?: string;
    line?: string;
    work?: string;
  }>();
  const isChallenge = mode === 'challenge';
  const maxSec = isChallenge ? CHALLENGE_MAX_SEC : MAX_SEC;
  const cameraRef = useRef<CameraView>(null);
  const [camPerm, requestCam] = useCameraPermissions();
  const [micPerm, requestMic] = useMicrophonePermissions();
  const [facing, setFacing] = useState<'front' | 'back'>('back');
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [lineHidden, setLineHidden] = useState(false);
  // 종료 처리가 겹쳐 두 번 도는 것을 막는다(자동 정지 + 사용자 정지).
  const finishedRef = useRef(false);
  const { confirm, dialog } = useAppDialog();
  // 권한 요청은 화면에 들어오자마자 한 번만 — OS 팝업이 곧바로 뜬다.
  const askedRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const ready = !!(camPerm?.granted && micPerm?.granted);

  // 들어오자마자 OS 권한 팝업(카메라 → 마이크)을 띄운다. 거절하면 작은 안내 팝업에서
  // 설정으로 보내거나 되돌아간다 — 별도 안내 화면은 두지 않는다.
  useEffect(() => {
    if (ready || askedRef.current || !camPerm || !micPerm) return;
    askedRef.current = true;
    void (async () => {
      const cam = camPerm.granted ? camPerm : await requestCam();
      const mic = micPerm.granted ? micPerm : await requestMic();
      if (cam.granted && mic.granted) return;
      const toSettings = await confirm({
        title: t('record.permissionTitle'),
        message: t('record.permissionBody'),
        confirmLabel: t('record.openSettings'),
        cancelLabel: t('common.cancel'),
      });
      if (toSettings) void Linking.openSettings();
      router.back();
    })();
  }, [ready, camPerm, micPerm, requestCam, requestMic, confirm, router]);

  const goNext = useCallback(() => {
    if (isChallenge) {
      router.replace({ pathname: '/challenge-upload', params: { line: line ?? '', work: work ?? '' } });
      return;
    }
    if (next === 'choose') {
      router.replace('/record-choice');
      return;
    }
    router.back();
  }, [isChallenge, line, next, router, work]);

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
        goNext();
        return;
      }
      router.back();
    },
    [elapsed, goNext, router],
  );

  const startRecording = useCallback(async () => {
    if (!cameraRef.current || recording) return;
    setRecording(true);
    setElapsed(0);
    try {
      // maxDuration 으로 상한에서 네이티브가 스스로 멈춘다 — resolve 되면 결과를 넘긴다.
      const result = await cameraRef.current.recordAsync({ maxDuration: maxSec });
      finishWith(result?.uri ?? null);
    } catch {
      // 촬영이 실패하면 화면만 되돌린다(업로드에서 다시 시도).
      finishWith(null);
    } finally {
      setRecording(false);
    }
  }, [recording, finishWith, maxSec]);

  const stopRecording = useCallback(() => {
    if (!cameraRef.current || !recording) return;
    cameraRef.current.stopRecording(); // recordAsync 의 promise 를 resolve 시킨다
  }, [recording]);

  // 챌린지 모드 "업로드" — 찍는 대신 갤러리에서 골라 그대로 올리기로 간다.
  const pickFromGallery = useCallback(async () => {
    const result = await ImagePicker.launchImageLibraryAsync({ mediaTypes: ['videos'], quality: 1 });
    if (result.canceled || !result.assets[0]) return;
    const asset = result.assets[0];
    if (finishedRef.current) return;
    finishedRef.current = true;
    setRecordedVideo({
      uri: asset.uri,
      // 픽커의 duration 은 플랫폼마다 초/밀리초가 섞여 온다 — 업로드 화면과 같은 정규화를 쓴다.
      durationMs: normalizeVideoDurationMs(asset.duration ?? null),
      name: asset.fileName ?? `video-${Date.now()}.mp4`,
    });
    goNext();
  }, [goNext]);

  // 권한이 아직 없으면 카메라 자리만 검게 두고 팝업(OS·안내)이 뜨길 기다린다.
  if (!ready) {
    return (
      <View style={styles.safe}>
        <Stack.Screen options={{ title: t('record.screenTitle') }} />
        {dialog}
      </View>
    );
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const remaining = Math.max(0, maxSec - elapsed);

  // ---------- 챌린지 모드: pen A18 촬영 대기 ----------
  if (isChallenge) {
    return (
      <View style={styles.safe}>
        <Stack.Screen options={{ title: t('record.screenTitle'), headerShown: false }} />
        <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode="video" />

        <SafeAreaView style={styles.overlay} pointerEvents="box-none">
          <View>
            <View style={styles.chTopRow}>
              <Pressable style={styles.closeBtn} onPress={() => router.back()} disabled={recording} accessibilityRole="button">
                <Feather name="x" size={22} color="#FFFFFF" />
              </Pressable>
              <View style={[styles.timerPill, recording && styles.timerPillRec]}>
                <View style={[styles.recDot, !recording && styles.recDotIdle]} />
                <Text style={styles.timerText}>
                  {mmss(elapsed)} / {mmss(maxSec)}
                </Text>
              </View>
              {recording ? (
                <View style={styles.closeBtn} />
              ) : (
                <Pressable
                  style={styles.closeBtn}
                  accessibilityLabel={t('record.flip')}
                  onPress={() => setFacing((f) => (f === 'back' ? 'front' : 'back'))}>
                  <Feather name="refresh-cw" size={20} color="#FFFFFF" />
                </Pressable>
              )}
            </View>

            {!lineHidden && !!line && (
              <View style={styles.lineCard}>
                <View style={styles.lineLabelRow}>
                  <Feather name="message-square" size={12} color="#8FA5FF" />
                  <Text style={styles.lineLabel}>
                    {t('record.lineLabel')}
                    {work ? ` · 《${work}》` : ''}
                  </Text>
                </View>
                <Text style={styles.lineText}>{line}</Text>
              </View>
            )}
          </View>

          <View style={styles.bottomGroup}>
            <View style={styles.chBottomRow}>
              <Pressable style={styles.sideBtn} onPress={() => void pickFromGallery()} disabled={recording} accessibilityRole="button">
                <Feather name="image" size={24} color="#FFFFFF" />
                <Text style={styles.sideLabel}>{t('record.upload')}</Text>
              </Pressable>
              <Pressable
                accessibilityLabel={recording ? t('record.stop') : t('record.start')}
                onPress={() => (recording ? stopRecording() : void startRecording())}
                style={[styles.shutter, recording && styles.shutterRecording]}>
                <View style={recording ? styles.shutterInnerStop : styles.shutterInnerRed} />
              </Pressable>
              <Pressable style={styles.sideBtn} onPress={() => setLineHidden((v) => !v)} accessibilityRole="button">
                <Feather name={lineHidden ? 'eye-off' : 'eye'} size={24} color="#FFFFFF" />
                <Text style={styles.sideLabel}>{t(lineHidden ? 'record.showLine' : 'record.hideLine')}</Text>
              </Pressable>
            </View>
            <Text style={styles.hint}>
              {recording ? t('record.remaining', { sec: remaining }) : t('record.challengeHint')}
            </Text>
          </View>
        </SafeAreaView>
      </View>
    );
  }

  // ---------- 기본 모드(업로드/탭 촬영): 종전 화면 ----------
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
  chTopRow: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', padding: 16 },
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
  timerPillRec: { backgroundColor: 'rgba(0,0,0,0.7)' },
  recDot: { width: 10, height: 10, borderRadius: 5, backgroundColor: palette.danger },
  recDotIdle: { opacity: 0.7 },
  timerText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700', fontVariant: ['tabular-nums'] },
  lineCard: {
    marginHorizontal: 16,
    backgroundColor: 'rgba(10,14,24,0.78)',
    borderRadius: 16,
    paddingHorizontal: 16,
    paddingVertical: 14,
    gap: 6,
  },
  lineLabelRow: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  lineLabel: { color: '#8FA5FF', fontSize: 12, fontWeight: '800' },
  lineText: { color: '#FFFFFF', fontSize: 17, fontWeight: '700', lineHeight: 25 },
  bottomGroup: { gap: 12 },
  bottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 40,
    paddingBottom: 8,
  },
  chBottomRow: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 36,
  },
  sideBtn: { width: 72, alignItems: 'center', gap: 6 },
  sideLabel: { color: '#FFFFFF', fontSize: 12, fontWeight: '700', opacity: 0.9 },
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
  shutterInnerRed: { width: 60, height: 60, borderRadius: 30, backgroundColor: '#E5645C' },
  shutterInnerStop: { width: 30, height: 30, borderRadius: 6, backgroundColor: palette.danger },
  hint: { color: '#FFFFFF', textAlign: 'center', fontSize: 13, opacity: 0.85, paddingBottom: 8 },
});
