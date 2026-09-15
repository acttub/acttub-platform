import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { translate as t } from '@/lib/i18n';
import { peekRecordedVideo, takeRecordedVideo, type RecordedVideo } from '@/lib/recorded-video';

/**
 * 촬영 직후 갈림길 — 방금 찍은 영상을 챌린지에 올릴지, AI 코치 분석을 받을지 고른다.
 *
 * 촬영 결과는 recorded-video 핸드오프에 얹혀 있다. 여기선 peek 만 하고 꺼내지 않는다 —
 * 다음 화면(업로드 / 챌린지 올리기)이 꺼내 간다. "다시 찍기"만 버린다.
 */
export default function RecordChoiceScreen() {
  const router = useRouter();
  const [video] = useState<RecordedVideo | null>(() => peekRecordedVideo());
  const player = useVideoPlayer(video?.uri ?? null, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // 결과 없이 들어오면(딥링크 등) 고를 게 없다 — 홈으로.
  useEffect(() => {
    if (!video) router.replace('/');
  }, [video, router]);

  const sec = video?.durationMs ? Math.round(video.durationMs / 1000) : null;

  const goAi = () => {
    logEvent('record_choice', { choice: 'ai' });
    // 업로드 화면이 포커스되며 takeRecordedVideo 로 결과를 받아 붙인다.
    router.replace('/upload');
  };
  const goChallenge = () => {
    logEvent('record_choice', { choice: 'challenge' });
    router.replace('/challenge-upload');
  };
  const retake = () => {
    logEvent('record_choice', { choice: 'retake' });
    takeRecordedVideo();
    router.replace({ pathname: '/record-video', params: { next: 'choose' } });
  };

  if (!video) return null;

  return (
    <SafeAreaView style={styles.safe} edges={['bottom']}>
      <Stack.Screen options={{ headerShown: true, title: t('recordChoice.title'), headerBackVisible: false }} />
      <View style={styles.content}>
        <View style={styles.previewWrap}>
          <VideoView style={styles.preview} player={player} contentFit="cover" nativeControls={false} />
          {sec !== null && (
            <View style={styles.durationChip}>
              <Feather name="video" size={12} color="#FFFFFF" />
              <Text style={styles.durationText}>{t('recordChoice.duration', { sec })}</Text>
            </View>
          )}
        </View>

        <Text style={styles.subtitle}>{t('recordChoice.subtitle')}</Text>

        <Pressable style={({ pressed }) => [styles.option, styles.optionPrimary, pressed && styles.pressed]} onPress={goAi} accessibilityRole="button">
          <View style={[styles.optionIcon, styles.optionIconPrimary]}>
            <Feather name="message-circle" size={20} color="#FFFFFF" />
          </View>
          <View style={styles.flex}>
            <Text style={[styles.optionTitle, styles.optionTitlePrimary]}>{t('recordChoice.ai')}</Text>
            <Text style={[styles.optionSub, styles.optionSubPrimary]}>{t('recordChoice.aiSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color="rgba(255,255,255,0.9)" />
        </Pressable>

        <Pressable style={({ pressed }) => [styles.option, pressed && styles.pressed]} onPress={goChallenge} accessibilityRole="button">
          <View style={styles.optionIcon}>
            <Feather name="award" size={20} color={palette.blue} />
          </View>
          <View style={styles.flex}>
            <Text style={styles.optionTitle}>{t('recordChoice.challenge')}</Text>
            <Text style={styles.optionSub}>{t('recordChoice.challengeSub')}</Text>
          </View>
          <Feather name="chevron-right" size={20} color={palette.checkOff} />
        </Pressable>

        <View style={styles.flex} />

        <Pressable style={styles.retake} onPress={retake} accessibilityRole="button" hitSlop={8}>
          <Feather name="refresh-ccw" size={14} color={palette.textFaint} />
          <Text style={styles.retakeText}>{t('recordChoice.retake')}</Text>
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  flex: { flex: 1 },
  pressed: { opacity: 0.85 },
  content: { flex: 1, padding: 20, gap: 14 },
  previewWrap: { alignSelf: 'center', width: 150, aspectRatio: 9 / 16, borderRadius: 16, overflow: 'hidden', backgroundColor: palette.text },
  preview: { width: '100%', height: '100%' },
  durationChip: {
    position: 'absolute',
    bottom: 8,
    left: 8,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 4,
    backgroundColor: 'rgba(0,0,0,0.55)',
    borderRadius: 999,
    paddingHorizontal: 8,
    paddingVertical: 4,
  },
  durationText: { fontSize: 11, fontWeight: '700', color: '#FFFFFF' },
  subtitle: { fontSize: 13.5, fontWeight: '600', color: palette.textDim, lineHeight: 20, textAlign: 'center', marginTop: 4 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    backgroundColor: palette.card,
    borderColor: palette.border,
    borderWidth: 1,
    borderRadius: 16,
    padding: 16,
  },
  optionPrimary: { backgroundColor: palette.blue, borderColor: palette.blue },
  optionIcon: { width: 42, height: 42, borderRadius: 12, backgroundColor: palette.blueSoft, alignItems: 'center', justifyContent: 'center' },
  optionIconPrimary: { backgroundColor: 'rgba(255,255,255,0.2)' },
  optionTitle: { fontSize: 16, fontWeight: '800', color: palette.text },
  optionTitlePrimary: { color: '#FFFFFF' },
  optionSub: { fontSize: 12.5, fontWeight: '500', color: palette.textFaint, marginTop: 3 },
  optionSubPrimary: { color: 'rgba(255,255,255,0.85)' },
  retake: { flexDirection: 'row', alignSelf: 'center', alignItems: 'center', gap: 6, padding: 10 },
  retakeText: { fontSize: 13, fontWeight: '700', color: palette.textFaint },
});
