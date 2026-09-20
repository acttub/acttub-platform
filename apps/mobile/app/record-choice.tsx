import Feather from '@expo/vector-icons/Feather';
import { Stack, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useEffect, useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { formatClipDuration } from '@/lib/archive-format';
import { isKorean, translate as t } from '@/lib/i18n';
import { peekRecordedVideo, takeRecordedVideo, type RecordedVideo } from '@/lib/recorded-video';

/**
 * A2.1 촬영 완료 — 방금 찍은 영상을 어둡게 풀스크린으로 틀고, 아래 시트에서 질문 코칭 /
 * 챌린지 올리기 / 다시 촬영을 고른다. "보관함에 저장했어요" 배너는 pen 그대로지만 실제
 * 기기 저장은 아직 없다(보관함은 예시 데이터).
 *
 * 촬영 결과는 recorded-video 핸드오프에 얹혀 있다. 여기선 peek 만 하고 꺼내지 않는다 —
 * 다음 화면(업로드 / 챌린지 올리기)이 꺼내 간다. "다시 촬영"만 버린다.
 */
export default function RecordChoiceScreen() {
  const router = useRouter();
  const [video] = useState<RecordedVideo | null>(() => peekRecordedVideo());
  const [playing, setPlaying] = useState(true);
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

  const togglePlay = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };
  const goAi = () => {
    logEvent('record_choice', { choice: 'ai' });
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
  const close = () => {
    takeRecordedVideo();
    router.replace('/');
  };

  if (!video) return null;

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.videoArea}>
        <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button">
          {!playing && (
            <View style={styles.pauseCenter}>
              <View style={styles.playBtn}>
                <Feather name="play" size={26} color="#FFFFFF" />
              </View>
            </View>
          )}
        </Pressable>
        <SafeAreaView edges={['top']} style={styles.topBar} pointerEvents="box-none">
          <Pressable onPress={close} hitSlop={12} accessibilityRole="button" accessibilityLabel={t('common.close')}>
            <Feather name="x" size={26} color="#FFFFFF" />
          </Pressable>
          {sec !== null && <Text style={styles.duration}>{formatClipDuration(sec)}</Text>}
        </SafeAreaView>
        <View style={styles.banner}>
          <Feather name="check-circle" size={16} color={palette.green} />
          <Text style={styles.bannerText}>{t('recordChoice.savedBanner')}</Text>
          <Pressable onPress={() => router.push('/archive')} hitSlop={8} accessibilityRole="button">
            <Text style={styles.bannerLink}>{t('recordChoice.viewArchive')}</Text>
          </Pressable>
        </View>
      </View>

      <SafeAreaView edges={['bottom']} style={styles.sheet}>
        <Text style={styles.sheetTitle}>{t('recordChoice.sheetTitle')}</Text>
        <Text style={styles.sheetSub}>{t('recordChoice.sheetSub')}</Text>

        <Option icon="message-circle" tint={palette.blue} bg={palette.blueSoft} title={t('recordChoice.coach')} sub={t('recordChoice.coachSub')} onPress={goAi} />
        {/* 챌린지는 한국어 대사만 올라온다 — 한국어로 쓰는 사람에게만 보인다 (SOMA-544). */}
        {isKorean() && (
          <Option icon="award" tint="#E9A23B" bg="#FFF4DE" title={t('recordChoice.challenge')} sub={t('recordChoice.challengeSub2')} onPress={goChallenge} />
        )}
        <Option icon="video" tint={palette.textDim} bg={palette.bgSoft} title={t('recordChoice.retake2')} sub={t('recordChoice.retakeSub')} onPress={retake} />
      </SafeAreaView>
    </View>
  );
}

function Option({
  icon,
  tint,
  bg,
  title,
  sub,
  onPress,
}: {
  icon: 'message-circle' | 'award' | 'video';
  tint: string;
  bg: string;
  title: string;
  sub: string;
  onPress: () => void;
}) {
  return (
    <Pressable style={({ pressed }) => [styles.option, pressed && styles.pressed]} onPress={onPress} accessibilityRole="button">
      <View style={[styles.optionIcon, { backgroundColor: bg }]}>
        <Feather name={icon} size={18} color={tint} />
      </View>
      <View style={styles.flex}>
        <Text style={styles.optionTitle}>{title}</Text>
        <Text style={styles.optionSub}>{sub}</Text>
      </View>
      <Feather name="chevron-right" size={18} color={palette.checkOff} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  pressed: { opacity: 0.8 },
  videoArea: { flex: 1 },
  pauseCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  playBtn: {
    width: 64,
    height: 64,
    borderRadius: 32,
    backgroundColor: 'rgba(255,255,255,0.2)',
    alignItems: 'center',
    justifyContent: 'center',
  },
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
  duration: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  banner: {
    position: 'absolute',
    left: 20,
    right: 20,
    bottom: 16,
    flexDirection: 'row',
    alignItems: 'center',
    gap: 8,
    backgroundColor: 'rgba(20,24,32,0.9)',
    borderRadius: 12,
    paddingHorizontal: 14,
    paddingVertical: 12,
  },
  bannerText: { flex: 1, fontSize: 13.5, fontWeight: '700', color: '#FFFFFF' },
  bannerLink: { fontSize: 13, fontWeight: '800', color: '#7FB3FF' },
  sheet: {
    backgroundColor: palette.card,
    borderTopLeftRadius: 22,
    borderTopRightRadius: 22,
    padding: 20,
    paddingTop: 22,
    gap: 10,
  },
  sheetTitle: { fontSize: 18, fontWeight: '800', color: palette.text },
  sheetSub: { fontSize: 12.5, color: palette.textFaint, marginBottom: 6 },
  option: {
    flexDirection: 'row',
    alignItems: 'center',
    gap: 12,
    borderWidth: 1,
    borderColor: palette.border,
    borderRadius: 16,
    padding: 14,
  },
  optionIcon: { width: 40, height: 40, borderRadius: 20, alignItems: 'center', justifyContent: 'center' },
  optionTitle: { fontSize: 15, fontWeight: '800', color: palette.text },
  optionSub: { fontSize: 12, color: palette.textFaint, marginTop: 2 },
});
