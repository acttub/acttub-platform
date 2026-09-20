import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { useRequireLogin } from '@/hooks/use-require-login';
import { logEvent } from '@/lib/analytics';
import { formatClipDuration, relativeDayLabel } from '@/lib/archive-format';
import { listArchive, removeArchiveRecording, setArchiveFavorite, type ArchiveRecording } from '@/lib/archive-store';
import { ARCHIVE_VIDEOS, PERF_IMAGES } from '@/lib/challenge-mock';
import { formatKoreanDateTime } from '@/lib/format';
import { translate as t } from '@/lib/i18n';
import { setRecordedVideo } from '@/lib/recorded-video';

/** 실제 촬영본(uri 재생)과 예시(포스터)를 한 모양으로. */
type Detail = {
  id: string;
  real: boolean;
  uri: string | null;
  img: number | null;
  duration: number | null;
  createdAt: string;
  favorite: boolean;
  title: string;
};

/**
 * A2.3 보관함 영상 — 위엔 영상, 아래엔 메타와 다음 단계(질문 코칭 / 챌린지 올리기), 맨 밑 삭제.
 * 실제 촬영본은 그대로 재생하고 다음 단계로 그 파일을 넘긴다. 예시는 포스터만.
 */
export default function ArchiveDetailScreen() {
  const router = useRouter();
  const { confirm, alert, dialog } = useAppDialog();
  const { requireLogin, element: loginGuard } = useRequireLogin();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const [detail, setDetail] = useState<Detail | null | undefined>(undefined);
  const [playing, setPlaying] = useState(false);

  useEffect(() => {
    let alive = true;
    void listArchive().then((list) => {
      if (!alive) return;
      const real = list.find((r) => r.id === id);
      if (real) {
        setDetail(toDetail(real));
        return;
      }
      const mock = ARCHIVE_VIDEOS.find((v) => v.id === id);
      setDetail(
        mock
          ? { id: mock.id, real: false, uri: null, img: mock.img, duration: mock.duration, createdAt: mock.createdAt, favorite: mock.favorite, title: mock.line }
          : null,
      );
    });
    return () => {
      alive = false;
    };
  }, [id]);

  useEffect(() => {
    if (detail === null) router.back();
  }, [detail, router]);

  const player = useVideoPlayer(detail?.uri ?? null, (p) => {
    p.loop = true;
  });

  if (!detail) return null;

  const togglePlay = () => {
    if (!detail.uri) return;
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };
  const toggleFav = () => {
    setDetail((d) => (d ? { ...d, favorite: !d.favorite } : d));
    if (detail.real) void setArchiveFavorite(detail.id, !detail.favorite);
  };
  // 다음 단계엔 이 파일을 그대로 넘긴다(recorded-video 핸드오프). 예시는 파일이 없어 화면만 연다.
  const handoff = () => {
    if (detail.uri) {
      setRecordedVideo({ uri: detail.uri, durationMs: detail.duration ? detail.duration * 1000 : null, name: `${detail.id}.mp4` });
    }
  };
  const toCoach = () => {
    logEvent('archive_to_coach', { id: detail.id, real: detail.real });
    requireLogin(() => {
      handoff();
      router.push('/upload');
    });
  };
  const toChallenge = () => {
    logEvent('archive_to_challenge', { id: detail.id, real: detail.real });
    handoff();
    router.push({ pathname: '/challenge-upload', params: { line: detail.real ? '' : detail.title } });
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('archive.deleteTitle'),
      message: t('archive.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    logEvent('archive_delete', { id: detail.id, real: detail.real });
    if (detail.real) {
      player.pause();
      await removeArchiveRecording(detail.id);
    } else {
      await alert({ title: t('archive.deletedTitle'), message: t('archive.deletedMessage'), confirmLabel: t('common.confirm') });
    }
    router.back();
  };

  const when = `${relativeDayLabel(detail.createdAt)} ${formatKoreanDateTime(detail.createdAt).split(' ').slice(-2).join(' ')}`;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.videoArea}>
        {detail.uri ? (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        ) : (
          detail.img !== null && (
            <Image source={PERF_IMAGES[detail.img]} style={[StyleSheet.absoluteFill, styles.poster]} resizeMode="cover" />
          )
        )}
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button">
          {!playing && (
            <View style={styles.center}>
              <View style={styles.playBtn}>
                <Feather name="play" size={26} color="#FFFFFF" />
              </View>
            </View>
          )}
        </Pressable>
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Feather name="chevron-left" size={28} color="#FFFFFF" />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={toggleFav} hitSlop={10} accessibilityRole="button">
              <Feather name="star" size={24} color={detail.favorite ? '#F5B324' : '#FFFFFF'} />
            </Pressable>
            <Pressable onPress={() => void remove()} hitSlop={10} accessibilityRole="button">
              <Feather name="trash-2" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.line}>{detail.real ? detail.title : `“${detail.title}”`}</Text>
          <Text style={styles.meta}>
            {t('archive.metaLine', { when, duration: detail.duration !== null ? formatClipDuration(detail.duration) : '—' })}
          </Text>
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
      {loginGuard}
      {dialog}
    </View>
  );
}

function toDetail(r: ArchiveRecording): Detail {
  return {
    id: r.id,
    real: true,
    uri: r.uri,
    img: null,
    duration: r.durationSec,
    createdAt: r.createdAt,
    favorite: r.favorite,
    title: t('archive.recordedTitle'),
  };
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.navy },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  videoArea: { flex: 1 },
  center: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  poster: { width: '100%', height: '100%', opacity: 0.3 },
  topBar: {
    position: 'absolute',
    top: 0,
    left: 0,
    right: 0,
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'space-between',
    paddingHorizontal: 16,
    paddingTop: 8,
  },
  topRight: { flexDirection: 'row', alignItems: 'center', gap: 18 },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
  sheet: { backgroundColor: palette.card, borderTopLeftRadius: 22, borderTopRightRadius: 22 },
  sheetContent: { padding: 20, paddingTop: 22, gap: 10 },
  line: { fontSize: 17, fontWeight: '800', color: palette.text, lineHeight: 25 },
  meta: { fontSize: 12.5, color: palette.textFaint },
  nextHint: { fontSize: 13, color: palette.textDim, marginTop: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 14,
  },
  optionIcon: { width: 40, height: 40, borderRadius: 20, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  optionIconAmber: { backgroundColor: '#FFF4DE' },
  optionTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  optionSub: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
  deleteRow: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, paddingVertical: 12 },
  deleteText: { fontSize: 13.5, fontWeight: '700', color: palette.danger },
});
