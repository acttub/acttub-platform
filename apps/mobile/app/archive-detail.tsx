import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useState } from 'react';
import { ActivityIndicator, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { api } from '@/lib/api';
import { formatClipDuration, relativeDayLabel } from '@/lib/archive-format';
import { useAuth } from '@/lib/auth';
import { formatKoreanDateTime } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { deleteDecision, usageLabel } from '@/lib/library/library-view';
import {
  flushLibraryUploads,
  forgetLocalCopy,
  localCopyFor,
  onLibraryChange,
  pendingLibraryUploads,
  removePendingUpload,
} from '@/lib/library/library-runner';
import type { Video } from '@/lib/library/types';
import type { QueuedVideo } from '@/lib/library/upload-queue';
import { videoErrorMessage } from '@/lib/library/video-checks';
import { setRecordedVideo } from '@/lib/recorded-video';
import { setPickedVideo } from '@/lib/practice/picked-video';

/**
 * A2.3 보관함 영상(practice.library) — 위엔 영상(서명 재생 주소, 만료 시 재조회; 기기 복사본이 있으면 그것), 아래엔
 * 날짜·길이·저장 상태, 사용처(회차 n개 · 챌린지 참여작 n개), "질문 코칭으로 보내기", "챌린지에 올리기", 삭제.
 * 참조가 있는 영상은 지우지 못하고(422 video_in_use) 사용처와 "파일만 파기"를 안내한다. 아직 확정되지 않은
 * 촬영본(업로드 대기)은 기기 파일로 재생하고 다시 올리기·대기에서 빼기를 준다.
 */
type State =
  | { kind: 'loading' }
  | { kind: 'pending'; entry: QueuedVideo }
  | { kind: 'video'; video: Video; localUri: string | null }
  | { kind: 'missing' };

function isExpired(video: Video): boolean {
  if (!video.playback_url) return true;
  if (!video.playback_expires_at) return false;
  const at = Date.parse(video.playback_expires_at);
  return Number.isNaN(at) ? false : at <= Date.now();
}

export default function ArchiveDetailScreen() {
  const router = useRouter();
  const { confirm, alert, sheet, dialog } = useAppDialog();
  const { user } = useAuth();
  const { id, pending } = useLocalSearchParams<{ id?: string; pending?: string }>();
  const [state, setState] = useState<State>({ kind: 'loading' });
  const [playing, setPlaying] = useState(false);

  const load = useCallback(async () => {
    if (pending && user?.id) {
      const entry = (await pendingLibraryUploads(user.id)).find((e) => e.id === pending);
      if (entry) {
        setState({ kind: 'pending', entry });
        return;
      }
      // 올라갔다 — 목록으로 돌아가면 "보관함 저장"으로 보인다.
      setState({ kind: 'missing' });
      return;
    }
    if (!id) {
      setState({ kind: 'missing' });
      return;
    }
    try {
      const [video, localUri] = await Promise.all([api.getVideo(id), localCopyFor(id)]);
      setState({ kind: 'video', video, localUri });
    } catch {
      setState({ kind: 'missing' });
    }
  }, [id, pending, user?.id]);

  useEffect(() => {
    void load();
  }, [load]);
  useEffect(() => onLibraryChange(() => void load()), [load]);
  useEffect(() => {
    if (state.kind === 'missing') router.back();
  }, [state.kind, router]);

  const source =
    state.kind === 'pending' ? state.entry.uri : state.kind === 'video' ? (state.localUri ?? (state.video.purged_at ? null : state.video.playback_url)) : null;
  const player = useVideoPlayer(source ?? null, (p) => {
    p.loop = true;
  });

  if (state.kind === 'loading') {
    return (
      <View style={[styles.root, styles.center]}>
        <Stack.Screen options={{ headerShown: false }} />
        <ActivityIndicator color="#fff" />
      </View>
    );
  }
  if (state.kind === 'missing') return null;

  const togglePlay = async () => {
    if (!source) return;
    if (state.kind === 'video' && !state.localUri && isExpired(state.video)) {
      // 서명 주소가 만료됐다 — 다시 조회해 새 주소를 받는다.
      await load();
      return;
    }
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };

  const toggleFav = async () => {
    if (state.kind !== 'video') return;
    const next = !state.video.favorite;
    setState({ ...state, video: { ...state.video, favorite: next } });
    try {
      await api.setVideoFavorite(state.video.id, next);
    } catch {
      void load();
    }
  };

  // 다음 단계엔 기기 복사본을 그대로 넘긴다(recorded-video 핸드오프). 복사본이 없으면 새 연습 흐름(PM2)이 video_id 로 잇는다.
  const handoff = (): boolean => {
    const uri = state.kind === 'pending' ? state.entry.uri : state.localUri;
    if (!uri) return false;
    const durationMs = state.kind === 'pending' ? state.entry.durationMs : state.video.duration_ms;
    setRecordedVideo({ uri, durationMs, name: `${state.kind === 'pending' ? state.entry.id : state.video.id}.mp4` });
    return true;
  };
  /** 새 연습으로 보낸다 — 영상은 보관함의 video_id 로 잇는다(기기 복사본은 미리보기에만 쓴다). */
  const toCoach = () => {
    logEvent('archive_to_coach', { id: state.kind === 'video' ? state.video.id : state.entry.id });
    if (state.kind === 'video' && state.video.purged_at) {
      void alert({ title: t('archive.toCoach'), message: t('archive.statusPurged') });
      return;
    }
    setPickedVideo(
      state.kind === 'video'
        ? {
            videoId: state.video.id,
            pendingId: null,
            uri: state.localUri,
            playbackUrl: state.video.playback_url ?? null,
            durationMs: state.video.duration_ms,
          }
        : { videoId: null, pendingId: state.entry.id, uri: state.entry.uri, playbackUrl: null, durationMs: state.entry.durationMs },
    );
    router.push('/upload');
  };
  const toChallenge = () => {
    logEvent('archive_to_challenge', { id: state.kind === 'video' ? state.video.id : state.entry.id });
    if (!handoff()) {
      void alert({ title: t('archive.toChallenge'), message: t('archive.statusPurged') });
      return;
    }
    router.push({ pathname: '/challenge-upload', params: { line: '' } });
  };

  const purge = async (video: Video) => {
    const ok = await confirm({ title: t('archive.purgeTitle'), message: t('archive.purgeBody'), confirmLabel: t('archive.purgeFile'), destructive: true });
    if (!ok) return;
    try {
      const next = await api.purgeVideoFile(video.id);
      await forgetLocalCopy(video.id);
      player.pause();
      setPlaying(false);
      setState({ kind: 'video', video: next, localUri: null });
    } catch (e) {
      void alert({ title: t('archive.purgeFile'), message: videoErrorMessage(e) });
    }
  };

  const remove = async () => {
    if (state.kind === 'pending') {
      const ok = await confirm({ title: t('archive.deleteTitle'), message: t('archive.deleteMessage'), confirmLabel: t('common.delete'), destructive: true });
      if (!ok) return;
      player.pause();
      await removePendingUpload(state.entry.id);
      router.back();
      return;
    }
    const decision = deleteDecision(state.video);
    if (decision.kind === 'in_use') {
      void sheet({
        title: t('archive.inUseBody', { usage: decision.usage }),
        actions: decision.canPurge ? [{ label: t('archive.purgeFile'), destructive: true, onPress: () => void purge(state.video) }] : [],
      });
      return;
    }
    const ok = await confirm({ title: t('archive.deleteTitle'), message: t('archive.deleteMessage'), confirmLabel: t('common.delete'), destructive: true });
    if (!ok) return;
    logEvent('archive_delete', { id: state.video.id });
    try {
      player.pause();
      await api.deleteVideo(state.video.id);
      await forgetLocalCopy(state.video.id);
      router.back();
    } catch (e) {
      void alert({ title: t('archive.inUseTitle'), message: videoErrorMessage(e) });
      void load();
    }
  };

  const createdAt = state.kind === 'pending' ? new Date(state.entry.createdAt).toISOString() : state.video.created_at;
  const durationMs = state.kind === 'pending' ? state.entry.durationMs : state.video.duration_ms;
  const when = `${relativeDayLabel(createdAt)} ${formatKoreanDateTime(createdAt).split(' ').slice(-2).join(' ')}`;
  const status =
    state.kind === 'pending'
      ? state.entry.status === 'failed'
        ? t('archive.statusFailed')
        : state.entry.status === 'uploading'
          ? t('archive.statusUploading')
          : t('archive.statusPending')
      : state.video.purged_at
        ? t('archive.statusPurged')
        : t('archive.statusSaved');
  const favorite = state.kind === 'video' && state.video.favorite;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.videoArea}>
        {source ? (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        ) : (
          <View style={styles.center}>
            <Feather name="video-off" size={30} color="rgba(255,255,255,0.6)" />
            <Text style={styles.noPlayback}>{t('archive.statusPurged')}</Text>
          </View>
        )}
        {source && (
          <Pressable style={StyleSheet.absoluteFill} onPress={() => void togglePlay()} accessibilityRole="button">
            {!playing && (
              <View style={styles.center}>
                <View style={styles.playBtn}>
                  <Feather name="play" size={26} color="#FFFFFF" />
                </View>
              </View>
            )}
          </Pressable>
        )}
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Feather name="chevron-left" size={28} color="#FFFFFF" />
          </Pressable>
          <View style={styles.topRight}>
            {state.kind === 'video' && (
              <Pressable onPress={() => void toggleFav()} hitSlop={10} accessibilityRole="button">
                <Feather name="star" size={24} color={favorite ? '#F5B324' : '#FFFFFF'} />
              </Pressable>
            )}
            <Pressable onPress={() => void remove()} hitSlop={10} accessibilityRole="button">
              <Feather name="trash-2" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.line}>{t('archive.recordedTitle')}</Text>
          <Text style={styles.meta}>
            {when} · {durationMs !== null ? formatClipDuration(Math.round(durationMs / 1000)) : '—'} · {status}
          </Text>
          {state.kind === 'pending' ? (
            <View style={styles.pendingRow}>
              <Text style={styles.nextHint}>
                {state.entry.lastError ? videoErrorMessage(state.entry.lastError) : t('archive.savedLocally')}
              </Text>
              <View style={styles.pendingBtns}>
                <Pressable style={styles.smallBtn} onPress={() => user?.id && void flushLibraryUploads(user.id)}>
                  <Feather name="upload-cloud" size={14} color={palette.blueDeep} />
                  <Text style={styles.smallBtnText}>{t('archive.retryUpload')}</Text>
                </Pressable>
                <Pressable style={styles.smallBtn} onPress={() => void remove()}>
                  <Feather name="x" size={14} color={palette.blueDeep} />
                  <Text style={styles.smallBtnText}>{t('archive.removePending')}</Text>
                </Pressable>
              </View>
            </View>
          ) : (
            <Text style={styles.usage}>
              {t('archive.usageLabel')} · {usageLabel(state.video.usage)}
            </Text>
          )}
          <Text style={styles.nextHint}>{t('archive.nextHint')}</Text>

          <Pressable style={({ pressed }) => [styles.option, pressed && styles.pressed]} onPress={toCoach} accessibilityRole="button">
            <View style={styles.optionIcon}>
              <Feather name="message-circle" size={18} color={palette.blue} />
            </View>
            <View style={styles.flex}>
              <Text style={styles.optionTitle}>{t('archive.toCoach')}</Text>
              <Text style={styles.optionSub}>{t('archive.toCoachSub')}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={palette.checkOff} />
          </Pressable>
          <Pressable style={({ pressed }) => [styles.option, pressed && styles.pressed]} onPress={toChallenge} accessibilityRole="button">
            <View style={[styles.optionIcon, styles.optionIconAmber]}>
              <Feather name="award" size={18} color="#E9A23B" />
            </View>
            <View style={styles.flex}>
              <Text style={styles.optionTitle}>{t('archive.toChallenge')}</Text>
              <Text style={styles.optionSub}>{t('archive.toChallengeSub')}</Text>
            </View>
            <Feather name="chevron-right" size={18} color={palette.checkOff} />
          </Pressable>

          <Pressable style={styles.deleteRow} onPress={() => void remove()} accessibilityRole="button">
            <Feather name="trash-2" size={14} color={palette.danger} />
            <Text style={styles.deleteText}>{t('archive.delete')}</Text>
          </Pressable>
        </ScrollView>
      </SafeAreaView>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.navy },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  videoArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center', gap: 8 },
  noPlayback: { color: 'rgba(255,255,255,0.7)', fontFamily: 'Pretendard-SemiBold', fontSize: 14 },
  topBar: { position: 'absolute', top: 0, left: 0, right: 0, flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  playBtn: { width: 64, height: 64, borderRadius: 32, backgroundColor: 'rgba(255,255,255,0.2)', alignItems: 'center', justifyContent: 'center' },
  sheet: { backgroundColor: palette.card, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetContent: { padding: 20, paddingTop: 22, gap: 10 },
  line: { fontSize: 17, fontWeight: '800', color: palette.text, lineHeight: 25 },
  meta: { fontSize: 12.5, color: palette.textFaint },
  usage: { fontSize: 13, color: palette.textDim, fontFamily: 'Pretendard-SemiBold' },
  pendingRow: { gap: 8 },
  pendingBtns: { flexDirection: 'row', gap: 8 },
  smallBtn: { flexDirection: 'row', alignItems: 'center', gap: 5, backgroundColor: palette.blueSoft, borderRadius: 999, paddingHorizontal: 12, paddingVertical: 7 },
  smallBtnText: { color: palette.blueDeep, fontFamily: 'Pretendard-SemiBold', fontSize: 12 },
  nextHint: { fontSize: 13, color: palette.textDim, marginTop: 6 },
  option: { flexDirection: 'row', alignItems: 'center', gap: 12, borderWidth: 1, borderColor: palette.border, borderRadius: 16, padding: 14 },
  optionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  optionIconAmber: { backgroundColor: '#FFF4DE' },
  optionTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  optionSub: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
  deleteRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, paddingVertical: 12 },
  deleteText: { fontSize: 13.5, fontWeight: '700', color: palette.danger },
});
