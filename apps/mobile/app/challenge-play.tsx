import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useState } from 'react';
import { Pressable, StyleSheet, Text, View } from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { SAMPLE_VIDEO, TODAY_LINE } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

/**
 * A15 챌린지 스토리 — 한 사람의 연기 영상을 풀스크린으로 본다.
 *
 * 영상은 예시 샘플(포스터에서 만든 목업)이다. 좋아요는 로컬 토글, 댓글·공유는 "곧 열려요".
 * "나도 이 대사 연기하기"는 실제 연습 시작으로 이어진다. 서버가 서면 실제 연기 영상으로 교체.
 */
export default function ChallengePlayScreen() {
  const router = useRouter();
  const { alert, dialog } = useAppDialog();
  const { name, line } = useLocalSearchParams<{ name?: string; line?: string }>();
  const player = useVideoPlayer(SAMPLE_VIDEO, (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState(false);

  const perform = () => {
    logEvent('challenge_perform_tap', { line: (line || TODAY_LINE.line).slice(0, 40) });
    router.push('/upload');
  };
  const soon = (where: string) => {
    logEvent('challenge_soon_tap', { where });
    void alert({
      title: t('challenges.soonTitle'),
      message: t('challenges.soonMessage'),
      confirmLabel: t('common.confirm'),
    });
  };
  const togglePlay = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };

  const author = name || TODAY_LINE.work;
  const likeCount = liked ? '4.5천' : '4.4천';

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
      {/* 탭하면 재생/일시정지 — 위·아래 컨트롤은 이 위에 얹는다. */}
      <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button">
        {!playing && (
          <View style={styles.pauseCenter}>
            <Feather name="play" size={40} color="rgba(255,255,255,0.9)" />
          </View>
        )}
      </Pressable>
      <View style={styles.scrimTop} pointerEvents="none" />
      <View style={styles.scrimBottom} pointerEvents="none" />

      <SafeAreaView style={styles.overlay} edges={['top', 'bottom']} pointerEvents="box-none">
        <View style={styles.top}>
          <Pressable onPress={() => router.back()} hitSlop={10} accessibilityRole="button">
            <Feather name="x" size={26} color="#FFFFFF" />
          </Pressable>
          <View style={styles.author}>
            <View style={styles.avatar}>
              <Text style={styles.avatarText}>{author.charAt(0)}</Text>
            </View>
            <Text style={styles.authorName}>{author}</Text>
          </View>
          <Pressable onPress={() => soon('share')} hitSlop={10} accessibilityRole="button">
            <Feather name="share-2" size={22} color="#FFFFFF" />
          </Pressable>
        </View>

        <View style={styles.flex} pointerEvents="none" />

        <View style={styles.bottom}>
          <Text style={styles.storyLabel}>{t('challenges.todayLabel')}</Text>
          <Text style={styles.line}>“{line || TODAY_LINE.line}”</Text>
          <Text style={styles.work}>{TODAY_LINE.work}</Text>

          <View style={styles.actions}>
            <Pressable style={styles.action} onPress={() => setLiked((v) => !v)} accessibilityRole="button">
              <Feather name="heart" size={22} color={liked ? palette.danger : '#FFFFFF'} />
              <Text style={styles.actionText}>{likeCount}</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => soon('comment')} accessibilityRole="button">
              <Feather name="message-circle" size={22} color="#FFFFFF" />
              <Text style={styles.actionText}>128</Text>
            </Pressable>
            <Pressable style={styles.action} onPress={() => soon('share')} accessibilityRole="button">
              <Feather name="share-2" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          <Pressable style={({ pressed }) => [styles.performBtn, pressed && styles.pressed]} onPress={perform} accessibilityRole="button">
            <Feather name="video" size={16} color="#FFFFFF" />
            <Text style={styles.performText}>{t('challenges.performCta')}</Text>
          </Pressable>
        </View>
      </SafeAreaView>
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  pauseCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.35)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 320, backgroundColor: 'rgba(0,0,0,0.45)' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  authorName: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
  bottom: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  storyLabel: { fontSize: 12, fontWeight: '800', color: 'rgba(255,255,255,0.8)' },
  line: { fontSize: 22, fontWeight: '800', color: '#FFFFFF', lineHeight: 30 },
  work: { fontSize: 13, fontWeight: '600', color: 'rgba(255,255,255,0.75)' },
  actions: { flexDirection: 'row', gap: 22, marginTop: 6 },
  action: { flexDirection: 'row', alignItems: 'center', gap: 6 },
  actionText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  performBtn: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.blue,
    borderRadius: 14,
    paddingVertical: 15,
    marginTop: 6,
  },
  pressed: { opacity: 0.85 },
  performText: { fontSize: 15, fontWeight: '800', color: '#FFFFFF' },
});
