import Ionicons from '@expo/vector-icons/Ionicons';
import { Stack, useRouter } from 'expo-router';
import { useRef, useState } from 'react';
import {
  FlatList,
  Pressable,
  StyleSheet,
  Text,
  useWindowDimensions,
  View,
  type NativeScrollEvent,
  type NativeSyntheticEvent,
} from 'react-native';
import { SafeAreaView } from 'react-native-safe-area-context';

import { palette } from '@/constants/palette';
import { logEvent } from '@/lib/analytics';
import { markGuideSeen } from '@/lib/guide-state';
import { isKorean, translate as t } from '@/lib/i18n';

type Slide = { key: string; icon: React.ComponentProps<typeof Ionicons>['name']; tint: string; bg: string };

/**
 * 넷째 장의 문구 키. 대사 챌린지는 올라오는 대사가 전부 한국어라 한국어로 쓰는 사람에게만
 * 보인다(SOMA-544) — 안 보이는 기능을 설명하지 않도록 그쪽은 대본 리딩만 이야기한다.
 */
function textKey(slide: Slide, part: 'Title' | 'Body'): string {
  const global = slide.key === 's4' && !isKorean();
  return `guide.${slide.key}${part}${global ? 'Global' : ''}`;
}

const SLIDES: Slide[] = [
  { key: 's1', icon: 'videocam-outline', tint: palette.blue, bg: palette.blueSoft },
  { key: 's2', icon: 'chatbubbles-outline', tint: '#7C3AED', bg: '#F1EAFE' },
  { key: 's3', icon: 'document-text-outline', tint: '#0F9D58', bg: '#E5F8EF' },
  { key: 's4', icon: 'trophy-outline', tint: '#E9A23B', bg: '#FFF4DE' },
];

/**
 * 첫 시작 가이드 — 4장 슬라이드. 홈에 처음 들어올 때 한 번 뜨고(guide-state), 설정에서 다시 볼 수 있다.
 * 찍기 → 질문으로 되짚기 → 다음 한 가지 → 대본 리딩·챌린지 순으로 앱의 뼈대만 짚는다.
 */
export default function GuideScreen() {
  const router = useRouter();
  const { width } = useWindowDimensions();
  const [index, setIndex] = useState(0);
  const listRef = useRef<FlatList<Slide>>(null);
  const last = index === SLIDES.length - 1;

  const finish = (how: 'skip' | 'done') => {
    logEvent('guide_finish', { how, at: index });
    void markGuideSeen();
    if (router.canGoBack()) router.back();
    else router.replace('/');
  };

  const next = () => {
    if (last) {
      finish('done');
      return;
    }
    listRef.current?.scrollToIndex({ index: index + 1, animated: true });
  };

  const onMomentumEnd = (e: NativeSyntheticEvent<NativeScrollEvent>) => {
    setIndex(Math.round(e.nativeEvent.contentOffset.x / width));
  };

  return (
    <SafeAreaView style={styles.safe} edges={['top', 'bottom']}>
      <Stack.Screen options={{ headerShown: false }} />
      <View style={styles.top}>
        <Pressable onPress={() => finish('skip')} hitSlop={10} accessibilityRole="button">
          <Text style={styles.skip}>{t('guide.skip')}</Text>
        </Pressable>
      </View>

      <FlatList
        ref={listRef}
        data={SLIDES}
        keyExtractor={(s) => s.key}
        horizontal
        pagingEnabled
        showsHorizontalScrollIndicator={false}
        onMomentumScrollEnd={onMomentumEnd}
        getItemLayout={(_, i) => ({ length: width, offset: width * i, index: i })}
        renderItem={({ item }) => (
          <View style={[styles.slide, { width }]}>
            <View style={[styles.iconWrap, { backgroundColor: item.bg }]}>
              <Ionicons name={item.icon} size={64} color={item.tint} />
            </View>
            <Text style={styles.title}>{t(textKey(item, 'Title'))}</Text>
            <Text style={styles.body}>{t(textKey(item, 'Body'))}</Text>
          </View>
        )}
      />

      <View style={styles.bottom}>
        <View style={styles.dots}>
          {SLIDES.map((s, i) => (
            <View key={s.key} style={[styles.dot, i === index && styles.dotOn]} />
          ))}
        </View>
        <Pressable style={({ pressed }) => [styles.cta, pressed && styles.pressed]} onPress={next} accessibilityRole="button">
          <Text style={styles.ctaText}>{t(last ? 'guide.start' : 'guide.next')}</Text>
          {!last && <Ionicons name="arrow-forward" size={18} color="#FFFFFF" />}
        </Pressable>
      </View>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  safe: { flex: 1, backgroundColor: palette.bg },
  top: { flexDirection: 'row', justifyContent: 'flex-end', paddingHorizontal: 24, paddingTop: 12 },
  skip: { fontSize: 14, fontWeight: '700', color: palette.textFaint },
  slide: { flex: 1, alignItems: 'center', justifyContent: 'center', paddingHorizontal: 36, gap: 18 },
  iconWrap: { width: 148, height: 148, borderRadius: 74, alignItems: 'center', justifyContent: 'center', marginBottom: 12 },
  title: { fontSize: 26, fontWeight: '800', color: palette.text, textAlign: 'center', lineHeight: 34 },
  body: { fontSize: 15, color: palette.textDim, textAlign: 'center', lineHeight: 23 },
  bottom: { paddingHorizontal: 24, paddingBottom: 12, gap: 18 },
  dots: { flexDirection: 'row', justifyContent: 'center', gap: 6 },
  dot: { width: 8, height: 8, borderRadius: 4, backgroundColor: palette.border },
  dotOn: { width: 22, backgroundColor: palette.blue },
  cta: {
    flexDirection: 'row',
    alignItems: 'center',
    justifyContent: 'center',
    gap: 8,
    backgroundColor: palette.blue,
    borderRadius: 16,
    paddingVertical: 17,
  },
  pressed: { opacity: 0.9 },
  ctaText: { fontSize: 16, fontWeight: '800', color: '#FFFFFF' },
});
