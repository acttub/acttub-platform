import Feather from '@expo/vector-icons/Feather';
import { CameraView, useCameraPermissions, useMicrophonePermissions } from 'expo-camera';
import * as ImagePicker from 'expo-image-picker';
import { useLocalSearchParams, useRouter } from 'expo-router';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { Linking, PanResponder, Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { RecordModeSlider } from '@/components/record-mode-slider';
import { palette } from '@/constants/palette';
import { keepDeviceFile } from '@/lib/account-files';
import { api } from '@/lib/api';
import { useAuth } from '@/lib/auth';
import { isKorean, translate as t } from '@/lib/i18n';
import { recordModeAfterSwipe, recordModes, type RecordMode } from '@/lib/record-modes';
import { saveRecordingToLibrary } from '@/lib/library/library-runner';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { MAX_VIDEO_DURATION_MS, normalizeVideoDurationMs } from '@/lib/upload-input';
import { peekRecordedVideo, setRecordedVideo, takeRecordedVideo } from '@/lib/recorded-video';
import { setPickedVideo } from '@/lib/practice/picked-video';

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
 * 촬영이 끝나면(A2.1, practice.record) 기기에 먼저 저장하고 업로드 대기 큐에 넣는다 — 서버 확정 전에는 "기기에 저장 ·
 * 업로드 대기", 확정 뒤에는 "보관함 저장"이다. 어디로 보낼지 정하지 않아도 보관함에 남는다.
 *
 * 시뮬레이터엔 카메라가 없어 실기기에서만 실제로 돈다.
 */
export default function RecordVideoScreen() {
  const router = useRouter();
  // mode=ai: 하단 탭 촬영 버튼에서 "AI 코칭"을 고르고 옴 → 찍으면 업로드 화면으로.
  // mode=plain: "기본 촬영" → 찍으면 보관함에 저장하고 그 영상 화면으로.
  // mode=challenge: 대사 띄운 챌린지 촬영. 그 외(업로드 화면의 촬영 버튼)는 찍고 되돌아간다.
  // picker=1: 하단 탭 가운데 버튼에서 곧장 옴 — 셔터 아래 줄을 넘겨 용도를 고른다(SOMA-494).
  const params = useLocalSearchParams<{
    mode?: string;
    line?: string;
    work?: string;
    challengeId?: string;
    picker?: string;
  }>();
  const picker = params.picker === '1';
  const [mode, setMode] = useState<string | undefined>(params.mode);
  // 오늘의 대사로 넘기면 여기에 그 챌린지를 채운다 — 챌린지 화면에서 오면 처음부터 들어 있다.
  const [challengeParams, setChallengeParams] = useState({
    challengeId: params.challengeId,
    line: params.line,
    work: params.work,
  });
  const { challengeId, line, work } = challengeParams;
  const [loadingToday, setLoadingToday] = useState(false);
  const modes = useMemo(() => recordModes(isKorean()), []);
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
  const { alert, dialog } = useAppDialog();
  const { user } = useAuth();
  // 권한 요청은 화면에 들어오자마자 한 번만 — OS 팝업이 곧바로 뜬다.
  const askedRef = useRef(false);

  useEffect(() => {
    if (!recording) return;
    const id = setInterval(() => setElapsed((s) => s + 1), 1000);
    return () => clearInterval(id);
  }, [recording]);

  const ready = !!(camPerm?.granted && micPerm?.granted);

  // 들어오자마자 OS 권한 팝업(카메라 → 마이크)을 한 번 띄운다. 거절했거나 전에 거절해 팝업이 다시
  // 안 뜨면 화면 안의 버튼으로 다시 묻거나 설정으로 보낸다 — iOS 전체화면 모달 위에서는 우리 안내
  // 팝업이 안 떠서 검은 화면에 갇힌 적이 있다.
  const askPermissions = useCallback(async () => {
    const cam = camPerm?.granted ? camPerm : await requestCam();
    const mic = micPerm?.granted ? micPerm : await requestMic();
    return cam.granted && mic.granted;
  }, [camPerm, micPerm, requestCam, requestMic]);

  useEffect(() => {
    if (ready || askedRef.current || !camPerm || !micPerm) return;
    askedRef.current = true;
    void askPermissions();
  }, [ready, camPerm, micPerm, askPermissions]);

  // 다시 물어도 팝업이 안 뜨는 상태(거절 후 "다시 묻지 않음")면 설정으로 보낸다.
  const blocked = (!!camPerm && !camPerm.granted && !camPerm.canAskAgain) || (!!micPerm && !micPerm.granted && !micPerm.canAskAgain);

  /** 촬영·선택한 영상을 보관함(기기 저장 + 업로드 대기)에 넣는다. 너무 길면 안내하고 넣지 않는다. */
  const saveToLibrary = useCallback(async (): Promise<{ id: string; uri: string } | null> => {
    const video = peekRecordedVideo();
    if (!video || !user?.id) return null;
    const outcome = await saveRecordingToLibrary({ uri: video.uri, durationMs: video.durationMs, owner: user.id });
    if (outcome.kind === 'rejected') {
      await alert({ title: t('archive.title'), message: videoErrorMessage(outcome.code) });
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
      if (recording || loadingToday || next === mode) return;
      if (next !== 'challenge' || challengeId) {
        setMode(next);
        return;
      }
      setLoadingToday(true);
      try {
        const { featured } = await api.listChallenges({ tab: 'popular' });
        if (!featured) {
          void alert({ title: t('recordMode.challenge'), message: t('recordMode.noToday') });
          return;
        }
        setChallengeParams({ challengeId: featured.id, line: featured.line, work: featured.work });
        setMode('challenge');
      } catch {
        void alert({ title: t('recordMode.challenge'), message: t('recordMode.noToday') });
      } finally {
        setLoadingToday(false);
      }
    },
    [alert, challengeId, loadingToday, mode, recording],
  );

  // 화면을 옆으로 넘겨도 용도가 바뀐다(인스타처럼). 가로로 충분히 움직였을 때만 가로챈다 — 버튼 누르기는 그대로다.
  const swipe = useMemo(
    () =>
      PanResponder.create({
        onStartShouldSetPanResponder: () => picker,
        onMoveShouldSetPanResponder: (_, g) => picker && Math.abs(g.dx) > 24 && Math.abs(g.dx) > Math.abs(g.dy) * 1.5,
        onPanResponderRelease: (_, g) => {
          if (Math.abs(g.dx) < 40) return;
          const current = (mode ?? 'ai') as RecordMode;
          void changeMode(recordModeAfterSwipe(modes, current, g.dx < 0 ? 'left' : 'right'));
        },
      }),
    [changeMode, mode, modes, picker],
  );
  const showPicker = picker && !recording;
  const slider = showPicker ? (
    <View>
      <RecordModeSlider
        modes={modes}
        value={(mode ?? 'ai') as RecordMode}
        onChange={(next) => void changeMode(next)}
        disabled={loadingToday}
      />
      {loadingToday && <Text style={styles.hint}>{t('recordMode.loadingToday')}</Text>}
    </View>
  ) : null;

  const goNext = useCallback(() => {
    if (isChallenge) {
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
          });
        }
        router.replace('/upload');
      });
      return;
    }
    if (mode === 'plain') {
      // 기본 촬영 — 기기에 저장하고 업로드 대기 큐에 넣은 뒤 그 영상 화면으로.
      void saveToLibrary().then((pending) => {
        takeRecordedVideo();
        if (pending) router.replace({ pathname: '/archive-detail', params: { pending: pending.id } });
        else router.back();
      });
      return;
    }
    router.back();
  }, [challengeId, isChallenge, line, mode, router, saveToLibrary, work]);

  const finishWith = useCallback(
    (uri: string | null) => {
      if (finishedRef.current) return;
      finishedRef.current = true;
      if (uri) {
        // 찍은 영상은 캐시에 남는다. 올리지 않고 나가도 탈퇴 때 지울 수 있게 장부에 적는다.
        void keepDeviceFile(uri);
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
    void keepDeviceFile(asset.uri);
    setRecordedVideo({
      uri: asset.uri,
      // 픽커의 duration 은 플랫폼마다 초/밀리초가 섞여 온다 — 업로드 화면과 같은 정규화를 쓴다.
      durationMs: normalizeVideoDurationMs(asset.duration ?? null),
      name: asset.fileName ?? `video-${Date.now()}.mp4`,
    });
    goNext();
  }, [goNext]);

  // 권한이 아직 없으면 화면 안에서 직접 묻는다 — 닫기·권한 버튼이 늘 보인다.
  if (!ready) {
    return (
      <SafeAreaView style={styles.safe}>
        <View style={styles.topRow}>
          <Pressable style={styles.closeBtn} onPress={() => router.back()} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Feather name="x" size={22} color="#FFFFFF" />
          </Pressable>
        </View>
        {camPerm && micPerm && (
          <View style={styles.permBox}>
            <Feather name="video" size={34} color="#FFFFFF" />
            <Text style={styles.permTitle}>{t('record.permissionTitle')}</Text>
            <Text style={styles.permBody}>{t('record.permissionBody')}</Text>
            <Pressable
              style={styles.permBtn}
              onPress={() => (blocked ? void Linking.openSettings() : void askPermissions())}
              accessibilityRole="button">
              <Text style={styles.permBtnText}>{t(blocked ? 'record.openSettings' : 'record.permissionAllow')}</Text>
            </Pressable>
          </View>
        )}
        {dialog}
      </SafeAreaView>
    );
  }

  const mmss = (s: number) => `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  const remaining = Math.max(0, maxSec - elapsed);

  // ---------- 챌린지 모드: pen A18 촬영 대기 ----------
  if (isChallenge) {
    return (
      <View style={styles.safe}>
        <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode="video" />
        {/* 넘기기는 여기서 받는다 — 위 겹침은 box-none 이라 빈 곳 터치를 자기가 받지 않는다. */}
        <View style={StyleSheet.absoluteFill} {...swipe.panHandlers} />

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
            {slider}
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
      <CameraView ref={cameraRef} style={styles.camera} facing={facing} mode="video" />
      {/* 넘기기는 여기서 받는다 — 위 겹침은 box-none 이라 빈 곳 터치를 자기가 받지 않는다. */}
      <View style={StyleSheet.absoluteFill} {...swipe.panHandlers} />

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
          {!recording && <Text style={styles.hint}>{picker ? t('recordMode.swipeHint') : t('record.hint')}</Text>}
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
          {slider}
        </View>
      </SafeAreaView>
    </View>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: '#000' },
  permBox: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 32, paddingBottom: 80, gap: 12 },
  permTitle: { color: '#FFFFFF', fontSize: 18, fontWeight: '800', textAlign: 'center' },
  permBody: { color: 'rgba(255,255,255,0.75)', fontSize: 14, lineHeight: 21, textAlign: 'center' },
  permBtn: { marginTop: 8, backgroundColor: palette.blue, borderRadius: 12, paddingHorizontal: 22, paddingVertical: 13 },
  permBtnText: { color: '#FFFFFF', fontSize: 15, fontWeight: '700' },
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
