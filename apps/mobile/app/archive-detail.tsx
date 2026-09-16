import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useEffect, useState } from 'react';
import { Image, Pressable, ScrollView, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { formatClipDuration, relativeDayLabel } from '@/lib/archive-format';
import { ARCHIVE_VIDEOS, PERF_IMAGES } from '@/lib/challenge-mock';
import { formatKoreanDateTime } from '@/lib/format';
import { translate as t } from '@/lib/i18n';

/**
 * A2.3 보관함 영상 — 위엔 영상(예시라 포스터), 아래엔 대사·메타와 다음 단계(질문 코칭 /
 * 챌린지 올리기), 맨 밑 삭제. 실제 영상 파일이 붙으면 포스터 자리를 VideoView로 바꾼다.
 */
export default function ArchiveDetailScreen() {
  const router = useRouter();
  const { confirm, alert, dialog } = useAppDialog();
  const { id } = useLocalSearchParams<{ id?: string }>();
  const video = ARCHIVE_VIDEOS.find((v) => v.id === id) ?? null;
  const [fav, setFav] = useState(video?.favorite ?? false);

  useEffect(() => {
    if (!video) router.back();
  }, [video, router]);
  if (!video) return null;

  const toCoach = () => {
    logEvent('archive_to_coach', { id: video.id });
    router.push('/upload');
  };
  const toChallenge = () => {
    logEvent('archive_to_challenge', { id: video.id });
    router.push({ pathname: '/challenge-upload', params: { line: video.line } });
  };
  const remove = async () => {
    const ok = await confirm({
      title: t('archive.deleteTitle'),
      message: t('archive.deleteMessage'),
      confirmLabel: t('common.delete'),
      destructive: true,
    });
    if (!ok) return;
    logEvent('archive_delete', { id: video.id });
    await alert({ title: t('archive.deletedTitle'), message: t('archive.deletedMessage'), confirmLabel: t('common.confirm') });
    router.back();
  };

  const when = `${relativeDayLabel(video.createdAt)} ${formatKoreanDateTime(video.createdAt).split(' ').slice(-2).join(' ')}`;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.videoArea}>
        <Image source={PERF_IMAGES[video.img]} style={[StyleSheet.absoluteFill, styles.poster]} resizeMode="cover" />
        <SafeAreaView edges={['top']} style={styles.topBar}>
          <Pressable onPress={() => router.back()} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.back')}>
            <Feather name="chevron-left" size={28} color="#FFFFFF" />
          </Pressable>
          <View style={styles.topRight}>
            <Pressable onPress={() => setFav((v) => !v)} hitSlop={10} accessibilityRole="button">
              <Feather name="star" size={24} color={fav ? '#F5B324' : '#FFFFFF'} />
            </Pressable>
            <Pressable onPress={() => void remove()} hitSlop={10} accessibilityRole="button">
              <Feather name="trash-2" size={22} color="#FFFFFF" />
            </Pressable>
          </View>
        </SafeAreaView>
        <View style={styles.playBtn}>
          <Feather name="play" size={26} color="#FFFFFF" />
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <ScrollView contentContainerStyle={styles.sheetContent}>
          <Text style={styles.line}>“{video.line}”</Text>
          <Text style={styles.meta}>
            {t('archive.metaLine', { when, duration: formatClipDuration(video.duration) })}
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
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: palette.navy },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  videoArea: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  poster: { opacity: 0.3 },
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
