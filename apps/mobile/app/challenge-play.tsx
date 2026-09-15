import Feather from '@expo/vector-icons/Feather';
import { Stack, useLocalSearchParams, useRouter } from 'expo-router';
import { useVideoPlayer, VideoView } from 'expo-video';
import { useCallback, useEffect, useRef, useState } from 'react';
import {
  FlatList,
  Image,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { useAppDialog } from '@/components/app-dialog';
import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { CLIPS, PERFORMERS, PERF_IMAGES, TODAY_LINE, type Performer } from '@/lib/challenge-mock';
import { translate as t } from '@/lib/i18n';

/**
 * A15 챌린지 스토리 — 연기 영상을 풀스크린으로 보고, 옆으로 넘기면 다음 연기자로 간다.
 *
 * 플레이어는 하나만 두고 활성 페이지에서만 VideoView를 그린다(다른 페이지는 포스터).
 * 넘길 때 player.replace로 그 연기자의 클립을 튼다. 영상은 예시 샘플이고 좋아요는 로컬
 * 토글, 댓글·공유는 "곧 열려요". "나도 이 대사 연기하기"는 실제 연습 시작으로 이어진다.
 */
export default function ChallengePlayScreen() {
  const router = useRouter();
  const { width, height } = useWindowDimensions();
  const { alert, dialog } = useAppDialog();
  const { name, line } = useLocalSearchParams<{ name?: string; line?: string }>();
  const startIndex = Math.max(
    0,
    PERFORMERS.findIndex((p) => p.name === name),
  );
  const [active, setActive] = useState(startIndex);
  const [playing, setPlaying] = useState(true);
  const [liked, setLiked] = useState<Record<number, boolean>>({});
  const listRef = useRef<FlatList<Performer>>(null);

  const player = useVideoPlayer(CLIPS[startIndex], (p) => {
    p.loop = true;
    p.muted = true;
    p.play();
  });

  // 페이지가 바뀌면 그 연기자의 클립으로 갈아끼운다.
  useEffect(() => {
    player.replace(CLIPS[active]);
    player.play();
    setPlaying(true);
    logEvent('challenge_swipe', { index: active });
  }, [active, player]);

  const onMomentumEnd = useCallback(
    (e: NativeSyntheticEvent<NativeScrollEvent>) => {
      const next = Math.round(e.nativeEvent.contentOffset.x / width);
      if (next !== active && next >= 0 && next < PERFORMERS.length) setActive(next);
    },
    [active, width],
  );

  const togglePlay = () => {
    if (playing) player.pause();
    else player.play();
    setPlaying((v) => !v);
  };
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

  const renderItem = ({ item, index }: { item: Performer; index: number }) => {
    const isActive = index === active;
    const isLiked = !!liked[index];
    return (
      <View style={{ width, height }}>
        <Image source={PERF_IMAGES[item.img]} style={StyleSheet.absoluteFill} resizeMode="cover" />
        {isActive && (
          <VideoView style={StyleSheet.absoluteFill} player={player} contentFit="cover" nativeControls={false} />
        )}
        <Pressable style={StyleSheet.absoluteFill} onPress={togglePlay} accessibilityRole="button">
          {isActive && !playing && (
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
                <Text style={styles.avatarText}>{item.name.charAt(0)}</Text>
              </View>
              <Text style={styles.authorName}>{item.name}</Text>
            </View>
            <Pressable onPress={() => soon('share')} hitSlop={10} accessibilityRole="button">
              <Feather name="share-2" size={22} color="#FFFFFF" />
            </Pressable>
          </View>

          <View style={styles.flex} pointerEvents="none" />

          <View style={styles.bottom}>
            <View style={styles.dots}>
              {PERFORMERS.map((_, i) => (
                <View key={i} style={[styles.dot, i === active && styles.dotOn]} />
              ))}
            </View>
            <Text style={styles.storyLabel}>{t('challenges.todayLabel')}</Text>
            <Text style={styles.line}>“{line || TODAY_LINE.line}”</Text>
            <Text style={styles.work}>{TODAY_LINE.work}</Text>

            <View style={styles.actions}>
              <Pressable
                style={styles.action}
                onPress={() => setLiked((prev) => ({ ...prev, [index]: !prev[index] }))}
                accessibilityRole="button">
                <Feather name="heart" size={22} color={isLiked ? palette.danger : '#FFFFFF'} />
                <Text style={styles.actionText}>{item.likes}{isLiked ? '+1' : ''}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => soon('comment')} accessibilityRole="button">
                <Feather name="message-circle" size={22} color="#FFFFFF" />
                <Text style={styles.actionText}>{12 + index * 7}</Text>
              </Pressable>
              <Pressable style={styles.action} onPress={() => soon('share')} accessibilityRole="button">
                <Feather name="share-2" size={22} color="#FFFFFF" />
              </Pressable>
            </View>

            <Pressable
              style={({ pressed }) => [styles.performBtn, pressed && styles.pressed]}
              onPress={perform}
              accessibilityRole="button">
              <Feather name="video" size={16} color="#FFFFFF" />
              <Text style={styles.performText}>{t('challenges.performCta')}</Text>
            </Pressable>
          </View>
        </SafeAreaView>
      </View>
    );
  };

  return (
    <View style={styles.root}>
      <Stack.Screen options={{ headerShown: false }} />
      <FlatList
        ref={listRef}
        data={PERFORMERS}
        keyExtractor={(p) => p.name}
        renderItem={renderItem}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        initialScrollIndex={startIndex}
        getItemLayout={(_, index) => ({ length: width, offset: width * index, index })}
        onMomentumScrollEnd={onMomentumEnd}
        extraData={{ active, playing, liked }}
      />
      {dialog}
    </View>
  );
}

const styles = StyleSheet.create({
  root: { flex: 1, backgroundColor: '#000000' },
  flex: { flex: 1 },
  pauseCenter: { flex: 1, alignItems: 'center', justifyContent: 'center' },
  scrimTop: { position: 'absolute', top: 0, left: 0, right: 0, height: 120, backgroundColor: 'rgba(0,0,0,0.35)' },
  scrimBottom: { position: 'absolute', bottom: 0, left: 0, right: 0, height: 340, backgroundColor: 'rgba(0,0,0,0.45)' },
  overlay: { flex: 1, justifyContent: 'space-between' },
  top: { flexDirection: 'row', alignItems: 'center', justifyContent: 'space-between', paddingHorizontal: 16, paddingTop: 8 },
  author: { flexDirection: 'row', alignItems: 'center', gap: 8 },
  avatar: { width: 32, height: 32, borderRadius: 16, backgroundColor: 'rgba(255,255,255,0.25)', alignItems: 'center', justifyContent: 'center' },
  avatarText: { fontSize: 14, fontWeight: '800', color: '#FFFFFF' },
  bottom: { paddingHorizontal: 20, paddingBottom: 16, gap: 10 },
  dots: { flexDirection: 'row', gap: 6, marginBottom: 2 },
  dot: { width: 6, height: 6, borderRadius: 3, backgroundColor: 'rgba(255,255,255,0.35)' },
  dotOn: { width: 18, backgroundColor: '#FFFFFF' },
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
